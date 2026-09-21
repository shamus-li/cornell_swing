const SCHEDULE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTMACS7bEK5TUm1wmzyu65DBGkbGSegPM8Vj5NqYywksSDJeSejUjTOmvFSbz_pQ70eMvOOH1SMW53G/pub?gid=0&single=true&output=csv";
const SPECIAL_EVENTS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTMACS7bEK5TUm1wmzyu65DBGkbGSegPM8Vj5NqYywksSDJeSejUjTOmvFSbz_pQ70eMvOOH1SMW53G/pub?gid=1922996257&single=true&output=csv";

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];

    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim())) rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header.trim(), (record[index] || "").trim()])));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Accepts 2026-09-07, 9/7/2026, and 9/7 so a sheet edit in either style renders.
function parseDateParts(value) {
  const trimmed = (value || "").trim();
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  match = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (match) return { year: match[3] ? Number(match[3]) : null, month: Number(match[1]), day: Number(match[2]) };
  return null;
}

function formatDate(value) {
  const parts = parseDateParts(value);
  return parts ? `${parts.month}.${parts.day}` : value;
}

function isoDate(value) {
  const parts = parseDateParts(value);
  if (!parts || parts.year === null) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isPastDate(value) {
  const parts = parseDateParts(value);
  if (!parts || parts.year === null) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(parts.year, parts.month - 1, parts.day) < today;
}

function scheduleRow(event) {
  const article = element("article", "schedule-row");
  if (isPastDate(event.Date)) article.classList.add("is-past");

  const dateCell = element("time", "schedule-date");
  const iso = isoDate(event.Date);
  if (iso) dateCell.dateTime = iso;
  dateCell.textContent = formatDate(event.Date);

  const locationCell = element("div", "schedule-location", event.Location || "TBA");

  const programCell = element("div", "schedule-program");
  const programs = [
    ["Beginner", event["Beginner Program"]],
    ["Advanced", event["Advanced Program"]],
  ].filter(([, program]) => program && program !== "—");

  if (!programs.length) {
    programCell.append(element("p", "", "TBA"));
  } else {
    programs.forEach(([name, program]) => {
      const line = element("p");
      const strong = element("strong", "", `${name}: `);
      line.append(strong, program);
      programCell.append(line);
    });
  }

  if (event.Notes) programCell.append(element("p", "schedule-detail", event.Notes));

  article.append(dateCell, locationCell, programCell);
  return article;
}

function specialEventMeta(event) {
  const details = [event.Time, event.Location].filter(Boolean);
  return details.length ? details.join(" · ") : "TBA";
}

function specialEventRow(event) {
  const article = element("article", "special-event-row");
  if (isPastDate(event.Date)) article.classList.add("is-past");

  const dateCell = element("time", "special-event-date", formatDate(event.Date));
  const iso = isoDate(event.Date);
  if (iso) dateCell.dateTime = iso;

  const details = element("div", "special-event-details");
  const title = element("h3", "special-event-title");
  const titleText = event.Title || "TBA";
  if (event.URL) {
    const link = element("a", "", titleText);
    link.href = event.URL;
    title.append(link);
  } else {
    title.textContent = titleText;
  }
  const meta = element("p", "special-event-meta", specialEventMeta(event));

  details.append(title, meta);
  article.append(dateCell, details);
  return article;
}

async function fetchEvents(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Event request failed with ${response.status}`);
  return parseCsv(await response.text());
}

async function loadSchedule() {
  const list = document.querySelector("#schedule-list");

  try {
    const events = await fetchEvents(SCHEDULE_URL);
    if (!events.length) throw new Error("Schedule is empty");

    list.replaceChildren(...events.map(scheduleRow));
    list.setAttribute("aria-busy", "false");
    window.__scheduleReady = true;
  } catch (error) {
    console.error(error);
    const message = element("p", "schedule-status", "The schedule could not be loaded.");
    list.replaceChildren(message);
    list.setAttribute("aria-busy", "false");
    window.__scheduleReady = false;
  }
}

async function loadSpecialEvents() {
  const list = document.querySelector("#special-events-list");

  try {
    const events = await fetchEvents(SPECIAL_EVENTS_URL);
    if (!events.length) throw new Error("Special events are empty");

    list.replaceChildren(...events.map(specialEventRow));
    list.setAttribute("aria-busy", "false");
    window.__specialEventsReady = true;
  } catch (error) {
    console.error(error);
    const message = element("p", "schedule-status", "The special events could not be loaded.");
    list.replaceChildren(message);
    list.setAttribute("aria-busy", "false");
    window.__specialEventsReady = false;
  }
}

window.addEventListener("load", () => {
  loadSchedule();
  loadSpecialEvents();
}, { once: true });

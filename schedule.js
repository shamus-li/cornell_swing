const SCHEDULE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTMACS7bEK5TUm1wmzyu65DBGkbGSegPM8Vj5NqYywksSDJeSejUjTOmvFSbz_pQ70eMvOOH1SMW53G/pub?gid=0&single=true&output=csv";
const CAMPUSGROUPS_URL = "https://cornell.campusgroups.com/gcss/club_signup";

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

function scheduleRow(event) {
  const date = new Date(`${event.Date}T12:00:00`);
  const article = element("article", "schedule-row");

  const dateCell = element("time", "schedule-date");
  dateCell.dateTime = event.Date;
  dateCell.textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);

  const locationCell = element("div", "schedule-location", event.Location || "TBA");

  const programCell = element("div", "schedule-program");
  const programs = [
    ["Beginner", event["Beginner Program"]],
    ["Advanced", event["Advanced Program"]],
  ].filter(([, program]) => program && program !== "—");

  if (!programs.length) {
    programCell.append(element("p", "", "To be announced"));
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

async function loadSchedule() {
  const list = document.querySelector("#schedule-list");

  try {
    const response = await fetch(SCHEDULE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Schedule request failed with ${response.status}`);
    const events = parseCsv(await response.text());
    if (!events.length) throw new Error("Schedule is empty");

    list.replaceChildren(...events.map(scheduleRow));
    list.setAttribute("aria-busy", "false");
    window.__scheduleReady = true;
  } catch (error) {
    console.error(error);
    const message = element("p", "schedule-status", "The schedule could not be loaded. Please check ");
    const link = element("a", "", "CampusGroups");
    link.href = CAMPUSGROUPS_URL;
    message.append(link, " for the latest details.");
    list.replaceChildren(message);
    list.setAttribute("aria-busy", "false");
    window.__scheduleReady = false;
  }
}

loadSchedule();

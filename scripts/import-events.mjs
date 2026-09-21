import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

// One-time migration from exported Sheets CSVs, never used by the website.
const [normalPath = "output/events/sheet-0.csv", specialPath = "output/events/sheet-1.csv", outputPath = "output/events/seed.sql"] = process.argv.slice(2)

function parseCsv(csv) {
  const rows = []
  let row = []
  let value = ""
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (character === '"' && quoted && csv[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === "," && !quoted) {
      row.push(value)
      value = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ""
    } else {
      value += character
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field")
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }
  const [headers, ...records] = rows
  if (!headers?.includes("Date")) throw new Error("CSV is missing the Date column")
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header.trim(), (record[index] || "").trim()])))
}

function timeRange(value) {
  if (!value) return null
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (!match) throw new Error(`Cannot import time range: ${value}`)
  const clock = (hour, minute, period) => `${String(Number(hour) % 12 + (period.toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${minute || "00"}`
  return [clock(match[1], match[2], match[3] || match[6]), clock(match[4], match[5], match[6])]
}

const [normalCsv, specialCsv] = await Promise.all([readFile(normalPath, "utf8"), readFile(specialPath, "utf8")])
const updatedAt = new Date().toISOString()
const normalEvents = parseCsv(normalCsv).map((row) => ({
  id: `normal-${row.Date}`,
  kind: "normal",
  title: "Monday swing",
  date: row.Date,
  startTime: "20:00",
  endTime: "22:00",
  location: row.Location,
  description: [
    row["Beginner Program"] && `**Beginner:** ${row["Beginner Program"]}`,
    row["Advanced Program"] && `**Advanced:** ${row["Advanced Program"]}`,
    row.Notes,
  ].filter(Boolean).join("\n\n"),
  updatedAt,
}))

const specialGroups = new Map()
for (const row of parseCsv(specialCsv)) {
  if (!specialGroups.has(row.Date)) specialGroups.set(row.Date, [])
  specialGroups.get(row.Date).push(row)
}
const specialEvents = [...specialGroups].map(([date, rows]) => {
  const ranges = rows.map((row) => timeRange(row.Time)).filter(Boolean)
  return {
    id: `special-${date}`,
    kind: "special",
    title: rows.map((row) => row.Title).filter(Boolean).join(" · ") || "TBA",
    date,
    startTime: ranges.map(([start]) => start).sort()[0] || "",
    endTime: ranges.map(([, end]) => end).sort().at(-1) || "",
    location: [...new Set(rows.map((row) => row.Location).filter(Boolean))].join(" · "),
    description: rows.flatMap((row) => [
      [row.Time && `**${row.Time}**`, row.Activity].filter(Boolean).join(" — "),
      row.URL && `[More details](${row.URL})`,
    ]).filter(Boolean).join("\n\n"),
    updatedAt,
  }
})

const events = [...normalEvents, ...specialEvents]
const columns = ["id", "kind", "title", "date", "startTime", "endTime", "location", "description", "updatedAt"]
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`
for (const event of events) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) throw new Error(`Cannot import date: ${event.date}`)
}
const sql = events.map((event) => `INSERT INTO events (${columns.join(", ")}) VALUES (${columns.map((column) => sqlString(event[column])).join(", ")});`).join("\n")
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${sql}\n`)
console.log(`Wrote ${normalEvents.length} normal events and ${specialEvents.length} special events to ${outputPath}`)

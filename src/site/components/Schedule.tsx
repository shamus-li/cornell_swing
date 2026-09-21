import { useEffect, useState } from "react"

type SheetRow = Record<string, string>
type LoadStatus = "loading" | "loaded" | "error"
type ReadyFlag = "__scheduleReady" | "__specialEventsReady"

declare global {
  interface Window {
    __scheduleReady?: boolean
    __specialEventsReady?: boolean
  }
}

function parseCsv(csv: string): SheetRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ""
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    const next = csv[index + 1]

    if (character === '"' && quoted && next === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === "," && !quoted) {
      row.push(value)
      value = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ""
    } else {
      value += character
    }
  }

  if (value || row.length) {
    row.push(value)
    if (row.some((cell) => cell.trim())) rows.push(row)
  }

  const [headers, ...records] = rows
  if (!headers) return []

  return records.map((record) =>
    Object.fromEntries(
      headers.map((header, index) => [
        header.trim(),
        (record[index] || "").trim(),
      ]),
    ),
  )
}

async function fetchEvents(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal })
  if (!response.ok) {
    throw new Error(`Event request failed with ${response.status}`)
  }

  const events = parseCsv(await response.text())
  if (!events.length) throw new Error("Events are empty")
  return events
}

function useEvents(url: string, readyFlag: ReadyFlag) {
  const [events, setEvents] = useState<SheetRow[]>([])
  const [status, setStatus] = useState<LoadStatus>("loading")

  useEffect(() => {
    const controller = new AbortController()
    window[readyFlag] = false
    setStatus("loading")

    fetchEvents(url, controller.signal)
      .then((nextEvents) => {
        setEvents(nextEvents)
        setStatus("loaded")
        window[readyFlag] = true
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        console.error(error)
        setStatus("error")
        window[readyFlag] = false
      })

    return () => controller.abort()
  }, [readyFlag, url])

  return { events, status }
}

// Accepts 2026-09-07, 9/7/2026, and 9/7 so either Sheet style renders.
function parseDateParts(value: string) {
  const trimmed = value.trim()
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    }
  }

  match = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/)
  if (!match) return null

  return {
    year: match[3] ? Number(match[3]) : null,
    month: Number(match[1]),
    day: Number(match[2]),
  }
}

function formatDate(value: string) {
  const parts = parseDateParts(value)
  return parts ? `${parts.month}.${parts.day}` : value
}

function isoDate(value: string) {
  const parts = parseDateParts(value)
  if (!parts || parts.year === null) return undefined
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

function isPastDate(value: string) {
  const parts = parseDateParts(value)
  if (!parts || parts.year === null) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(parts.year, parts.month - 1, parts.day) < today
}

function ScheduleRow({ event }: { event: SheetRow }) {
  const programs = [
    { label: "Beginner", value: event["Beginner Program"] },
    { label: "Advanced", value: event["Advanced Program"] },
  ].filter(({ value }) => value && value !== "—")

  return (
    <article className={`schedule-row${isPastDate(event.Date) ? " is-past" : ""}`}>
      <time className="schedule-date" dateTime={isoDate(event.Date)}>
        {formatDate(event.Date)}
      </time>
      <div className="schedule-location">{event.Location || "TBA"}</div>
      <div className="schedule-program">
        {programs.length ? (
          programs.map(({ label, value }) => (
            <p key={label}>
              <strong>{label}: </strong>
              {value}
            </p>
          ))
        ) : (
          <p>TBA</p>
        )}
        {event.Notes && <p className="schedule-detail">{event.Notes}</p>}
      </div>
    </article>
  )
}

export function Schedule({ title, times, url }: {
  title: string
  times: string
  url: string
}) {
  const { events, status } = useEvents(url, "__scheduleReady")

  return (
    <section id="schedule" className="section" aria-labelledby="schedule-title">
      <h2 id="schedule-title">{title}</h2>
      <p className="schedule-times">{times}</p>

      <div className="schedule-header" aria-hidden="true">
        <span>Date</span>
        <span>Location</span>
        <span>Lesson program</span>
      </div>
      <div
        className="schedule-list"
        aria-live="polite"
        aria-busy={status === "loading"}
      >
        {status === "loading" && (
          <p className="schedule-status">Loading schedule...</p>
        )}
        {status === "error" && (
          <p className="schedule-status">The schedule could not be loaded.</p>
        )}
        {status === "loaded" &&
          events.map((event, index) => (
            <ScheduleRow
              key={`${event.Date}-${event.Location}-${index}`}
              event={event}
            />
          ))}
      </div>
    </section>
  )
}

function SpecialEventRow({ event }: { event: SheetRow }) {
  const title = event.Title || "TBA"
  const details = [event.Time, event.Location].filter(Boolean).join(" · ") || "TBA"

  return (
    <article
      className={`special-event-row${isPastDate(event.Date) ? " is-past" : ""}`}
    >
      <time className="special-event-date" dateTime={isoDate(event.Date)}>
        {formatDate(event.Date)}
      </time>
      <div className="special-event-details">
        <h3 className="special-event-title">
          {event.URL ? <a href={event.URL}>{title}</a> : title}
        </h3>
        <p className="special-event-meta">{details}</p>
      </div>
    </article>
  )
}

export function SpecialEvents({ title, url }: { title: string; url: string }) {
  const { events, status } = useEvents(url, "__specialEventsReady")

  return (
    <section
      id="special-events"
      className="section"
      aria-labelledby="special-events-title"
    >
      <h2 id="special-events-title">{title}</h2>

      <div
        className="special-events-list"
        aria-live="polite"
        aria-busy={status === "loading"}
      >
        {status === "loading" && (
          <p className="schedule-status">Loading special events...</p>
        )}
        {status === "error" && (
          <p className="schedule-status">
            The special events could not be loaded.
          </p>
        )}
        {status === "loaded" &&
          events.map((event, index) => (
            <SpecialEventRow
              key={`${event.Date}-${event.Title}-${index}`}
              event={event}
            />
          ))}
      </div>
    </section>
  )
}

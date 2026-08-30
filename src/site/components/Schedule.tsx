import { useEffect, useState } from "react"

type SheetRow = Record<string, string>
type LoadStatus = "loading" | "loaded" | "error"
type EventsState = { events: SheetRow[]; status: LoadStatus }

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
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Event request failed with ${response.status}`)
  }

  const events = parseCsv(await response.text())
  if (!events.length) throw new Error("Events are empty")
  return events
}

const loadingEvents: EventsState = { events: [], status: "loading" }

export function useScheduleData(scheduleUrl: string, specialEventsUrl: string) {
  const [schedule, setSchedule] = useState<EventsState>(loadingEvents)
  const [specialEvents, setSpecialEvents] = useState<EventsState>(loadingEvents)

  useEffect(() => {
    const controller = new AbortController()
    setSchedule(loadingEvents)
    setSpecialEvents(loadingEvents)

    const load = (url: string, setState: (state: EventsState) => void) =>
      fetchEvents(url, controller.signal)
        .then((events) => setState({ events, status: "loaded" }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          console.error(error)
          setState({ events: [], status: "error" })
        })

    void Promise.allSettled([
      load(scheduleUrl, setSchedule),
      load(specialEventsUrl, setSpecialEvents),
    ])

    return () => controller.abort()
  }, [scheduleUrl, specialEventsUrl])

  return { schedule, specialEvents }
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

export function Schedule({ title, times, events, status }: {
  title: string
  times: string
  events: SheetRow[]
  status: LoadStatus
}) {
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

function SpecialEventRow({ activities }: { activities: SheetRow[] }) {
  const date = activities[0].Date
  const title = activities.find((activity) => activity.Title)?.Title
  const url = activities.find((activity) => activity.URL)?.URL
  const location = activities[0].Location
  const sharedLocation = activities.every((activity) => activity.Location === location)

  return (
    <article
      className={`special-event-row${isPastDate(date) ? " is-past" : ""}`}
    >
      <time className="special-event-date" dateTime={isoDate(date)}>
        {url && !title ? <a href={url}>{formatDate(date)}</a> : formatDate(date)}
      </time>
      <div className="special-event-details">
        {title && (
          <h3 className="special-event-title">
            {url ? <a href={url}>{title}</a> : title}
          </h3>
        )}
        {sharedLocation && (
          <p className="special-event-location">{location || "Location TBA"}</p>
        )}
        <ul className="special-event-activities">
          {activities.map((activity, index) => (
            <li className="special-event-activity" key={index}>
              <span className="special-event-time">{activity.Time || "Time TBA"}</span>
              <div>
                {activity.Activity && <p>{activity.Activity}</p>}
                {!sharedLocation && (
                  <p className="special-event-location">
                    {activity.Location || "Location TBA"}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

export function SpecialEvents({ title, events, status }: {
  title: string
  events: SheetRow[]
  status: LoadStatus
}) {
  const eventsByDate = new Map<string, SheetRow[]>()
  for (const event of events) {
    const date = isoDate(event.Date) || event.Date
    const activities = eventsByDate.get(date)
    if (activities) activities.push(event)
    else eventsByDate.set(date, [event])
  }

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
          Array.from(eventsByDate, ([date, activities]) => (
            <SpecialEventRow
              key={date}
              activities={activities}
            />
          ))}
      </div>
    </section>
  )
}

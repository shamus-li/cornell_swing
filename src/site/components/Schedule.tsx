import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

type SheetRow = Record<string, string>
type LoadStatus = "loading" | "loaded" | "error"
type EventsState = { events: SheetRow[]; status: LoadStatus }
export type ScheduleSnapshot = {
  schedule: SheetRow[]
  specialEvents: SheetRow[]
  today: string
}

export function todayInIthaca() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
}

export function parseCsv(csv: string): SheetRow[] {
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

export async function fetchEvents(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Event request failed with ${response.status}`)
  }

  const csv = await response.text()
  if (!/^"?Date"?,/.test(csv.trimStart())) {
    throw new Error("Schedule CSV is missing the Date column")
  }
  return parseCsv(csv)
}

const loadingEvents: EventsState = { events: [], status: "loading" }

export function useScheduleData(
  scheduleUrl: string,
  specialEventsUrl: string,
  initial?: ScheduleSnapshot,
) {
  const [schedule, setSchedule] = useState<EventsState>(initial
    ? { events: initial.schedule, status: "loaded" }
    : loadingEvents)
  const [specialEvents, setSpecialEvents] = useState<EventsState>(initial
    ? { events: initial.specialEvents, status: "loaded" }
    : loadingEvents)
  // The first browser render must use the build's date, even days after deploy.
  const [today, setToday] = useState(initial?.today ?? todayInIthaca())

  useEffect(() => {
    const controller = new AbortController()
    setToday(todayInIthaca())

    const load = (url: string, setState: Dispatch<SetStateAction<EventsState>>) =>
      fetchEvents(url, controller.signal)
        .then((events) => setState({ events, status: "loaded" }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return
          console.error(error)
          setState((current) => current.status === "loaded"
            ? current
            : { events: [], status: "error" })
        })

    void Promise.allSettled([
      load(scheduleUrl, setSchedule),
      load(specialEventsUrl, setSpecialEvents),
    ])

    return () => controller.abort()
  }, [scheduleUrl, specialEventsUrl])

  return { schedule, specialEvents, today }
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

function isPastDate(value: string, today: string) {
  const date = isoDate(value)
  return date !== undefined && date < today
}

function ScheduleRow({ event, today }: { event: SheetRow; today: string }) {
  const past = isPastDate(event.Date, today)
  const programs = [
    { label: "Beginner", value: event["Beginner Program"] },
    { label: "Advanced", value: event["Advanced Program"] },
  ].filter(({ value }) => value && value !== "—")

  return (
    <article className={`schedule-row${past ? " is-past" : ""}`} data-status={past ? "past" : undefined}>
      <time className="schedule-date" dateTime={isoDate(event.Date)}>
        {formatDate(event.Date)}
        {past && <span className="past-label">Past</span>}
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

export function Schedule({ title, times, events, status, today = todayInIthaca() }: {
  title: string
  times: string
  events: SheetRow[]
  status: LoadStatus
  today?: string
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
              today={today}
            />
          ))}
      </div>
    </section>
  )
}

function SpecialEventRow({ activities, today }: { activities: SheetRow[]; today: string }) {
  const date = activities[0].Date
  const past = isPastDate(date, today)
  const title = activities.find((activity) => activity.Title)?.Title || "TBA"
  const url = activities.find((activity) => activity.URL)?.URL
  const location = activities.find(
    (activity) => activity.Location && activity.Location.toUpperCase() !== "TBA",
  )?.Location
  const schedule = activities
    .map(({ Time, Activity }) => ({
      time: Time?.toUpperCase() === "TBA" ? "" : Time,
      activity: Activity,
    }))
    .filter(({ time, activity }) => time || activity)

  return (
    <article
      className={`special-event-row${past ? " is-past" : ""}`}
      data-status={past ? "past" : undefined}
    >
      <time className="special-event-date" dateTime={isoDate(date)}>
        {formatDate(date)}
        {past && <span className="past-label">Past</span>}
      </time>
      <div className="special-event-details">
        <h3 className="special-event-title">
          {url ? <a href={url}>{title}</a> : title}
        </h3>
        {location && <p className="special-event-location">{location}</p>}
        {schedule.length > 0 && (
          <ul className="special-event-activities">
            {schedule.map(({ time, activity }, index) => (
              <li className="special-event-activity" key={index}>
                {time && <span className="special-event-time">{time}</span>}
                {activity && <p>{activity}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

export function SpecialEvents({ title, events, status, today = todayInIthaca() }: {
  title: string
  events: SheetRow[]
  status: LoadStatus
  today?: string
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
              today={today}
            />
          ))}
      </div>
    </section>
  )
}

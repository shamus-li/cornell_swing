import { formatEventDays, type EventRecord } from "./model"

// Each day's date and times, above the description of an event running several days.
export function EventSchedule({ event }: { event: EventRecord }) {
  if (!event.moreDays?.length) return null
  return <ul className="event-schedule">{formatEventDays(event).map(day => <li key={day}>{day}</li>)}</ul>
}

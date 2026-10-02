import { formatEventDate, formatEventLocation, formatEventTime, type EventRecord } from "../events/model"

export const DraftBadge = () => <span className="status-badge">Draft</span>

// "Sat · 6:15–10:00 PM · Willard Straight Hall", leaving out parts that are not announced yet.
export function eventSummary(event: EventRecord): string {
  const details = [event.startTime && formatEventTime(event), (event.location || event.room) && formatEventLocation(event)].filter(Boolean)
  if (!details.length) return "Time and place to be announced"
  return [event.date && formatEventDate(event.date, { weekday: "short" }), ...details].filter(Boolean).join(" · ")
}

import { formatEventLocation, formatEventTime, type EventRecord } from "../events/model"

const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
const utc = (date: string) => new Date(`${date}T00:00:00Z`)

export function DateBlock({ date }: { date: string }) {
  if (!date) return <span className="date-block"><span className="date-block-day">TBA</span></span>
  return <time className="date-block" dateTime={date}><span className="date-block-month">{month.format(utc(date))}</span><span className="date-block-day">{utc(date).getUTCDate()}</span></time>
}

export const DraftBadge = () => <span className="status-badge">Draft</span>

// "Sat · 6:15–10:00 PM · Willard Straight Hall", leaving out parts that are not announced yet.
export function eventSummary(event: EventRecord): string {
  const details = [event.startTime && formatEventTime(event), (event.location || event.room) && formatEventLocation(event)].filter(Boolean)
  if (!details.length) return "Time and place to be announced"
  return [event.date && weekday.format(utc(event.date)), ...details].filter(Boolean).join(" · ")
}

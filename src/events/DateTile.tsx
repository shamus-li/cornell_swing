import { formatEventDate } from "./model"

export function DateTile({ date }: { date: string }) {
  if (!date) return <span className="date-tile"><span className="date-tile-day">TBA</span></span>
  return <time dateTime={date} className="date-tile">
    <span className="date-tile-month">{formatEventDate(date, { month: "short" })}</span> <span className="date-tile-day">{formatEventDate(date, { day: "numeric" })}</span>
  </time>
}

import { formatEventDate } from "./model"

// The top line is the month, or the weekday in lists already grouped by month.
export function DateTile({ date, top = "month" }: { date: string; top?: "month" | "weekday" }) {
  if (!date) return <span className="date-tile"><span className="date-tile-day">TBA</span></span>
  return <time dateTime={date} className="date-tile">
    <span className="date-tile-month">{formatEventDate(date, { [top]: "short" })}</span> <span className="date-tile-day">{formatEventDate(date, { day: "numeric" })}</span>
  </time>
}

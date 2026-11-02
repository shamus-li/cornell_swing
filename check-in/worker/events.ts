import { nightSpan, type EventDay } from "../../src/events/model"
import { dateKeyForSheetTimestamp } from "./google"

export type CheckinEvent = { id: string; kind: string; title: string; date: string; startTime: string; endTime: string; lessonEndTime: string; socialStartTime: string; moreDays: string; tickets: string }
// An event and the scheduled day of it that a moment belongs to.
export type EventSession = CheckinEvent & { sessionDate: string }

const COLUMNS = "id, kind, title, date, startTime, endTime, lessonEndTime, socialStartTime, moreDays, tickets"
const DAY_MINUTES = 24 * 60
// How far ahead of an event's start someone counts as arriving for it, and how long after its end as leaving it.
const EARLY_MINUTES = 90
const LATE_MINUTES = 180

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const nextDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const scheduledDays = (event: CheckinEvent): EventDay[] => [{ date: event.date, ...nightSpan(event) }, ...JSON.parse(event.moreDays) as EventDay[]]

// The event on at this Sheet timestamp, or the one someone is arriving for or leaving: a session under way
// comes first, then one about to start, then one just ended, with special events ahead of lessons when they tie.
// With `nearest`, a moment outside all of those takes the day's closest session.
export async function findSession(env: Env, timestamp: number, { nearest = false } = {}): Promise<EventSession | null> {
  const today = dateKeyForSheetTimestamp(timestamp)!
  const yesterday = nextDay(today, -1)
  // Sheet timestamps are days since 1899-12-30 in New York time, so the fraction is the time of day.
  const now = Math.floor((timestamp - Math.floor(timestamp)) * DAY_MINUTES + 1e-6)
  const { results } = await env.EVENTS_DB
    .prepare(`SELECT ${COLUMNS} FROM events WHERE date != '' AND date <= ?1 AND (date >= ?2 OR lastDate >= ?2) ORDER BY id`)
    .bind(today, yesterday)
    .all<CheckinEvent>()
  const sessions = results.flatMap((event) => scheduledDays(event).filter((day) => day.date === today || day.date === yesterday).map((day) => {
    const base = day.date === today ? 0 : -DAY_MINUTES
    return { event, date: day.date, start: base + (day.startTime ? minutesOf(day.startTime) : 0), end: base + (day.endTime ? minutesOf(day.endTime) : DAY_MINUTES) }
  }))
  type Session = (typeof sessions)[number]
  const specialFirst = (a: Session, b: Session) => Number(b.event.kind === "special") - Number(a.event.kind === "special")
  const pick = (matches: Session[], order: (a: Session, b: Session) => number) => [...matches].sort((a, b) => order(a, b) || specialFirst(a, b))[0]
  const chosen = pick(sessions.filter(({ start, end }) => start <= now && now <= end), (a, b) => a.start - b.start)
    ?? pick(sessions.filter(({ start }) => start > now && start - now <= EARLY_MINUTES), (a, b) => a.start - b.start)
    ?? pick(sessions.filter(({ end }) => end < now && now - end <= LATE_MINUTES), (a, b) => b.end - a.end)
    ?? (nearest ? pick(sessions.filter(({ date }) => date === today), (a, b) => Math.max(a.start - now, now - a.end) - Math.max(b.start - now, now - b.end)) : undefined)
  return chosen ? { ...chosen.event, sessionDate: chosen.date } : null
}

// The session a check-in or waiver at this Sheet timestamp belongs to. A night with no event gets an
// unpublished "Swing Dance" so check-in never stops at the door; officers can rename or publish it in /manage.
export async function eventAtSheetTimestamp(env: Env, timestamp: number): Promise<EventSession> {
  const found = await findSession(env, timestamp, { nearest: true })
  if (found) return found
  await env.EVENTS_DB
    .prepare("INSERT INTO events (id, kind, title, date, updatedAt, published) SELECT ?1, 'normal', 'Swing Dance', ?2, ?3, 0 WHERE NOT EXISTS (SELECT 1 FROM events WHERE date = ?2)")
    .bind(crypto.randomUUID(), dateKeyForSheetTimestamp(timestamp)!, new Date().toISOString())
    .run()
  return (await findSession(env, timestamp, { nearest: true }))!
}

export async function findCheckinEvent(env: Env, id: string): Promise<CheckinEvent | null> {
  return env.EVENTS_DB
    .prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`)
    .bind(id)
    .first<CheckinEvent>()
}

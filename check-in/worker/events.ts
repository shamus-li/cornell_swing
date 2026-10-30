import { dateKeyForSheetTimestamp } from "./google"

export type CheckinEvent = { id: string; kind: string; title: string; date: string; startTime: string; endTime: string }

const minutesOf = (time: string, blank: number) => time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : blank

// The event a check-in or waiver at this Sheet timestamp belongs to: the one whose times include it,
// else the closest in time. A night with no event gets an unpublished "Swing Dance" so check-in never
// stops at the door; officers can rename or publish it in /manage.
export async function eventAtSheetTimestamp(env: Env, timestamp: number): Promise<CheckinEvent> {
  const date = dateKeyForSheetTimestamp(timestamp)!
  // Sheet timestamps are days since 1899-12-30 in New York time, so the fraction is the time of day.
  const minutes = Math.floor((timestamp - Math.floor(timestamp)) * 24 * 60 + 1e-6)
  const find = async () => (await env.EVENTS_DB
    .prepare("SELECT id, kind, title, date, startTime, endTime FROM events WHERE date = ? ORDER BY startTime, id")
    .bind(date)
    .all<CheckinEvent>()).results
  let events = await find()
  if (!events.length) {
    await env.EVENTS_DB
      .prepare("INSERT INTO events (id, kind, title, date, updatedAt, published) SELECT ?1, 'normal', 'Swing Dance', ?2, ?3, 0 WHERE NOT EXISTS (SELECT 1 FROM events WHERE date = ?2)")
      .bind(crypto.randomUUID(), date, new Date().toISOString())
      .run()
    events = await find()
  }
  const distance = (event: CheckinEvent) =>
    Math.max(minutesOf(event.startTime, 0) - minutes, minutes - minutesOf(event.endTime, 24 * 60), 0)
  return events.reduce((best, event) => distance(event) < distance(best) ? event : best)
}

export async function findCheckinEvent(env: Env, id: string): Promise<CheckinEvent | null> {
  return env.EVENTS_DB
    .prepare("SELECT id, kind, title, date, startTime, endTime FROM events WHERE id = ?")
    .bind(id)
    .first<CheckinEvent>()
}

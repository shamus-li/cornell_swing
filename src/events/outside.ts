import { isValidDate, todayInNewYork, validateStyles, validateTimeRange, type CalendarEvent } from './model'
import { isValidEmail } from '../lib/email'

// Dances run by other groups, shown on /events beside Swing Syndicate's own events.
export interface OutsideEvent extends CalendarEvent {
  kind: 'outside'
  // The last day of an event running several days, which then has no times; empty for one day.
  lastDate: string
  groupName: string
  // Free text, such as "Students free · $15".
  price: string
  url: string
  // Waiting for an organizer's decision, and not published until then.
  needsReview: boolean
  // Set for events read from the group's calendar feed, which unpublishing keeps off /events and deleting would bring back.
  fromFeed: boolean
  // Where an event from email came from, such as "Email from Contra Club, Oct 28: November dance".
  sourceNote: string
}

type OutsideEventInput = Omit<OutsideEvent, 'id' | 'kind' | 'updatedAt' | 'fromFeed' | 'sourceNote'>

export function validateOutsideEvent(value: unknown): OutsideEventInput {
  if (!value || typeof value !== 'object') throw new Error('Enter the event details.')
  const input = value as Record<string, unknown>
  const limits = { groupName: 120, title: 160, date: 10, lastDate: 10, startTime: 5, endTime: 5, location: 300, city: 80, price: 100, url: 2000 }
  const fields: Record<string, string> = {}
  for (const [key, limit] of Object.entries(limits)) {
    const field = input[key] ?? ''
    if (typeof field !== 'string' || field.length > limit) throw new Error(`Check the event ${key}.`)
    fields[key] = field.trim()
  }
  if (!fields.title) throw new Error('Enter an event title.')
  if (!fields.groupName) throw new Error('Enter the group running the event.')
  if (!isValidDate(fields.date)) throw new Error('Enter a valid event date.')
  if (fields.lastDate && !(isValidDate(fields.lastDate) && fields.lastDate > fields.date)) throw new Error('Choose a last day after the first day.')
  validateTimeRange(fields.startTime, fields.endTime)
  const styles = validateStyles(input.styles)
  if (fields.url) {
    let url: URL | undefined
    try { url = new URL(fields.url) } catch { /* reported below */ }
    if (url?.protocol !== 'https:') throw new Error('Enter a link that starts with https://.')
  }
  if (typeof input.published !== 'boolean') throw new Error('Choose whether the event is published.')
  return { groupName: fields.groupName, title: fields.title, date: fields.date, lastDate: fields.lastDate, startTime: fields.lastDate ? '' : fields.startTime, endTime: fields.lastDate ? '' : fields.endTime, location: fields.location, city: fields.city || 'Ithaca', styles, price: fields.price, url: fields.url, published: input.published, needsReview: !input.published && input.needsReview === true }
}

// A visitor's request from /events, which waits for an organizer's review.
export function validateEventRequest(value: unknown): { input: OutsideEventInput; email: string } {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const email = typeof record.email === 'string' ? record.email.trim() : ''
  if (!isValidEmail(email)) throw new Error('Enter your email so an organizer can follow up.')
  const input = validateOutsideEvent({ ...record, published: false, needsReview: true })
  if (input.date < todayInNewYork()) throw new Error("Choose a date that hasn't passed.")
  return { input, email }
}

const columns = "outside_events.id, 'outside' AS kind, dance_groups.name AS groupName, title, date, lastDate, startTime, endTime, location, outside_events.city, styles, price, url, published, needsReview, updatedAt, sourceId IS NOT NULL AS fromFeed, sourceNote"

// D1 returns styles as JSON text and booleans as 0 or 1.
type Row = Omit<OutsideEvent, 'styles' | 'published' | 'needsReview' | 'fromFeed'> & { styles: string; published: number; needsReview: number; fromFeed: number }
const fromRow = (row: Row): OutsideEvent => ({ ...row, styles: JSON.parse(row.styles) as string[], published: row.published === 1, needsReview: row.needsReview === 1, fromFeed: Boolean(row.fromFeed) })

// Every event for the manager, or only published events from `from` on for /events.
export async function listOutsideEvents(db: D1Database, from?: string): Promise<OutsideEvent[]> {
  const query = from === undefined
    ? db.prepare(`SELECT ${columns} FROM outside_events JOIN dance_groups ON dance_groups.id = groupId ORDER BY date, startTime, title`)
    : db.prepare(`SELECT ${columns} FROM outside_events JOIN dance_groups ON dance_groups.id = groupId WHERE published = 1 AND COALESCE(NULLIF(lastDate, ''), date) >= ? ORDER BY date, startTime, title`).bind(from)
  return (await query.all<Row>()).results.map(fromRow)
}

export async function listGroupNames(db: D1Database): Promise<string[]> {
  return (await db.prepare('SELECT name FROM dance_groups ORDER BY name').all<{ name: string }>()).results.map(row => row.name)
}

// A group is added the first time an event names it; names match without regard to case.
export async function saveOutsideEvent(db: D1Database, id: string | null, input: OutsideEventInput, sourceNote = ''): Promise<OutsideEvent | null> {
  const updatedAt = new Date().toISOString()
  const eventId = id ?? crypto.randomUUID()
  const values = [input.title, input.date, input.startTime, input.endTime, input.location, input.city, JSON.stringify(input.styles), input.price, input.url, input.published ? 1 : 0, input.needsReview ? 1 : 0, updatedAt, input.lastDate, input.groupName, eventId]
  if (!id) values.push(sourceNote)
  const save = id
    ? db.prepare('UPDATE outside_events SET title = ?, date = ?, startTime = ?, endTime = ?, location = ?, city = ?, styles = ?, price = ?, url = ?, published = ?, needsReview = ?, updatedAt = ?, lastDate = ?, groupId = (SELECT id FROM dance_groups WHERE name = ?14) WHERE id = ?15')
    : db.prepare('INSERT INTO outside_events (title, date, startTime, endTime, location, city, styles, price, url, published, needsReview, updatedAt, lastDate, groupId, id, sourceNote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM dance_groups WHERE name = ?14), ?15, ?16)')
  const [, result] = await db.batch([
    db.prepare('INSERT INTO dance_groups (id, name) VALUES (?, ?) ON CONFLICT (name) DO NOTHING').bind(crypto.randomUUID(), input.groupName),
    save.bind(...values),
  ])
  if (!result.meta.changes) return null
  const saved = await db.prepare(`SELECT ${columns} FROM outside_events JOIN dance_groups ON dance_groups.id = groupId WHERE outside_events.id = ?`).bind(eventId).first<Row>()
  return saved && fromRow(saved)
}

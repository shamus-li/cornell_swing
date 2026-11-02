import { isValidDate, isValidTime, todayInNewYork } from './model'
import { isValidEmail } from '../lib/email'

// Dances run by other groups, shown on /events beside Swing Syndicate's own events.
export const danceStyles = ['Swing', 'Blues', 'West Coast Swing', 'Contra', 'English Country', 'Salsa', 'Tango', 'Ballroom', 'Line dancing', 'Other'] as const

export interface OutsideEvent {
  id: string
  groupName: string
  title: string
  date: string
  startTime: string
  endTime: string
  venue: string
  styles: string[]
  // Free text, such as "Students free · $15".
  price: string
  url: string
  status: 'review' | 'published' | 'hidden'
  updatedAt: string
  // Set for events read from the group's calendar feed, which hiding keeps off /events and deleting would bring back.
  fromFeed: boolean
  // Where an event from email came from, such as "Email from Contra Club, Oct 28: November dance".
  sourceNote: string
}

type OutsideEventInput = Omit<OutsideEvent, 'id' | 'updatedAt' | 'fromFeed' | 'sourceNote'>

export function validateOutsideEvent(value: unknown): OutsideEventInput {
  if (!value || typeof value !== 'object') throw new Error('Enter the event details.')
  const input = value as Record<string, unknown>
  const limits = { groupName: 120, title: 160, date: 10, startTime: 5, endTime: 5, venue: 300, price: 100, url: 2000 }
  const fields: Record<string, string> = {}
  for (const [key, limit] of Object.entries(limits)) {
    const field = input[key] ?? ''
    if (typeof field !== 'string' || field.length > limit) throw new Error(`Check the event ${key}.`)
    fields[key] = field.trim()
  }
  if (!fields.title) throw new Error('Enter an event title.')
  if (!fields.groupName) throw new Error('Enter the group running the event.')
  if (!isValidDate(fields.date)) throw new Error('Enter a valid event date.')
  for (const time of [fields.startTime, fields.endTime]) {
    if (time && !isValidTime(time)) throw new Error('Enter a valid event time.')
  }
  if (fields.endTime && !fields.startTime) throw new Error('Enter a start time before adding an end time.')
  if (fields.endTime && fields.endTime <= fields.startTime) throw new Error('The end time must be after the start time on the same day.')
  const styles = Array.isArray(input.styles) ? input.styles : []
  if (!styles.length || !styles.every(style => (danceStyles as readonly unknown[]).includes(style))) throw new Error('Choose a dance style.')
  if (fields.url) {
    let url: URL | undefined
    try { url = new URL(fields.url) } catch { /* reported below */ }
    if (url?.protocol !== 'https:') throw new Error('Enter a link that starts with https://.')
  }
  if (input.status !== 'published' && input.status !== 'hidden' && input.status !== 'review') throw new Error('Choose whether the event is published.')
  return { groupName: fields.groupName, title: fields.title, date: fields.date, startTime: fields.startTime, endTime: fields.endTime, venue: fields.venue, styles: danceStyles.filter(style => styles.includes(style)), price: fields.price, url: fields.url, status: input.status }
}

// A visitor's request from /events, which waits for an organizer's review.
export function validateEventRequest(value: unknown): { input: OutsideEventInput; email: string } {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const email = typeof record.email === 'string' ? record.email.trim() : ''
  if (!isValidEmail(email)) throw new Error('Enter your email so an organizer can follow up.')
  const input = validateOutsideEvent({ ...record, status: 'review' })
  if (input.date < todayInNewYork()) throw new Error("Choose a date that hasn't passed.")
  return { input, email }
}

const columns = 'outside_events.id, dance_groups.name AS groupName, title, date, startTime, endTime, venue, styles, price, url, status, updatedAt, sourceId IS NOT NULL AS fromFeed, sourceNote'

// D1 returns styles as JSON text and the SQL comparison behind fromFeed as 0 or 1.
type Row = Omit<OutsideEvent, 'styles' | 'fromFeed'> & { styles: string; fromFeed: number }
const fromRow = (row: Row): OutsideEvent => ({ ...row, styles: JSON.parse(row.styles) as string[], fromFeed: Boolean(row.fromFeed) })

// Every event for the manager, or only published events from `from` on for /events.
export async function listOutsideEvents(db: D1Database, from?: string): Promise<OutsideEvent[]> {
  const query = from === undefined
    ? db.prepare(`SELECT ${columns} FROM outside_events JOIN dance_groups ON dance_groups.id = groupId ORDER BY date, startTime, title`)
    : db.prepare(`SELECT ${columns} FROM outside_events JOIN dance_groups ON dance_groups.id = groupId WHERE status = 'published' AND date >= ? ORDER BY date, startTime, title`).bind(from)
  return (await query.all<Row>()).results.map(fromRow)
}

export async function listGroupNames(db: D1Database): Promise<string[]> {
  return (await db.prepare('SELECT name FROM dance_groups ORDER BY name').all<{ name: string }>()).results.map(row => row.name)
}

// A group is added the first time an event names it; names match without regard to case.
export async function saveOutsideEvent(db: D1Database, id: string | null, input: OutsideEventInput, sourceNote = ''): Promise<OutsideEvent | null> {
  const updatedAt = new Date().toISOString()
  const eventId = id ?? crypto.randomUUID()
  const values = [input.title, input.date, input.startTime, input.endTime, input.venue, JSON.stringify(input.styles), input.price, input.url, input.status, updatedAt, input.groupName, eventId]
  if (!id) values.push(sourceNote)
  const save = id
    ? db.prepare('UPDATE outside_events SET title = ?, date = ?, startTime = ?, endTime = ?, venue = ?, styles = ?, price = ?, url = ?, status = ?, updatedAt = ?, groupId = (SELECT id FROM dance_groups WHERE name = ?11) WHERE id = ?12')
    : db.prepare('INSERT INTO outside_events (title, date, startTime, endTime, venue, styles, price, url, status, updatedAt, groupId, id, sourceNote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM dance_groups WHERE name = ?11), ?12, ?13)')
  const [, result] = await db.batch([
    db.prepare('INSERT INTO dance_groups (id, name) VALUES (?, ?) ON CONFLICT (name) DO NOTHING').bind(crypto.randomUUID(), input.groupName),
    save.bind(...values),
  ])
  if (!result.meta.changes) return null
  const saved = await db.prepare(`SELECT ${columns} FROM outside_events JOIN dance_groups ON dance_groups.id = groupId WHERE outside_events.id = ?`).bind(eventId).first<Row>()
  return saved && fromRow(saved)
}

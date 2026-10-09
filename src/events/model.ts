import { isValidEmail } from '../lib/email'

type EventKind = 'normal' | 'special'

export interface EventRecord {
  id: string
  kind: EventKind
  title: string
  date: string
  startTime: string
  endTime: string
  location: string
  locationUrl?: string
  room?: string
  description: string
  published: boolean
  updatedAt: string
}

type EventInput = Omit<EventRecord, 'id' | 'updatedAt'>
export type ManagedEvent = EventRecord & { rsvpCount: number }
export interface RSVP { name: string; email: string; createdAt: string }

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
export const todayInNewYork = (now = new Date()) => dateFormatter.format(now)
// Formats 24-hour HH:MM as "8:00 PM".
export function formatTime(time: string): string {
  const [hour, minute] = time.split(':')
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? 'AM' : 'PM'}`
}
// "8:00–10:00 PM", naming AM or PM once unless the range crosses noon.
export function formatEventTime({ startTime, endTime }: Pick<EventRecord, 'startTime' | 'endTime'>): string {
  if (!startTime) return 'TBA'
  if (!endTime) return formatTime(startTime)
  const start = formatTime(startTime)
  const end = formatTime(endTime)
  return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`
}
// Formats a YYYY-MM-DD date, e.g. { month: 'short' } gives "Oct". Dates have no time zone, so UTC keeps the day fixed.
export const formatEventDate = (date: string, options: Intl.DateTimeFormatOptions) => date ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`)) : 'TBA'

// RSVPs open once people know when and where to show up.
export const hasEventDetails = (event: Pick<EventRecord, 'startTime' | 'location' | 'room'>) => Boolean(event.startTime && (event.location || event.room))

// Names the semester of the next weekly lesson, or of the last one once the semester ends.
export function scheduleTitle(events: Pick<EventRecord, 'kind' | 'date'>[], today: string): string {
  const dates = events.filter(event => event.kind === 'normal' && event.date).map(event => event.date).sort()
  const date = dates.find(value => value >= today) ?? dates.at(-1)
  if (!date) return 'Schedule'
  const month = Number(date.slice(5, 7))
  return `${month <= 5 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall'} ${date.slice(0, 4)} schedule`
}

export function formatEventLocation(event: Pick<EventRecord, 'location' | 'room'>): string {
  return [event.room, event.location].filter(Boolean).join(', ') || 'TBA'
}

export function validateEvent(value: unknown): EventInput {
  if (!value || typeof value !== 'object') throw new Error('Enter the event details.')
  const input = value as Record<string, unknown>
  const limits = { title: 160, date: 10, startTime: 5, endTime: 5, location: 300, description: 20000 }
  const fields: Record<string, string> = {}
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new Error(`Check the event ${key}.`)
    fields[key] = input[key].trim()
  }
  if (!fields.title) throw new Error('Enter an event title.')
  if (input.kind !== 'normal' && input.kind !== 'special') throw new Error('Choose a normal or special event.')
  if (typeof input.published !== 'boolean') throw new Error('Choose whether the event is published.')
  if ((fields.date || input.kind === 'normal') && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(Date.parse(fields.date)) || new Date(fields.date).toISOString().slice(0, 10) !== fields.date)) throw new Error('Enter a valid event date.')
  for (const time of [fields.startTime, fields.endTime]) {
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid event time.')
  }
  if (fields.endTime && !fields.startTime) throw new Error('Enter a start time before adding an end time.')
  if (fields.endTime && fields.endTime <= fields.startTime) throw new Error('The end time must be after the start time on the same day.')
  if (input.room !== undefined && (typeof input.room !== 'string' || input.room.length > 300)) throw new Error('Enter room details up to 300 characters.')
  const room = typeof input.room === 'string' ? input.room.trim() : ''
  const locationUrl = typeof input.locationUrl === 'string' ? input.locationUrl.trim() : ''
  if (locationUrl) {
    let url: URL
    try { url = new URL(locationUrl) } catch { throw new Error('Enter a valid Google Maps link.') }
    if (locationUrl.length > 2000 || url.protocol !== 'https:' || url.hostname !== 'www.google.com' || url.pathname !== '/maps/search/' || url.username || url.password || url.port) throw new Error('Enter a valid Google Maps link.')
  }
  return { room, locationUrl, kind: input.kind, published: input.published, title: fields.title, date: fields.date, startTime: fields.startTime, endTime: fields.endTime, location: fields.location, description: fields.description }
}

export function validateRSVP(value: unknown): { name: string; email: string } {
  if (!value || typeof value !== 'object') throw new Error('Enter your name and email.')
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!name || name.length > 120 || /[\r\n\x00-\x1f]/.test(name)) throw new Error('Enter your name (up to 120 characters).')
  if (!isValidEmail(email)) throw new Error('Enter a valid email address.')
  return { name, email }
}

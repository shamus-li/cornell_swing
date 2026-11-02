import { isValidEmail } from '../lib/email'

type EventKind = 'normal' | 'special'

export interface EventRecord {
  id: string
  // The event's address, /events/slug; set when the event is saved.
  slug?: string | null
  kind: EventKind
  title: string
  date: string
  startTime: string
  endTime: string
  // Weekly lessons only: the lesson runs from startTime to lessonEndTime and the social dance from socialStartTime to endTime, and they may overlap.
  // Both are empty when the night is all social dance, from startTime to endTime.
  lessonEndTime?: string
  socialStartTime?: string
  location: string
  locationUrl?: string
  room?: string
  // Ticket prices in dollars, like "5" or "7.50"; empty when not announced.
  studentPrice?: string
  generalPrice?: string
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
// The lesson and social dance in the order they start, or only the social dance on nights without a lesson.
export function lessonSchedule({ startTime, endTime, lessonEndTime, socialStartTime }: Pick<EventRecord, 'startTime' | 'endTime' | 'lessonEndTime' | 'socialStartTime'>): { kind: 'lesson' | 'social'; text: string }[] {
  const social = { kind: 'social' as const, text: `Social dance ${formatEventTime({ startTime: socialStartTime || startTime, endTime })}` }
  if (!lessonEndTime) return [social]
  const lesson = { kind: 'lesson' as const, text: `Lesson ${formatEventTime({ startTime, endTime: lessonEndTime })}` }
  return socialStartTime! < startTime ? [social, lesson] : [lesson, social]
}
// ["Lesson 8:00–9:00 PM", "Social dance 9:00–10:00 PM"]
export const formatLessonSchedule = (event: Parameters<typeof lessonSchedule>[0]) => lessonSchedule(event).map(part => part.text)
// A weekly night runs from whichever of the lesson and social dance starts first until whichever ends last.
export function nightSpan({ startTime, endTime, lessonEndTime, socialStartTime }: Pick<EventRecord, 'startTime' | 'endTime' | 'lessonEndTime' | 'socialStartTime'>): Pick<EventRecord, 'startTime' | 'endTime'> {
  return {
    startTime: socialStartTime && socialStartTime < startTime ? socialStartTime : startTime,
    endTime: endTime && lessonEndTime && lessonEndTime > endTime ? lessonEndTime : endTime,
  }
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

const formatPrice = (price: string, who: string) => Number(price) === 0 ? `Free for ${who}` : `$${Number(price).toFixed(Number.isInteger(Number(price)) ? 0 : 2)} ${who}`
// ["$5 students", "$10 general"], leaving out prices that are not set; ["Free"] when both are free.
export function formatEventPrices({ studentPrice, generalPrice }: Pick<EventRecord, 'studentPrice' | 'generalPrice'>): string[] {
  if (studentPrice && generalPrice && Number(studentPrice) === 0 && Number(generalPrice) === 0) return ['Free']
  return [studentPrice && formatPrice(studentPrice, 'students'), generalPrice && formatPrice(generalPrice, 'general')].filter((price): price is string => !!price)
}
// Up to $999.99, without leading zeros or more than two decimal places; empty when not announced.
// A Google Maps search for a place in upstate New York.
export const mapsSearchUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, NY`)}`

export const isValidPrice = (price: string) => /^((0|[1-9]\d{0,2})(\.\d{1,2})?)?$/.test(price)
// A real YYYY-MM-DD date, and a 24-hour HH:MM time.
export const isValidDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
export const isValidTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)

export function validateEvent(value: unknown): EventInput {
  if (!value || typeof value !== 'object') throw new Error('Enter the event details.')
  const input = value as Record<string, unknown>
  const limits = { title: 160, date: 10, startTime: 5, endTime: 5, location: 300, description: 20000 }
  const fields: Record<string, string> = {}
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new Error(key === 'description' && input.kind === 'normal' ? 'Notes can be up to 20,000 characters.' : `Check the event ${key}.`)
    fields[key] = input[key].trim()
  }
  if (!fields.title) throw new Error('Enter an event title.')
  if (input.kind !== 'normal' && input.kind !== 'special') throw new Error('Choose a normal or special event.')
  if (typeof input.published !== 'boolean') throw new Error('Choose whether the event is published.')
  if ((fields.date || input.kind === 'normal') && !isValidDate(fields.date)) throw new Error('Enter a valid event date.')
  for (const time of [fields.startTime, fields.endTime]) {
    if (time && !isValidTime(time)) throw new Error('Enter a valid event time.')
  }
  const lessonEndTime = input.kind === 'normal' && typeof input.lessonEndTime === 'string' ? input.lessonEndTime.trim() : ''
  const socialStartTime = lessonEndTime && typeof input.socialStartTime === 'string' ? input.socialStartTime.trim() : ''
  if (input.kind === 'normal') {
    if (lessonEndTime) {
      if (!fields.startTime) throw new Error('Enter when the lesson starts.')
      if (!isValidTime(lessonEndTime)) throw new Error('Enter a valid lesson end time.')
      if (lessonEndTime <= fields.startTime) throw new Error('The lesson must end after it starts.')
      if (socialStartTime && !isValidTime(socialStartTime)) throw new Error('Enter a valid social dance start time.')
    }
    const socialStart = lessonEndTime ? socialStartTime : fields.startTime
    if (!socialStart && (lessonEndTime || fields.endTime)) throw new Error('Enter when the social dance starts.')
    if (fields.endTime && fields.endTime <= socialStart) throw new Error('The social dance must end after it starts.')
  } else {
    if (fields.endTime && !fields.startTime) throw new Error('Enter a start time before adding an end time.')
    if (fields.endTime && fields.endTime <= fields.startTime) throw new Error('The end time must be after the start time on the same day.')
  }
  if (input.room !== undefined && (typeof input.room !== 'string' || input.room.length > 300)) throw new Error('Enter room details up to 300 characters.')
  const room = typeof input.room === 'string' ? input.room.trim() : ''
  const prices = { studentPrice: '', generalPrice: '' }
  for (const key of ['studentPrice', 'generalPrice'] as const) {
    const price = input[key] ?? ''
    if (typeof price !== 'string' || !isValidPrice(price.trim())) throw new Error('Enter ticket prices in dollars up to $999.99, like 5 or 7.50.')
    prices[key] = price.trim()
  }
  const locationUrl = typeof input.locationUrl === 'string' ? input.locationUrl.trim() : ''
  if (locationUrl) {
    let url: URL
    try { url = new URL(locationUrl) } catch { throw new Error('Enter a valid Google Maps link.') }
    if (locationUrl.length > 2000 || url.protocol !== 'https:' || url.hostname !== 'www.google.com' || url.pathname !== '/maps/search/' || url.username || url.password || url.port) throw new Error('Enter a valid Google Maps link.')
  }
  return { room, locationUrl, ...prices, lessonEndTime, socialStartTime, kind: input.kind, published: input.published, title: fields.title, date: fields.date, startTime: fields.startTime, endTime: fields.endTime, location: fields.location, description: fields.description }
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

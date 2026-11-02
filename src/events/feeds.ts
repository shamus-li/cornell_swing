import { Buffer } from 'node:buffer'
import { logError } from './logging'
import { danceStyles } from './outside'
import { todayInNewYork } from './model'

// Reads other groups' calendar feeds into outside_events every six hours, and when an organizer saves a feed.
export const FEEDS_CRON = '15 */6 * * *'
// Every Cornell club's events in one file of about 5 MB; each CampusGroups feed keeps one club's events from it.
const campusGroupsCalendar = 'https://cornell.campusgroups.com/ical/cornell/ical_cornell.ics'

export interface DanceFeed { id: string; name: string; style: string; feedUrl: string; skipTitles: string; checkedAt: string | null; feedError: string | null }
type FeedEvent = { sourceId: string; title: string; date: string; startTime: string; endTime: string; venue: string; url: string }
// A problem the organizer can fix, shown with the feed in /manage.
class FeedError extends Error {}
type SquarespaceEvents = { upcoming?: { id: string; title: string; startDate: number; endDate: number; fullUrl: string; location?: { addressTitle?: string } }[] }

export function validateFeed(value: unknown): Omit<DanceFeed, 'id' | 'checkedAt' | 'feedError'> {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const text = (key: string, limit: number) => typeof input[key] === 'string' && input[key].length <= limit ? input[key].trim() : ''
  const feed = { name: text('name', 120), style: text('style', 40), feedUrl: text('feedUrl', 2000), skipTitles: text('skipTitles', 300) }
  if (!feed.name) throw new Error('Enter the group name.')
  if (!(danceStyles as readonly string[]).includes(feed.style)) throw new Error('Choose a dance style.')
  let url: URL | undefined
  try { url = new URL(feed.feedUrl) } catch { /* reported below */ }
  if (url?.protocol !== 'https:') throw new Error('Enter a calendar link that starts with https://.')
  return feed
}

export const campusGroupsClub = (feedUrl: string) => {
  const url = new URL(feedUrl)
  return url.hostname === 'cornell.campusgroups.com' ? url.pathname.split('/')[1]?.toUpperCase() || null : null
}

const clock = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function inNewYork(ms: number) {
  const part = Object.fromEntries(clock.formatToParts(ms).map(({ type, value }) => [type, value]))
  return { date: `${part.year}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}` }
}

// Keeps the end time only when it falls later on the same day, as the editor requires.
const sameDayEnd = (start: { date: string; time: string }, end: { date: string; time: string } | null) => end && start.time && end.date === start.date && end.time > start.time ? end.time : ''

const decode = (text: string) => text.replace(/\\([,;\\nN])/g, (_, c: string) => c.toLowerCase() === 'n' ? ' ' : c)
  .replace(/&(amp|quot|#(\d+));/g, (_, name: string, code?: string) => code ? String.fromCodePoint(Number(code)) : name === 'amp' ? '&' : '"')
  .replace(/\s+/g, ' ').trim()

// "TreeHouse Studio, 119 S Cayuga St, Ithaca, NY, 14850, United States" becomes "TreeHouse Studio, 119 S Cayuga St".
function shortVenue(location: string) {
  if (/sign in/i.test(location)) return ''
  const parts = location.split(',').map(part => part.trim())
  const cityAt = parts.findIndex(part => /^(ithaca|new york|ny|united states|\d{5})\b/i.test(part))
  return parts.slice(0, cityAt === -1 ? undefined : cityAt).filter(Boolean).join(', ')
}

// Times with a time zone other than UTC are taken as Ithaca time, which every feed here uses.
function icsTime(value: string | undefined) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/)
  if (!match) return null
  const [, year, month, day, hour, minute, utc] = match
  if (utc) return inNewYork(Date.UTC(+year, +month - 1, +day, +hour, +minute))
  return { date: `${year}-${month}-${day}`, time: hour ? `${hour}:${minute}` : '' }
}

// Repeating events are skipped; none of the feeds read so far use them.
export function icsEvents(text: string): FeedEvent[] {
  return text.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1).flatMap(block => {
    const props = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/)
      if (match && !props.has(match[1])) props.set(match[1], match[2])
    }
    const start = icsTime(props.get('DTSTART'))
    const uid = props.get('UID')
    if (!start || !uid || props.get('RRULE')) return []
    return [{ sourceId: uid, title: decode(props.get('SUMMARY') ?? '').slice(0, 160), date: start.date, startTime: start.time, endTime: sameDayEnd(start, icsTime(props.get('DTEND'))), venue: shortVenue(decode(props.get('LOCATION') ?? '')).slice(0, 300), url: props.get('URL') ?? '' }]
  }).filter(event => event.title)
}

function squarespaceEvents(data: SquarespaceEvents, origin: string): FeedEvent[] {
  return (data.upcoming ?? []).map(event => {
    const start = inNewYork(event.startDate)
    return { sourceId: event.id, title: decode(event.title).slice(0, 160), date: start.date, startTime: start.time, endTime: sameDayEnd(start, inNewYork(event.endDate)), venue: decode(event.location?.addressTitle ?? '').slice(0, 300), url: new URL(event.fullUrl, origin).href }
  })
}

// Finds each wanted club's public events by searching the raw bytes, so only those few events are decoded.
function campusGroupsEvents(calendar: ArrayBuffer, clubs: Set<string>): Map<string, FeedEvent[]> {
  const bytes = Buffer.from(calendar)
  const blocks = new Map<string, string[]>()
  const key = 'club_acronym:'
  for (let at = bytes.indexOf(key); at !== -1; at = bytes.indexOf(key, at + key.length)) {
    const club = bytes.toString('latin1', at + key.length, bytes.indexOf('\n', at)).trim()
    if (!clubs.has(club)) continue
    const block = bytes.toString('utf8', bytes.lastIndexOf('BEGIN:VEVENT', at), bytes.indexOf('END:VEVENT', at))
    if (!block.includes('event_type:Private')) blocks.set(club, [...blocks.get(club) ?? [], block])
  }
  return new Map([...clubs].map(club => [club, icsEvents((blocks.get(club) ?? []).join('\n'))]))
}

async function download(url: string) {
  // Squarespace refuses requests that don't name themselves.
  const response = await fetch(url, { headers: { 'User-Agent': 'swingsyndicate.club calendar reader (+https://swingsyndicate.club/events)' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new FeedError(`The calendar link returned an error (${response.status}).`)
  return response
}

async function feedEvents(feedUrl: string): Promise<FeedEvent[]> {
  const text = await (await download(feedUrl)).text()
  if (text.trimStart().startsWith('BEGIN:VCALENDAR')) return icsEvents(text)
  let data: SquarespaceEvents | undefined
  try { data = JSON.parse(text) as SquarespaceEvents } catch { /* reported below */ }
  if (!Array.isArray(data?.upcoming)) throw new FeedError("The link isn't a calendar feed.")
  return squarespaceEvents(data, new URL(feedUrl).origin)
}

// Adds and updates the feed's upcoming events and removes upcoming ones the feed dropped. Events an organizer hid
// stay hidden, and a venue typed in for an event the feed lists without one is kept.
function saveEvents(db: D1Database, feed: DanceFeed, events: FeedEvent[], today: string, checkedAt: string) {
  const skip = feed.skipTitles.toLowerCase().split(',').map(word => word.trim()).filter(Boolean)
  const kept = events.filter(event => event.date >= today && !skip.some(word => event.title.toLowerCase().includes(word)))
  const rows = JSON.stringify(kept)
  return db.batch([
    db.prepare(`INSERT INTO outside_events (id, groupId, sourceId, title, date, startTime, endTime, venue, styles, url, status, updatedAt)
      SELECT lower(hex(randomblob(16))), ?1, value ->> 'sourceId', value ->> 'title', value ->> 'date', value ->> 'startTime', value ->> 'endTime', value ->> 'venue', json_array(?2), value ->> 'url', 'published', ?3 FROM json_each(?4) WHERE true
      ON CONFLICT (groupId, sourceId) DO UPDATE SET title = excluded.title, date = excluded.date, startTime = excluded.startTime, endTime = excluded.endTime,
        venue = CASE excluded.venue WHEN '' THEN venue ELSE excluded.venue END, url = excluded.url, updatedAt = excluded.updatedAt`).bind(feed.id, feed.style, checkedAt, rows),
    db.prepare(`DELETE FROM outside_events WHERE groupId = ? AND sourceId IS NOT NULL AND date >= ? AND sourceId NOT IN (SELECT value ->> 'sourceId' FROM json_each(?))`).bind(feed.id, today, rows),
    db.prepare('UPDATE dance_groups SET checkedAt = ?, feedError = NULL WHERE id = ?').bind(checkedAt, feed.id),
  ])
}

export async function listFeeds(db: D1Database, id?: string): Promise<DanceFeed[]> {
  const query = 'SELECT id, name, style, feedUrl, skipTitles, checkedAt, feedError FROM dance_groups WHERE feedUrl != \'\''
  return (await (id ? db.prepare(`${query} AND id = ?`).bind(id) : db.prepare(`${query} ORDER BY name`)).all<DanceFeed>()).results
}

// Reads every feed, or only the group `id`. A feed that fails keeps its events and records the problem for /manage.
export async function readFeeds(env: Env, id?: string): Promise<void> {
  const feeds = await listFeeds(env.EVENTS_DB, id)
  const today = todayInNewYork()
  const clubs = new Set(feeds.map(feed => campusGroupsClub(feed.feedUrl)).filter(club => club !== null))
  const campusGroups = clubs.size ? download(campusGroupsCalendar).then(async response => campusGroupsEvents(await response.arrayBuffer(), clubs)) : null
  await Promise.all(feeds.map(async feed => {
    const checkedAt = new Date().toISOString()
    try {
      const club = campusGroupsClub(feed.feedUrl)
      await saveEvents(env.EVENTS_DB, feed, club ? (await campusGroups!).get(club)! : await feedEvents(feed.feedUrl), today, checkedAt)
    } catch (error) {
      logError(`Dance feed ${feed.name} failed`, error)
      const message = error instanceof FeedError ? error.message : 'The calendar link could not be read.'
      await env.EVENTS_DB.prepare('UPDATE dance_groups SET checkedAt = ?, feedError = ? WHERE id = ?').bind(checkedAt, message, feed.id).run()
    }
  }))
}

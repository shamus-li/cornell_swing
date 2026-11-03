import { Buffer } from 'node:buffer'
import { logError } from './logging'
import { danceStyles, todayInNewYork } from './model'

// Reads other groups' calendar feeds into outside_events every six hours, and when an organizer saves a feed.
export const FEEDS_CRON = '15 */6 * * *'
// Every Cornell club's events in one file of about 5 MB; each CampusGroups feed keeps one club's events from it.
const campusGroupsCalendar = 'https://cornell.campusgroups.com/ical/cornell/ical_cornell.ics'

export interface DanceFeed { id: string; name: string; style: string; city: string; siteUrl: string; feedUrl: string; skipTitles: string; checkedAt: string | null; feedError: string | null }
type FeedEvent = { sourceId: string; title: string; date: string; startTime: string; endTime: string; location: string; city: string; url: string }
// A problem the organizer can fix, shown with the feed in /manage.
class FeedError extends Error {}
type SquarespaceEvents = { upcoming?: { id: string; title: string; startDate: number; endDate: number; fullUrl: string; location?: { addressTitle?: string; addressLine2?: string } }[] }

export function validateFeed(value: unknown): Omit<DanceFeed, 'id' | 'checkedAt' | 'feedError'> {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const text = (key: string, limit: number) => typeof input[key] === 'string' && input[key].length <= limit ? input[key].trim() : ''
  const feed = { name: text('name', 120), style: text('style', 40), city: text('city', 80) || 'Ithaca', siteUrl: text('siteUrl', 2000), feedUrl: text('feedUrl', 2000), skipTitles: text('skipTitles', 300) }
  if (!feed.name) throw new Error('Enter the group name.')
  if (!(danceStyles as readonly string[]).includes(feed.style)) throw new Error('Choose a dance style.')
  let url: URL | undefined
  try { url = new URL(feed.feedUrl) } catch { /* reported below */ }
  if (url?.protocol !== 'https:') throw new Error('Enter a calendar link that starts with https://.')
  if (feed.siteUrl && !feed.siteUrl.startsWith('https://')) throw new Error('Enter a website that starts with https://.')
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

// "TreeHouse Studio, 119 S Cayuga St, Ithaca, NY, 14850, United States" is that place in Ithaca. A location with no
// recognizable state leaves the city empty, which means the group's own city.
function place(text: string) {
  if (/sign in/i.test(text)) return { location: '', city: '' }
  const parts = text.split(',').map(part => part.trim()).filter(Boolean)
  const state = parts.findIndex(part => /^(ny|new york)\b/i.test(part))
  if (state > 0) return { location: parts.slice(0, state - 1).join(', ').slice(0, 300), city: parts[state - 1].slice(0, 80) }
  return { location: parts.filter(part => !/^(united states|usa|\d{5})\b/i.test(part)).join(', ').slice(0, 300), city: '' }
}

// Times with a time zone other than UTC are taken as Ithaca time, which every feed here uses.
function icsTime(value: string | undefined) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/)
  if (!match) return null
  const [, year, month, day, hour, minute, utc] = match
  if (utc) return inNewYork(Date.UTC(+year, +month - 1, +day, +hour, +minute))
  // Some calendars write an all-day event as starting at midnight.
  return { date: `${year}-${month}-${day}`, time: hour && `${hour}:${minute}` !== '00:00' ? `${hour}:${minute}` : '' }
}

// The dates a weekly series falls on, from its start through the next 12 weeks. Other kinds of repeat are left out;
// none of the current series use them.
function repeatDates(rule: string, start: string, skipped: string[]): string[] {
  const part = (name: string) => rule.match(new RegExp(`(?:^|;)${name}=([^;]+)`))?.[1]
  if (part('FREQ') !== 'WEEKLY') return []
  const step = 7 * Number(part('INTERVAL') ?? 1)
  const count = Number(part('COUNT') ?? Infinity)
  const until = icsTime(part('UNTIL'))?.date ?? '9999'
  const horizon = new Date(`${todayInNewYork()}T00:00:00Z`).getTime() + 84 * 86_400_000
  const dates: string[] = []
  for (let time = new Date(`${start}T00:00:00Z`).getTime(), n = 0; n < count && time <= horizon; time += step * 86_400_000, n++) {
    const date = new Date(time).toISOString().slice(0, 10)
    if (date > until) break
    if (!skipped.includes(date)) dates.push(date)
  }
  return dates
}

// Each date of a series gets its own id. A changed or cancelled date arrives as its own entry naming the date it replaces.
export function icsEvents(text: string): FeedEvent[] {
  const found = new Map<string, FeedEvent>()
  const replacements: (() => void)[] = []
  for (const block of text.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)) {
    const props = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/)
      if (match && !props.has(match[1])) props.set(match[1], match[2])
    }
    const start = icsTime(props.get('DTSTART'))
    const uid = props.get('UID')
    // Some calendars pack the caller and band into the title after a comma.
    const title = decode(props.get('SUMMARY') ?? '').replace(/,.*\b(callers?|music)\b.*$/i, '').slice(0, 160)
    if (!start || !uid || !title) continue
    const event = { sourceId: uid, title, date: start.date, startTime: start.time, endTime: sameDayEnd(start, icsTime(props.get('DTEND'))), ...place(decode(props.get('LOCATION') ?? '')), url: props.get('URL') ?? '' }
    const cancelled = props.get('STATUS') === 'CANCELLED'
    const rule = props.get('RRULE')
    const replaced = icsTime(props.get('RECURRENCE-ID'))
    if (replaced) {
      const sourceId = `${uid}:${replaced.date}`
      replacements.push(() => { if (cancelled) found.delete(sourceId); else found.set(sourceId, { ...event, sourceId }) })
    } else if (rule) {
      const skipped = [...block.matchAll(/^EXDATE[^:]*:(.*)$/gm)].flatMap(match => match[1].trim().split(',')).flatMap(value => icsTime(value)?.date ?? [])
      for (const date of repeatDates(rule, start.date, skipped)) found.set(`${uid}:${date}`, { ...event, sourceId: `${uid}:${date}`, date })
    } else if (!cancelled) found.set(uid, event)
  }
  for (const replace of replacements) replace()
  return [...found.values()]
}

function squarespaceEvents(data: SquarespaceEvents, origin: string): FeedEvent[] {
  return (data.upcoming ?? []).map(event => {
    const start = inNewYork(event.startDate)
    return { sourceId: event.id, title: decode(event.title).slice(0, 160), date: start.date, startTime: start.time, endTime: sameDayEnd(start, inNewYork(event.endDate)), location: decode(event.location?.addressTitle ?? '').slice(0, 300), city: event.location?.addressLine2?.match(/^(.+?),?\s+(NY|New York)\b/i)?.[1].trim() ?? '', url: new URL(event.fullUrl, origin).href }
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

// The styles a title names, such as both for "Contra and Swing"; otherwise the group's usual style.
const styleWords: [string, RegExp][] = [['Swing', /swing|lindy|balboa/i], ['Blues', /blues/i], ['West Coast Swing', /west coast|westie|\bwcs\b/i], ['Contra', /contra/i], ['Square', /square/i], ['English Country', /english/i], ['Salsa', /salsa|bachata/i], ['Tango', /tango|milonga/i], ['Ballroom', /ballroom/i], ['Line dancing', /line danc/i]]
function stylesFrom(title: string, usual: string) {
  const named = styleWords.filter(([, words]) => words.test(title)).map(([style]) => style)
  return named.length ? danceStyles.filter(style => named.includes(style)) : [usual]
}

// Adds and updates the feed's upcoming events and removes upcoming ones the feed dropped. Events an organizer hid
// stay unpublished, and a place typed in for an event the feed lists without one is kept.
function saveEvents(db: D1Database, feed: DanceFeed, events: FeedEvent[], today: string, checkedAt: string) {
  const skip = feed.skipTitles.toLowerCase().split(',').map(word => word.trim()).filter(Boolean)
  const kept = events.filter(event => event.date >= today && !skip.some(word => event.title.toLowerCase().includes(word)))
  const rows = JSON.stringify(kept.map(event => ({ ...event, url: event.url || feed.siteUrl, styles: JSON.stringify(stylesFrom(event.title, feed.style)) })))
  return db.batch([
    db.prepare(`INSERT INTO outside_events (id, groupId, sourceId, title, date, startTime, endTime, location, city, styles, url, published, updatedAt)
      SELECT lower(hex(randomblob(16))), ?1, value ->> 'sourceId', value ->> 'title', value ->> 'date', value ->> 'startTime', value ->> 'endTime', value ->> 'location', iif(value ->> 'city' = '', ?2, value ->> 'city'), value ->> 'styles', value ->> 'url', 1, ?3 FROM json_each(?4) WHERE true
      ON CONFLICT (groupId, sourceId) DO UPDATE SET title = excluded.title, date = excluded.date, startTime = excluded.startTime, endTime = excluded.endTime,
        location = CASE excluded.location WHEN '' THEN location ELSE excluded.location END, city = CASE excluded.location WHEN '' THEN outside_events.city ELSE excluded.city END, url = excluded.url, updatedAt = excluded.updatedAt`).bind(feed.id, feed.city, checkedAt, rows),
    db.prepare(`DELETE FROM outside_events WHERE groupId = ? AND sourceId IS NOT NULL AND date >= ? AND sourceId NOT IN (SELECT value ->> 'sourceId' FROM json_each(?))`).bind(feed.id, today, rows),
    db.prepare('UPDATE dance_groups SET checkedAt = ?, feedError = NULL WHERE id = ?').bind(checkedAt, feed.id),
  ])
}

export async function listFeeds(db: D1Database, id?: string): Promise<DanceFeed[]> {
  const query = 'SELECT id, name, style, city, siteUrl, feedUrl, skipTitles, checkedAt, feedError FROM dance_groups WHERE feedUrl != \'\''
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

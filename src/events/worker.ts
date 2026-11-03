import { handleLocationSearch } from './locations'
import { logError } from './logging'
import { getSheetStatus, linkSheet, disconnectSheet, importSheet, saveRSVP, removeRSVP, changeEventWithSheet, createEventWithSheet, EventConflict, SheetError } from './sheets'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { EventSections, NextEvent } from '../site/components/Events'
import { createRedirect, deleteRedirect, listRedirects, RedirectError, updateRedirect } from '../redirects/cloudflare'
import { isRecord, parseRedirect } from '../redirects/redirect'
import { alertEmailStatus, AlertEmailError, saveAlertEmail, sendAlert } from './alert-email'
import { isValidEmail } from '../lib/email'
import { buildCampusGroups, campusGroupsKey, summarizeCampusGroups, type CampusGroupsData } from './campusgroups'
import { academicYearStart, formatEventDate, formatEventLocation, formatEventTime, formatLessonSchedule, hasEventDetails, isUpcoming, todayInNewYork, validateEvent, validateRSVP, type EventRecord, type ManagedEvent, type RSVP } from './model'
import { connectSquare, disconnectSquare, squareConnectUrl, squareFeed } from './square'
import { eventActivity, financeOverview, saveCampusGroupsTransactions } from './finance-data'
import { listGroupNames, listOutsideEvents, saveOutsideEvent, validateEventRequest, validateOutsideEvent } from './outside'
import { listFeeds, readFeeds, validateFeed } from './feeds'
import { assignSlug } from './slugs'
import { EventPage } from '../site/EventPage'
import { DancesPage, type DanceSnapshot } from '../site/DancesPage'

// `code` lets the manager tell specific failures apart, such as "stale" for an event saved elsewhere since it was opened.
class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message) }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function readBody(request: Request, limit = 90000): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Send JSON event details.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Enter the required details.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'The request is too large.') }
    chunks.push(value)
  }
  const buffer = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(buffer)) }
  catch { throw new HttpError(400, 'Enter valid JSON details.') }
}

let managerKeys: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined

async function requireManager(request: Request, env: Env, path: string): Promise<void> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(503, 'Manager sign-in is not configured.')
  const signIn = `Sign in to manage ${path.startsWith('/redirects') ? 'redirects' : 'events'}.`
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) throw new HttpError(401, signIn)
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`
    if (managerKeys?.issuer !== issuer) managerKeys = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)) }
    await jwtVerify(token, managerKeys.keys, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] })
  } catch { throw new HttpError(401, signIn) }
}

const newsletterParts = ['practice', 'involved', 'signoff', 'footer']
const managerPage = (path: string) => ['/manage', '/redirects'].some(page => path === page || path.startsWith(`${page}/`))

async function redirectsApi(request: Request, env: Env, method: string): Promise<Response> {
  if (method === 'GET') return json(await listRedirects(env))
  const body = await readBody(request)
  const record = isRecord(body) ? body : {}
  const redirect = (value: unknown) => { try { return parseRedirect(value) } catch (error) { throw new HttpError(400, (error as Error).message) } }
  const source = () => { if (typeof record.source !== 'string' || !record.source.trim().startsWith('/')) throw new HttpError(400, 'Redirect sources must start with /'); return record.source }
  if (method === 'POST') await createRedirect(env, redirect(body))
  else if (method === 'PUT') await updateRedirect(env, source(), redirect(record.redirect))
  else if (method === 'DELETE') await deleteRedirect(env, source())
  else throw new HttpError(405, 'Method not allowed.')
  return json({ success: true })
}

// D1 stores booleans as 0 or 1, and ticket types, extra days and styles as JSON.
type Row<T> = Omit<T, 'published' | 'tickets' | 'moreDays' | 'styles'> & { published: number; tickets: string; moreDays: string; styles: string }
const fromRow = <T extends EventRecord>(row: Row<T>) => ({ ...row, published: row.published === 1, tickets: JSON.parse(row.tickets), moreDays: JSON.parse(row.moreDays), styles: JSON.parse(row.styles) }) as T

// The website only shows published events from this academic year on; an undated event hasn't happened yet.
const SHOWN_ON_SITE = "published = 1 AND (date = '' OR COALESCE(NULLIF(lastDate, ''), date) >= ?)"
const siteFrom = () => academicYearStart(todayInNewYork())

async function listEvents(env: Env): Promise<EventRecord[]> {
  const result = await env.EVENTS_DB.prepare(`SELECT * FROM events WHERE ${SHOWN_ON_SITE} ORDER BY date = '', date, startTime, title`).bind(siteFrom()).all<Row<EventRecord>>()
  return result.results.map(fromRow)
}

async function listManagedEvents(env: Env): Promise<ManagedEvent[]> {
  const result = await env.EVENTS_DB.prepare("SELECT events.*, (SELECT COUNT(*) FROM rsvps WHERE rsvps.eventId = events.id) AS rsvpCount FROM events ORDER BY date = '', date, startTime").all<Row<ManagedEvent>>()
  return result.results.map(fromRow)
}

// Published events are cached at the edge briefly; manager edits clear the cache. The page itself is
// rendered per request so it always references the deployed scripts. Copies outlive a deploy, so the cache gets a
// new name when the shape of a saved event changes.
const eventsCacheKey = (url: URL) => new Request(new URL('/api/events', url))
const eventsCache = () => caches.open('events-2')
const clearEventsCache = async (url: URL) => (await eventsCache()).delete(eventsCacheKey(url))

async function cachedEvents(env: Env, url: URL): Promise<EventRecord[]> {
  const cache = await eventsCache()
  const cached = await cache.match(eventsCacheKey(url))
  if (cached) return cached.json()
  const events = await listEvents(env)
  await cache.put(eventsCacheKey(url), Response.json(events, { headers: { 'Cache-Control': 'public, max-age=60' } }))
  return events
}

function calendar(event: EventRecord, origin: string): string {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cornell Swing//Events//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'DTSTART:20070311T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:20071104T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE']
  // One calendar entry per day, because each day can have its own times. The first keeps the ID calendars already have.
  for (const [index, day] of [{ date: event.date, startTime: event.startTime, endTime: event.endTime }, ...(event.moreDays ?? [])].entries()) {
    const date = day.date.replaceAll('-', '')
    lines.push('BEGIN:VEVENT', `UID:${escape(event.id)}${index ? `-${day.date}` : ''}@swingsyndicate.club`, `DTSTAMP:${new Date(event.updatedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      day.startTime ? `DTSTART;TZID=America/New_York:${date}T${day.startTime.replace(':', '')}00` : `DTSTART;VALUE=DATE:${date}`)
    if (day.endTime) lines.push(`DTEND;TZID=America/New_York:${date}T${day.endTime.replace(':', '')}00`)
    lines.push(`SUMMARY:${escape(event.title)}`, `LOCATION:${escape(formatEventLocation(event))}`, `DESCRIPTION:${escape(event.description)}`, `URL:${origin}${event.slug ? `/events/${event.slug}` : '/#special-events'}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // Fold by UTF-8 octets so non-ASCII event descriptions remain valid iCalendar.
  return lines.map(line => {
    let result = '', length = 0
    for (const character of line) {
      const bytes = new TextEncoder().encode(character).length
      if (length + bytes > 75) { result += '\r\n '; length = 1 }
      result += character; length += bytes
    }
    return result
  }).join('\r\n') + '\r\n'
}

// One event's shareable page, with its details in the tags social sites read for link previews. A slug the event
// used to have redirects to its current one, so links already shared keep working.
async function eventPage(request: Request, env: Env, url: URL, slug: string): Promise<Response> {
  const row = await env.EVENTS_DB.prepare(`SELECT events.* FROM event_slugs JOIN events ON events.id = eventId WHERE event_slugs.slug = ? AND ${SHOWN_ON_SITE}`).bind(slug, siteFrom()).first<Row<EventRecord>>()
  if (!row) return Response.redirect(new URL('/events', url), 302)
  const event = fromRow(row)
  if (event.slug !== slug) return Response.redirect(new URL(`/events/${event.slug}`, url), 301)
  const assetRequest = new Request(new URL('/events/event/', url), request)
  assetRequest.headers.delete('If-None-Match')
  assetRequest.headers.delete('If-Modified-Since')
  const response = await env.ASSETS.fetch(assetRequest)
  if (!response.ok) return response
  const today = todayInNewYork()
  const when = event.date ? formatEventDate(event.date, { weekday: 'long', month: 'long', day: 'numeric' }) : ''
  const summary = [when, event.kind === 'normal' ? formatLessonSchedule(event).join(', ') : event.startTime && formatEventTime(event), formatEventLocation(event)].filter(Boolean).join(' · ')
  const address = new URL(`/events/${event.slug}`, url).href
  const absolute = { element: (element: Element) => { element.setAttribute('content', new URL(element.getAttribute('content') ?? '', url).href) } }
  const content = (value: string) => ({ element: (element: Element) => { element.setAttribute('content', value) } })
  return new HTMLRewriter()
    .on('title', { element: element => { element.setInnerContent(`${event.title} · Swing Syndicate at Cornell`) } })
    .on('meta[name="description"]', content(summary))
    .on('meta[property="og:title"]', content(event.title))
    .on('meta[property="og:description"]', content(summary))
    .on('meta[property="og:url"]', content(address))
    .on('meta[property="og:image"]', absolute)
    .on('meta[name="twitter:image"]', absolute)
    .on('link[rel="canonical"]', { element: element => { element.setAttribute('href', address) } })
    .on('#root', { element: element => { element.setInnerContent(renderToString(createElement(EventPage, { event, today })), { html: true }) } })
    .on('#event-data', { element: element => { element.setInnerContent(JSON.stringify({ event, today }).replaceAll('<', '\\u003c'), { html: true }) } })
    .transform(response)
}

async function route(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  let path: string
  try { path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/' }
  catch { throw new HttpError(400, 'Invalid URL.') }
  const method = request.method
  if (path === '/check-in' || path.startsWith('/check-in/')) throw new HttpError(404, 'Not found.')
  if (method !== 'GET' && method !== 'HEAD') {
    if (request.headers.get('origin') !== url.origin) throw new HttpError(403, 'Please submit from this website.')
  }
  if (managerPage(path)) await requireManager(request, env, path)
  if (path === '/redirects/api') return redirectsApi(request, env, method)
  if (path === '/manage/api/locations' && method === 'GET') return handleLocationSearch(request, env.GOOGLE_PLACES_API_KEY)
  if (path === '/api/events' && method === 'GET') return json({ events: await listEvents(env) })
  if (path === '/api/event-requests' && method === 'POST') {
    const limit = await env.RSVP_RATE_LIMITER.limit({ key: `request:${request.headers.get('cf-connecting-ip') || 'local'}` })
    if (!limit.success) throw new HttpError(429, 'Please wait a minute before trying again.')
    let requested
    try { requested = validateEventRequest(await readBody(request)) } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, (error as Error).message) }
    const { input, email } = requested
    await saveOutsideEvent(env.EVENTS_DB, null, input, `Requested by ${email}`)
    // The request is saved either way; the alert only tells organizers to look.
    try {
      await sendAlert(env, `Event request: ${input.title}`, [
        `${email} asked to list ${input.title} by ${input.groupName} on ${input.date} on swingsyndicate.club/events.`,
        `Review it under Waiting for review in Special events: ${url.origin}/manage/`,
      ])
    } catch (error) { logError('Event request alert failed', error) }
    return json({ success: true }, 201)
  }
  const publicMatch = path.match(/^\/api\/events\/([^/]+)\/(rsvp|calendar)$/)
  if (publicMatch) {
    const [, id, action] = publicMatch
    const row = await env.EVENTS_DB.prepare(`SELECT * FROM events WHERE id = ? AND ${SHOWN_ON_SITE}`).bind(id, siteFrom()).first<Row<EventRecord>>()
    const event = row && fromRow(row)
    if (!event || event.kind !== 'special') throw new HttpError(404, 'Special event not found.')
    if (action === 'calendar' && !event.date) throw new HttpError(400, 'The event date has not been announced.')
    if (action === 'calendar' && method === 'GET') return new Response(calendar(event, url.origin), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="swing-event.ics"', 'Cache-Control': 'no-store' } })
    if (action === 'rsvp' && method === 'POST') {
      if (!isUpcoming(event, todayInNewYork())) throw new HttpError(400, 'RSVPs are closed for this event.')
      if (!hasEventDetails(event)) throw new HttpError(400, 'RSVPs open once the event time and location are announced.')
      const limit = await env.RSVP_RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'local' })
      if (!limit.success) throw new HttpError(429, 'Please wait a minute before trying again.')
      let rsvp: { name: string; email: string }
      try { rsvp = validateRSVP(await readBody(request)) } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, (error as Error).message) }
      await saveRSVP(env, event.id, rsvp)
      return json({ success: true })
    }
    throw new HttpError(405, 'Method not allowed.')
  }
  if (path === '/manage/api/events' && method === 'GET') {
    return json({ events: await listManagedEvents(env) })
  }
  if (path === '/manage/api/rsvp-sheet' || path === '/manage/api/rsvp-sheet/sync') {
    if (path.endsWith('/sync') && method === 'POST') await importSheet(env)
    else if (path.endsWith('/sync')) throw new HttpError(405, 'Method not allowed.')
    else if (method === 'PUT') {
      const body = await readBody(request) as { url?: unknown }
      if (!body || typeof body.url !== 'string') throw new HttpError(400, 'Enter a Google Sheet link.')
      try { await linkSheet(env, body.url) }
      catch (error) {
        if (!(error instanceof SheetError) || error.cause) logError('Link RSVP sheet failed', error instanceof SheetError ? error.cause : error)
        throw new HttpError(400, (error as Error).message)
      }
    } else if (method === 'DELETE') await disconnectSheet(env)
    else if (method !== 'GET') throw new HttpError(405, 'Method not allowed.')
    return json(await getSheetStatus(env))
  }
  // Saved edits to the newsletter parts that repeat every week. A part without a row uses the built-in text.
  if (path === '/manage/api/newsletter-template') {
    if (method === 'GET') {
      const { results } = await env.EVENTS_DB.prepare('SELECT part, html FROM newsletter_template').all<{ part: string; html: string }>()
      return json({ parts: Object.fromEntries(results.map(row => [row.part, row.html])) })
    }
    const body = await readBody(request) as { part?: unknown; html?: unknown }
    if (typeof body?.part !== 'string' || !newsletterParts.includes(body.part)) throw new HttpError(400, 'Choose a part of the newsletter.')
    if (method === 'DELETE') {
      await env.EVENTS_DB.prepare('DELETE FROM newsletter_template WHERE part = ?').bind(body.part).run()
      return json({ success: true })
    }
    if (method !== 'PUT') throw new HttpError(405, 'Method not allowed.')
    if (typeof body.html !== 'string' || body.html.length > 20000) throw new HttpError(400, 'This part is too long to save.')
    await env.EVENTS_DB.prepare('INSERT INTO newsletter_template (part, html, updatedAt) VALUES (?, ?, ?) ON CONFLICT (part) DO UPDATE SET html = excluded.html, updatedAt = excluded.updatedAt').bind(body.part, body.html, new Date().toISOString()).run()
    return json({ success: true })
  }
  if (path === '/manage/api/alert-email') {
    if (method === 'GET') return json(await alertEmailStatus(env))
    if (method !== 'PUT') throw new HttpError(405, 'Method not allowed.')
    const body = await readBody(request) as { email?: unknown }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.')
    return json(await saveAlertEmail(env, email))
  }
  // Square sends the officer back to the callback with a code for reading the account's payments.
  if (path === '/manage/square/connect' && method === 'GET') {
    const state = crypto.randomUUID()
    return new Response(null, { status: 302, headers: { Location: squareConnectUrl(env, url.origin, state), 'Set-Cookie': `square_state=${state}; Path=/manage/square; Max-Age=600; HttpOnly; Secure; SameSite=Lax` } })
  }
  if (path === '/manage/square/callback' && method === 'GET') {
    const state = request.headers.get('cookie')?.match(/(?:^|;\s*)square_state=([^;]+)/)?.[1]
    if (!state || state !== url.searchParams.get('state')) throw new HttpError(400, 'Connect Square again from the Settings tab.')
    const code = url.searchParams.get('code')
    if (code) await connectSquare(env, url.origin, code)
    return new Response(null, { status: 302, headers: { Location: '/manage?tab=settings', 'Set-Cookie': 'square_state=; Path=/manage/square; Max-Age=0' } })
  }
  if (path === '/manage/api/square') {
    if (method === 'GET') return json(await squareFeed(env))
    if (method !== 'DELETE') throw new HttpError(405, 'Method not allowed.')
    await disconnectSquare(env)
    return json({ success: true })
  }
  if (path === '/manage/api/finance' && method === 'GET') return json(await financeOverview(env, ctx))
  if (path === '/manage/api/finance/campusgroups' && method === 'PUT') {
    try { await saveCampusGroupsTransactions(env, await readBody(request, 2_000_000)) } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, (error as Error).message) }
    return json(await financeOverview(env, ctx))
  }
  const activityMatch = path.match(/^\/manage\/api\/events\/([^/]+)\/activity$/)
  if (activityMatch && method === 'GET') {
    const activity = await eventActivity(env, activityMatch[1], ctx)
    if (!activity) throw new HttpError(404, 'Event not found.')
    return json(activity)
  }
  if (path === '/manage/api/campusgroups') {
    if (method === 'GET') return json(summarizeCampusGroups(await env.MEMBER_CACHE.get<CampusGroupsData>(campusGroupsKey, 'json')))
    if (method !== 'PUT') throw new HttpError(405, 'Method not allowed.')
    let data
    try { data = buildCampusGroups(await readBody(request, 2_000_000)) } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, (error as Error).message) }
    await env.MEMBER_CACHE.put(campusGroupsKey, JSON.stringify(data))
    return json(summarizeCampusGroups(data))
  }
  // Other groups' dances, listed on /events.
  const feedMatch = path.match(/^\/manage\/api\/dance-feeds(?:\/([^/]+))?$/)
  if (feedMatch) {
    const id = feedMatch[1]
    if (!id && method === 'GET') return json({ feeds: await listFeeds(env.EVENTS_DB) })
    // Removing a feed keeps the group and its typed-in events.
    if (id && method === 'DELETE') {
      await env.EVENTS_DB.batch([
        env.EVENTS_DB.prepare('DELETE FROM outside_events WHERE groupId = ? AND sourceId IS NOT NULL').bind(id),
        env.EVENTS_DB.prepare("UPDATE dance_groups SET feedUrl = '', skipTitles = '', eventPages = '', checkedAt = NULL, feedError = NULL WHERE id = ?").bind(id),
      ])
      return json({ success: true })
    }
    if ((!id && method === 'POST') || (id && method === 'PUT')) {
      let input
      try { input = validateFeed(await readBody(request)) } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, (error as Error).message) }
      const values = [input.name, input.style, input.city, input.siteUrl, input.feedUrl, input.skipTitles, input.eventPages]
      // A new feed joins the group with the same name if one exists, such as a group whose events were typed in.
      const saved = await (id
        ? env.EVENTS_DB.prepare('UPDATE dance_groups SET name = ?, style = ?, city = ?, siteUrl = ?, feedUrl = ?, skipTitles = ?, eventPages = ? WHERE id = ? RETURNING id').bind(...values, id)
        : env.EVENTS_DB.prepare('INSERT INTO dance_groups (name, style, city, siteUrl, feedUrl, skipTitles, eventPages, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET style = excluded.style, city = excluded.city, siteUrl = excluded.siteUrl, feedUrl = excluded.feedUrl, skipTitles = excluded.skipTitles, eventPages = excluded.eventPages RETURNING id').bind(...values, crypto.randomUUID())
      ).first<{ id: string }>().catch((error: unknown) => {
        if (String(error).includes('UNIQUE')) throw new HttpError(409, 'Another group already has this name.')
        throw error
      })
      if (!saved) throw new HttpError(404, 'This feed was removed. Refresh the page.')
      await readFeeds(env, saved.id)
      const [feed] = await listFeeds(env.EVENTS_DB, saved.id)
      return json({ feed }, id ? 200 : 201)
    }
    throw new HttpError(405, 'Method not allowed.')
  }
  const outsideMatch = path.match(/^\/manage\/api\/outside-events(?:\/([^/]+))?$/)
  if (outsideMatch) {
    const id = outsideMatch[1]
    if (!id && method === 'GET') {
      const [events, groups] = await Promise.all([listOutsideEvents(env.EVENTS_DB), listGroupNames(env.EVENTS_DB)])
      return json({ events, groups })
    }
    if (id && method === 'DELETE') {
      await env.EVENTS_DB.prepare('DELETE FROM outside_events WHERE id = ?').bind(id).run()
      return json({ success: true })
    }
    if ((!id && method === 'POST') || (id && method === 'PUT')) {
      const body = await readBody(request)
      let input
      try { input = validateOutsideEvent(body) } catch (error) { throw new HttpError(400, (error as Error).message) }
      const event = await saveOutsideEvent(env.EVENTS_DB, id ?? null, input)
      if (!event) throw new HttpError(404, 'This event was deleted. Refresh the page.')
      return json({ event }, id ? 200 : 201)
    }
    throw new HttpError(405, 'Method not allowed.')
  }
  const managerMatch = path.match(/^\/manage\/api\/events\/([^/]+)(\/rsvps)?$/)
  if (managerMatch?.[2] && method === 'DELETE') {
    const body = await readBody(request) as { email?: unknown }
    if (typeof body?.email !== 'string' || !body.email.trim()) throw new HttpError(400, 'Enter the RSVP email.')
    await removeRSVP(env, managerMatch[1], body.email.trim().toLowerCase())
    return json({ success: true })
  }
  if (managerMatch?.[2] && method === 'GET') {
    const exists = await env.EVENTS_DB.prepare('SELECT id FROM events WHERE id = ?').bind(managerMatch[1]).first()
    if (!exists) throw new HttpError(404, 'Event not found.')
    const result = await env.EVENTS_DB.prepare('SELECT name, email, createdAt FROM rsvps WHERE eventId = ? ORDER BY createdAt').bind(managerMatch[1]).all<RSVP>()
    return json({ rsvps: result.results })
  }
  if ((path === '/manage/api/events' && method === 'POST') || (managerMatch && !managerMatch[2] && method === 'PUT')) {
    const body = await readBody(request)
    let input
    try { input = validateEvent(body) } catch (error) { throw new HttpError(400, (error as Error).message) }
    const id = method === 'POST' ? crypto.randomUUID() : managerMatch![1]
    let updatedAt = new Date().toISOString()
    const values = [input.kind, input.title, input.date, input.startTime, input.endTime, input.location, input.description, updatedAt, input.locationUrl || '', input.room || '', input.published ? 1 : 0, JSON.stringify(input.tickets), input.lessonEndTime, input.socialStartTime, input.lastDate, JSON.stringify(input.moreDays), JSON.stringify(input.styles), input.city]
    if (method === 'POST') {
      const create = async () => {
      await env.EVENTS_DB.prepare('INSERT INTO events (kind, title, date, startTime, endTime, location, description, updatedAt, locationUrl, room, published, tickets, lessonEndTime, socialStartTime, lastDate, moreDays, styles, city, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...values, id).run()
      }
      if (input.kind === 'special') await createEventWithSheet(env, input.title, create)
      else await create()
    } else {
      const previous = (body as Record<string, unknown>).updatedAt
      if (typeof previous !== 'string' || !Number.isFinite(Date.parse(previous))) throw new HttpError(400, 'Refresh the event before saving.')
      updatedAt = new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString()
      values[7] = updatedAt
      const current = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRecord>()
      if (!current || current.updatedAt !== previous) throw new HttpError(409, 'Someone else saved this event after you opened it.', 'stale')
      const update = async () => {
      const result = await env.EVENTS_DB.prepare('UPDATE events SET kind = ?, title = ?, date = ?, startTime = ?, endTime = ?, location = ?, description = ?, updatedAt = ?, locationUrl = ?, room = ?, published = ?, tickets = ?, lessonEndTime = ?, socialStartTime = ?, lastDate = ?, moreDays = ?, styles = ?, city = ? WHERE id = ?19 AND updatedAt = ? AND (?1 = \'special\' OR NOT EXISTS (SELECT 1 FROM rsvps WHERE eventId = ?19))').bind(...values, id, previous).run()
      if (result.meta.changes) return
      throw new EventConflict(input.kind === 'normal' ? 'This night changed after you opened it. Refresh and try again.' : 'The event changed. Refresh before saving.')
      }
      const sheetUnchanged = current.kind === input.kind && (input.kind === 'normal' || (current.title === input.title && current.date === input.date))
      if (sheetUnchanged) await update()
      else await changeEventWithSheet(env, current, input.title, update, input.kind)
    }
    const slug = await assignSlug(env.EVENTS_DB, id, input)
    await clearEventsCache(url)
    return json({ event: { ...input, id, updatedAt, slug } }, method === 'POST' ? 201 : 200)
  }
  if (managerMatch && !managerMatch[2] && method === 'DELETE') {
    // Money recorded against the event stays on the Balance Sheet under its name.
    if (await env.EVENTS_DB.prepare("SELECT 1 FROM door_charges WHERE eventId = ?1 AND status != 'canceled' UNION SELECT 1 FROM square_payments WHERE eventId = ?1").bind(managerMatch[1]).first()) throw new HttpError(409, 'This event has payments, so it can\'t be deleted.')
    const current = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(managerMatch[1]).first<EventRecord>()
    if (!current) throw new HttpError(404, 'Event not found.')
    const remove = async () => { await env.EVENTS_DB.prepare('DELETE FROM events WHERE id = ?').bind(current.id).run() }
    // Weekly lessons have no RSVPs, so deleting one never waits on the sheet.
    if (current.kind === 'normal') await remove()
    else await changeEventWithSheet(env, current, null, remove)
    await clearEventsCache(url)
    return json({ success: true })
  }
  if (path.startsWith('/api/') || path.startsWith('/manage/api/')) throw new HttpError(404, 'Not found.')
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed.')
  if (path === '/manage' || path.startsWith('/manage/')) {
    const assetUrl = new URL('/manage/', url)
    const assetRequest = new Request(assetUrl, request)
    assetRequest.headers.delete('If-None-Match')
    assetRequest.headers.delete('If-Modified-Since')
    const [response, events] = await Promise.all([env.ASSETS.fetch(assetRequest), listManagedEvents(env)])
    const snapshot = JSON.stringify({ events }).replaceAll('<', '\\u003c')
    return new HTMLRewriter().on('#manage-data', { element: element => { element.setInnerContent(snapshot, { html: true }) } }).transform(response)
  }
  if (path === '/events' && method === 'GET') {
    const assetRequest = new Request(new URL('/events/', url), request)
    assetRequest.headers.delete('If-None-Match')
    assetRequest.headers.delete('If-Modified-Since')
    const today = todayInNewYork()
    const [response, loaded] = await Promise.all([env.ASSETS.fetch(assetRequest), Promise.all([cachedEvents(env, url), listOutsideEvents(env.EVENTS_DB, today)]).catch((error: unknown) => { logError('Dance listings failed to load', error); return null })])
    if (!response.ok) return response
    const listings: DanceSnapshot = { events: loaded?.[0] ?? [], outside: loaded?.[1] ?? [], today, unavailable: loaded === null }
    const html = renderToString(createElement(DancesPage, listings))
    const snapshot = JSON.stringify(listings).replaceAll('<', '\\u003c')
    return new HTMLRewriter().on('#root', { element: element => { element.setInnerContent(html, { html: true }) } }).on('#dances-data', { element: element => { element.setInnerContent(snapshot, { html: true }) } }).transform(response)
  }
  const slugMatch = path.match(/^\/events\/([^/]+)$/)
  if (slugMatch && method === 'GET') return eventPage(request, env, url, slugMatch[1])
  if (path !== '/' || method !== 'GET') return env.ASSETS.fetch(request)
  const assetRequest = new Request(request)
  assetRequest.headers.delete('If-None-Match')
  assetRequest.headers.delete('If-Modified-Since')
  // The homepage still renders when the events can't be read, with a notice where they would be.
  const [response, loaded] = await Promise.all([env.ASSETS.fetch(assetRequest), cachedEvents(env, url).catch((error: unknown) => { logError('Homepage events failed to load', error); return null })])
  if (!response.ok) return response
  const today = todayInNewYork()
  const events = loaded ?? []
  const unavailable = loaded === null
  const snapshot = JSON.stringify({ events, today, unavailable }).replaceAll('<', '\\u003c')
  const html = renderToString(createElement(EventSections, { events, today, unavailable }))
  const nextEvent = renderToString(createElement(NextEvent, { events, today }))
  return new HTMLRewriter().on('#next-event', { element: element => { element.setInnerContent(nextEvent, { html: true }) } }).on('#event-sections', { element: element => { element.setInnerContent(html, { html: true }) } }).on('#schedule-data', { element: element => { element.setInnerContent(snapshot, { html: true }) } }).transform(response)
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    let response: Response
    try { response = await route(request, env, ctx) }
    catch (error) {
      if (error instanceof SheetError) {
        if (error.cause) logError('RSVP sheet operation failed', error.cause)
        error = new HttpError(502, error.message)
      }
      if (error instanceof EventConflict) error = new HttpError(409, error.message)
      if (error instanceof RedirectError) error = new HttpError(error.status, error.message)
      if (error instanceof AlertEmailError) error = new HttpError(502, error.message)
      if (!(error instanceof HttpError)) logError('Events request failed', error)
      response = json({ error: error instanceof HttpError ? error.message : 'Something went wrong. Please try again.', ...(error instanceof HttpError && error.code && { code: error.code }) }, error instanceof HttpError ? error.status : 500)
    }
    response = new Response(response.body, response)
    const pathname = new URL(request.url).pathname
    if (managerPage(pathname)) response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    if (managerPage(pathname) || pathname === '/' || pathname === '/events' || pathname.startsWith('/events/')) {
      response.headers.set('Cache-Control', 'no-store')
      response.headers.delete('ETag')
      response.headers.delete('Last-Modified')
    }
    return response
  },
}

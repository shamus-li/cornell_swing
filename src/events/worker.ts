import { handleLocationSearch } from './locations'
import { logError } from './logging'
import { getSheetStatus, linkSheet, disconnectSheet, importSheet, saveRSVP, removeRSVP, changeEventWithSheet, createEventWithSheet, SheetError } from './sheets'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { EventSections } from '../site/components/Events'
import { formatEventLocation, todayInNewYork, validateEvent, validateRSVP, type EventRecord, type ManagedEvent, type RSVP } from './model'

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Send JSON event details.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Enter the required details.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > 90000) { await reader.cancel(); throw new HttpError(413, 'The request is too large.') }
    chunks.push(value)
  }
  const buffer = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(buffer)) }
  catch { throw new HttpError(400, 'Enter valid JSON details.') }
}

let managerKeys: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined

async function requireManager(request: Request, env: Env): Promise<void> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(503, 'Manager sign-in is not configured.')
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) throw new HttpError(401, 'Sign in to manage events.')
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`
    if (managerKeys?.issuer !== issuer) managerKeys = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)) }
    await jwtVerify(token, managerKeys.keys, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] })
  } catch { throw new HttpError(401, 'Sign in to manage events.') }
}

export async function listEvents(env: Env): Promise<EventRecord[]> {
  const result = await env.EVENTS_DB.prepare("SELECT * FROM events ORDER BY date = '', date, startTime, title").all<EventRecord>()
  return result.results
}

async function listManagedEvents(env: Env): Promise<ManagedEvent[]> {
  const result = await env.EVENTS_DB.prepare("SELECT events.*, (SELECT COUNT(*) FROM rsvps WHERE rsvps.eventId = events.id) AS rsvpCount FROM events ORDER BY date = '', date, startTime").all<ManagedEvent>()
  return result.results
}

function calendar(event: EventRecord, origin: string): string {
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
  const date = event.date.replaceAll('-', '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cornell Swing//Events//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'DTSTART:20070311T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:20071104T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${escape(event.id)}@swingsyndicate.club`, `DTSTAMP:${new Date(event.updatedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    event.startTime ? `DTSTART;TZID=America/New_York:${date}T${event.startTime.replace(':', '')}00` : `DTSTART;VALUE=DATE:${date}`]
  if (event.endTime) lines.push(`DTEND;TZID=America/New_York:${date}T${event.endTime.replace(':', '')}00`)
  lines.push(`SUMMARY:${escape(event.title)}`, `LOCATION:${escape(formatEventLocation(event))}`, `DESCRIPTION:${escape(event.description)}`, `URL:${origin}/#special-events`, 'END:VEVENT', 'END:VCALENDAR')
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

async function route(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  let path: string
  try { path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/' }
  catch { throw new HttpError(400, 'Invalid URL.') }
  const method = request.method
  if (path === '/check-in' || path.startsWith('/check-in/')) throw new HttpError(404, 'Not found.')
  if (method !== 'GET' && method !== 'HEAD') {
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Please submit from this website.')
  }
  if (path === '/manage' || path.startsWith('/manage/')) await requireManager(request, env)
  if (path === '/manage/api/locations' && method === 'GET') return handleLocationSearch(request, env.GOOGLE_PLACES_API_KEY)
  if (path === '/api/events' && method === 'GET') return json({ events: await listEvents(env) })
  const publicMatch = path.match(/^\/api\/events\/([^/]+)\/(rsvp|calendar)$/)
  if (publicMatch) {
    const [, id, action] = publicMatch
    const event = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRecord>()
    if (!event || event.kind !== 'special') throw new HttpError(404, 'Special event not found.')
    if (action === 'calendar' && !event.date) throw new HttpError(400, 'The event date has not been announced.')
    if (action === 'calendar' && method === 'GET') return new Response(calendar(event, url.origin), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="swing-event.ics"', 'Cache-Control': 'no-store' } })
    if (action === 'rsvp' && method === 'POST') {
      if (event.date && event.date < todayInNewYork()) throw new HttpError(400, 'RSVPs are closed for this event.')
      const limit = await env.RSVP_RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'local' })
      if (!limit.success) throw new HttpError(429, 'Please wait a minute before trying again.')
      let rsvp: { name: string; email: string }
      try { rsvp = validateRSVP(await readBody(request)) } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, (error as Error).message) }
      await saveRSVP(env, event, rsvp)
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
    const values = [input.kind, input.title, input.date, input.startTime, input.endTime, input.location, input.description, updatedAt, input.locationUrl || '', input.room || '']
    if (method === 'POST') {
      const create = async () => {
      await env.EVENTS_DB.prepare('INSERT INTO events (kind, title, date, startTime, endTime, location, description, updatedAt, locationUrl, room, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(...values, id).run()
      }
      if (input.kind === 'special') await createEventWithSheet(env, input.title, create)
      else await create()
    } else {
      const previous = (body as Record<string, unknown>).updatedAt
      if (typeof previous !== 'string' || !Number.isFinite(Date.parse(previous))) throw new HttpError(400, 'Refresh the event before saving.')
      updatedAt = new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString()
      values[7] = updatedAt
      const current = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRecord>()
      if (!current || current.updatedAt !== previous) throw new HttpError(409, 'The event changed. Refresh before saving.')
      const update = async () => {
      const result = await env.EVENTS_DB.prepare('UPDATE events SET kind = ?, title = ?, date = ?, startTime = ?, endTime = ?, location = ?, description = ?, updatedAt = ?, locationUrl = ?, room = ? WHERE id = ? AND updatedAt = ? AND (? = \'special\' OR NOT EXISTS (SELECT 1 FROM rsvps WHERE eventId = ?))').bind(...values, id, previous, input.kind, id).run()
      if (!result.meta.changes) throw new HttpError(409, 'The event changed, or has RSVPs and cannot become a normal event. Refresh before saving.')
      }
      const sheetUnchanged = current.kind === input.kind && (input.kind === 'normal' || (current.title === input.title && current.date === input.date))
      if (sheetUnchanged) await update()
      else await changeEventWithSheet(env, current, input.title, update, input.kind)
    }
    return json({ event: { ...input, id, updatedAt } }, method === 'POST' ? 201 : 200)
  }
  if (managerMatch && !managerMatch[2] && method === 'DELETE') {
    const current = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(managerMatch[1]).first<EventRecord>()
    if (!current) throw new HttpError(404, 'Event not found.')
    await changeEventWithSheet(env, current, null, async () => {
      await env.EVENTS_DB.prepare('DELETE FROM events WHERE id = ?').bind(current.id).run()
    })
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
  const assetRequest = new Request(request)
  if (path === '/') {
    assetRequest.headers.delete('If-None-Match')
    assetRequest.headers.delete('If-Modified-Since')
  }
  const [response, events] = await Promise.all([
    env.ASSETS.fetch(assetRequest),
    path === '/' && method === 'GET' ? listEvents(env) : Promise.resolve([]),
  ])
  if (path === '/' && response.ok && method === 'GET') {
    const today = todayInNewYork()
    const snapshot = JSON.stringify({ events, today }).replaceAll('<', '\\u003c')
    const html = renderToString(createElement(EventSections, { events, today }))
    return new HTMLRewriter().on('#event-sections', { element: element => { element.setInnerContent(html, { html: true }) } }).on('#schedule-data', { element: element => { element.setInnerContent(snapshot, { html: true }) } }).transform(response)
  }
  return response
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
      if (!(error instanceof HttpError)) logError('Events request failed', error)
      response = json({ error: error instanceof HttpError ? error.message : 'Something went wrong. Please try again.' }, error instanceof HttpError ? error.status : 500)
    }
    response = new Response(response.body, response)
    if (new URL(request.url).pathname.startsWith('/manage')) response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    if (new URL(request.url).pathname.startsWith('/manage') || new URL(request.url).pathname === '/') {
      response.headers.set('Cache-Control', 'no-store')
      response.headers.delete('ETag')
      response.headers.delete('Last-Modified')
    }
    return response
  },
}

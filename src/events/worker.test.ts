import { env as runtimeEnv } from 'cloudflare:workers'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import migration from '../../migrations/events/0001_events.sql?raw'
import sheetMigration from '../../migrations/events/0002_rsvp_sheets.sql?raw'
import sourceMigration from '../../migrations/events/0003_sheet_source.sql?raw'
import roomMigration from '../../migrations/events/0004_event_room.sql?raw'
import publishedMigration from '../../migrations/events/0005_event_published.sql?raw'
import worker from './worker'
import siteWorker from '../worker'
import { changeEventWithSheet } from './sheets'
import { getGoogleAccessToken } from '../../check-in/worker/google'
import { campusGroupsKey, generalRiskTag } from './campusgroups'

vi.mock('../../check-in/worker/google', () => ({ getGoogleAccessToken: vi.fn(async () => 'test-token') }))
const network = setupNetwork()
let keyRequests = 0
let managerToken = ''
let wrongAudienceToken = ''

const env = runtimeEnv as typeof runtimeEnv
const origin = 'https://events.example.com'
const event = { kind: 'special', title: 'Swing, dance', date: '2099-10-10', startTime: '18:15', endTime: '22:00', location: 'Ithaca', description: 'Welcome\n**Everyone**', published: true }
function request(path: string, method = 'GET', body?: unknown, manager = false): Request {
  const headers: Record<string, string> = { origin, 'content-type': 'application/json', 'cf-connecting-ip': crypto.randomUUID() }
  if (manager) headers['Cf-Access-Jwt-Assertion'] = managerToken
  return new Request(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function call(path: string, method = 'GET', body?: unknown, manager = false) {
  return worker.fetch(request(path, method, body, manager), env)
}
async function create(overrides = {}) {
  const response = await call('/manage/api/events', 'POST', { ...event, ...overrides }, true)
  expect(response.status).toBe(201)
  return (await response.json() as { event: import('./model').EventRecord }).event
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
  network.enable()
  network.use(http.get(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, () => { keyRequests++; return HttpResponse.json({ keys: [jwk] }) }))
  const sign = (audience: string) => new SignJWT({ email: 'manager@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`).setAudience(audience).setExpirationTime('1h').sign(privateKey)
  managerToken = await sign(env.ACCESS_AUD)
  wrongAudienceToken = await sign('wrong-application')
  await env.EVENTS_DB.exec(migration.replaceAll('\n', ' '))
  await env.EVENTS_DB.exec(sheetMigration.replaceAll('\n', ' '))
  await env.EVENTS_DB.exec(sourceMigration.replaceAll('\n', ' '))
  await env.EVENTS_DB.exec(roomMigration.replaceAll('\n', ' '))
  await env.EVENTS_DB.exec(publishedMigration.replaceAll('\n', ' '))
})
afterAll(() => network.disable())
beforeEach(async () => { await env.EVENTS_DB.exec('DELETE FROM rsvp_sheet_connection; DELETE FROM rsvps; DELETE FROM events;') })

describe('manager authorization', () => {
  it('reuses signing keys while verifying every request audience', async () => {
    expect((await call('/manage/api/events', 'GET', undefined, true)).status).toBe(200)
    const fetched = keyRequests
    expect((await call('/manage/api/events', 'GET', undefined, true)).status).toBe(200)
    const req = request('/manage/api/events')
    req.headers.set('Cf-Access-Jwt-Assertion', wrongAudienceToken)
    expect((await worker.fetch(req, env)).status).toBe(401)
    expect(keyRequests).toBe(fetched)
  })
  it('protects both the page and participant endpoint', async () => {
    expect((await call('/manage')).status).toBe(401)
    expect((await call('/manage/api/events/test/rsvps')).status).toBe(401)
  })
  it('fails closed when Access configuration is missing', async () => {
    const unconfigured = { ...env }
    Reflect.deleteProperty(unconfigured, 'ACCESS_AUD')
    const response = await worker.fetch(request('/manage', 'GET', undefined, true), unconfigured)
    expect(response.status).toBe(503)
  })
  it('rejects a validly signed token for another Access application', async () => {
    const req = request('/manage/api/events')
    req.headers.set('Cf-Access-Jwt-Assertion', wrongAudienceToken)
    expect((await worker.fetch(req, env)).status).toBe(401)
  })
  it('rejects a forged Access token', async () => {
    const req = request('/manage')
    req.headers.set('Cf-Access-Jwt-Assertion', 'forged')
    expect((await worker.fetch(req, env)).status).toBe(401)
  })
})

describe('event storage and RSVPs', () => {
  it('includes database events in the protected manager page without exposing RSVP emails', async () => {
    const created = await create({ title: '</script><script>alert(1)</script>' })
    await call(`/api/events/${created.id}/rsvp`, 'POST', { name: 'Guest', email: 'guest@example.com' })
    const response = await worker.fetch(request('/manage', 'GET', undefined, true), {
      ...env,
      ASSETS: { ...env.ASSETS, fetch: async () => new Response('<script id="manage-data" type="application/json">null</script>', { headers: { 'Content-Type': 'text/html' } }) },
    })
    const html = await response.text()
    const snapshot = JSON.parse(html.match(/<script[^>]*>(.*?)<\/script>/s)![1])
    expect(snapshot.events[0]).toMatchObject({ id: created.id, title: created.title, rsvpCount: 1 })
    expect(html).not.toContain('guest@example.com')
    expect(html).not.toContain(created.title)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('stores participants once, does not expose them publicly, and prevents lost manager edits', async () => {
    const created = await create()
    const path = `/api/events/${created.id}/rsvp`
    expect((await call(path, 'POST', { name: 'Jane', email: 'JANE@example.com' })).status).toBe(200)
    expect((await call(path, 'POST', { name: 'Changed', email: 'jane@example.com' })).status).toBe(200)
    const participants = await (await call(`/manage/api/events/${created.id}/rsvps`, 'GET', undefined, true)).json() as { rsvps: { name: string; email: string }[] }
    expect(participants.rsvps).toHaveLength(1)
    expect(participants.rsvps[0].name).toBe('Jane')
    const publicResult = await (await call('/api/events')).text()
    expect(publicResult).not.toContain('jane@example.com')
    expect(publicResult).not.toContain('rsvpCount')
    expect((await call(`/manage/api/events/${created.id}`, 'PUT', { ...created, title: 'Updated' }, true)).status).toBe(200)
    expect((await call(`/manage/api/events/${created.id}`, 'PUT', { ...created, title: 'Stale overwrite' }, true)).status).toBe(409)
    expect((await call(`/manage/api/events/${created.id}`, 'DELETE', undefined, true)).status).toBe(200)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
  })
  it('allows one dated event per day', async () => {
    const first = await create()
    const blocked = await call('/manage/api/events', 'POST', { ...event, kind: 'normal', title: 'Lesson' }, true)
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ error: 'Another event is already on that date.' })
    const second = await create({ title: 'Later dance', date: '2099-10-11' })
    const moved = await call(`/manage/api/events/${second.id}`, 'PUT', { ...second, date: first.date }, true)
    expect(moved.status).toBe(409)
    expect(await moved.json()).toEqual({ error: 'Another event is already on that date.' })
    expect(await env.EVENTS_DB.prepare('SELECT date FROM events WHERE id = ?').bind(second.id).first('date')).toBe('2099-10-11')
    expect((await call(`/manage/api/events/${first.id}`, 'PUT', { ...first, location: 'New venue' }, true)).status).toBe(200)
    const undated = await create({ title: 'Date TBA', date: '', startTime: '', endTime: '' })
    await create({ title: 'Also TBA', date: '', startTime: '', endTime: '' })
    expect((await call(`/manage/api/events/${undated.id}`, 'PUT', { ...undated, location: 'Somewhere' }, true)).status).toBe(200)
  })
  it('refuses RSVP and calendar for normal events and RSVP for past events', async () => {
    const normal = await create({ kind: 'normal' })
    expect((await call(`/api/events/${normal.id}/rsvp`, 'POST', { name: 'Jane', email: 'jane@example.com' })).status).toBe(404)
    expect((await call(`/api/events/${normal.id}/calendar`)).status).toBe(404)
    const past = await create({ date: '2000-01-01' })
    expect((await call(`/api/events/${past.id}/rsvp`, 'POST', { name: 'Jane', email: 'jane@example.com' })).status).toBe(400)
    const tba = await create({ title: 'To be announced', date: '2099-10-11', startTime: '', endTime: '', location: '' })
    expect((await call(`/api/events/${tba.id}/rsvp`, 'POST', { name: 'Jane', email: 'jane@example.com' })).status).toBe(400)
  })
  it('keeps unpublished events off the public site until they are published', async () => {
    const draft = await create({ published: false })
    expect(JSON.stringify(await (await call('/api/events')).json())).not.toContain(draft.id)
    expect((await call(`/api/events/${draft.id}/rsvp`, 'POST', { name: 'Jane', email: 'jane@example.com' })).status).toBe(404)
    expect((await call(`/api/events/${draft.id}/calendar`)).status).toBe(404)
    const managed = await (await call('/manage/api/events', 'GET', undefined, true)).json() as { events: { id: string; published: boolean }[] }
    expect(managed.events.find(event => event.id === draft.id)?.published).toBe(false)
    expect((await call(`/manage/api/events/${draft.id}`, 'PUT', { ...draft, published: true }, true)).status).toBe(200)
    expect(JSON.stringify(await (await call('/api/events')).json())).toContain(draft.id)
  })
  it('produces escaped timezone-aware calendar downloads', async () => {
    const created = await create({ room: 'Garden Room', location: 'Willard Straight Hall' })
    const response = await call(`/api/events/${created.id}/calendar`)
    const text = await response.text()
    expect(response.headers.get('content-type')).toContain('text/calendar')
    expect(text).toContain('DTSTART;TZID=America/New_York:20991010T181500')
    expect(text).toContain('SUMMARY:Swing\\, dance')
    expect(text).toContain('LOCATION:Garden Room\\, Willard Straight Hall')
    expect(text).toContain('DESCRIPTION:Welcome\\n**Everyone**')
  })
  it('rejects cross-origin writes and oversized JSON bodies', async () => {
    const req = request('/manage/api/events', 'POST', event, true)
    req.headers.set('origin', 'https://attacker.example')
    expect((await worker.fetch(req, env)).status).toBe(403)
    expect((await call('/manage/api/events', 'POST', { ...event, description: 'x'.repeat(90001) }, true)).status).toBe(413)
  })
  it('enforces RSVP rate limits without storing a participant', async () => {
    const created = await create()
    const response = await worker.fetch(request(`/api/events/${created.id}/rsvp`, 'POST', { name: 'Jane', email: 'jane@example.com' }), { ...env, RSVP_RATE_LIMITER: { limit: async () => ({ success: false }) } })
    expect(response.status).toBe(429)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
  })
  it('routes production check-in and events while keeping manager access protected', async () => {
    expect((await siteWorker.fetch(request('/api/events'), env)).status).toBe(200)
    expect((await siteWorker.fetch(request('/check-in/api/checkins'), env)).status).toBe(405)
    const manager = await siteWorker.fetch(request('/manage'), env)
    expect(manager.status).toBe(401)
    expect(manager.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect((await siteWorker.fetch(request('/redirects'), env)).status).toBe(401)
    expect((await siteWorker.fetch(request('/redirects/api'), env)).status).toBe(401)
    expect((await call('/api/events')).headers.has('x-robots-tag')).toBe(false)
  })
})

describe('Sheets source of truth', () => {
  async function connect(rows: string[][], failWrites = false) {
    await env.EVENTS_DB.prepare("INSERT INTO rsvp_sheet_connection (id,spreadsheetId,sheetId,tabTitle) VALUES (1,'test-sheet',1,'RSVPs')").run()
    let registry: string[][] = []
    let registryCreated = false
    let columnCount = 3
    let hiddenId = false
    let basicFilter: unknown
    const requests: string[] = []
    network.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/test-sheet', () => {
        requests.push('metadata')
        return HttpResponse.json({ sheets: [{ properties: { sheetId:1,title:'RSVPs',gridProperties:{columnCount,rowCount:10000} }, basicFilter, data: [{columnMetadata:[{},{},{},{hiddenByUser:hiddenId}]}] }, ...(registryCreated ? [{ properties:{sheetId:2,title:'_Swing events 1',hidden:true} }] : [])] })
      }),
      http.get('https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/:range', ({params}) => {
        const isRegistry = String(params.range).includes('_Swing events')
        requests.push(isRegistry ? 'registry' : 'participants')
        return HttpResponse.json({ values: isRegistry ? registry : rows })
      }),
      http.post('https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values:batchUpdate', async ({request}) => {
        requests.push('values update')
        if (failWrites) return new HttpResponse(null,{status:503})
        const body = await request.json() as {data:{range:string,values:string[][]}[]}
        for (const entry of body.data) {
          if(entry.range.includes('_Swing events')) { registry = entry.values; continue }
          const address=entry.range.match(/!([AD])(\d+)/)!
          const start=Number(address[2])-1
          for(let i=0;i<entry.values.length;i++) {
            rows[start+i] ??= []
            for(let j=0;j<entry.values[i].length;j++) rows[start+i][(address[1]==='D'?3:0)+j]=entry.values[i][j]
          }
        }
        return HttpResponse.json({})
      }),
      http.post('https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/:range', async ({ request }) => {
        requests.push('append')
        if (failWrites) return new HttpResponse(null, { status: 503 })
        const body = await request.json() as { values: string[][] }
        rows.push(...body.values)
        return HttpResponse.json({})
      }),
      http.post('https://sheets.googleapis.com/v4/spreadsheets/test-sheet:batchUpdate', async ({ request }) => {
        requests.push('metadata update')
        const body = await request.json() as { requests: { deleteDimension?: { range: { startIndex: number } }; addSheet?: unknown; appendDimension?: {length:number}; setBasicFilter?: {filter:unknown}; updateDimensionProperties?: {properties:{hiddenByUser:boolean}} }[] }
        for (const update of body.requests) {
          if(update.deleteDimension) rows.splice(update.deleteDimension.range.startIndex, 1)
          if(update.addSheet) registryCreated=true
          if(update.appendDimension) columnCount += update.appendDimension.length
          if(update.setBasicFilter) basicFilter = { ...update.setBasicFilter.filter as object, range: { sheetId:1, startRowIndex:0, startColumnIndex:0, endColumnIndex:4, endRowIndex:10000 } }
          if(update.updateDimensionProperties) hiddenId = update.updateDimensionProperties.properties.hiddenByUser
        }
        return HttpResponse.json({})
      }),
    )
    return { getRegistry: () => registry, requests }
  }
  it('reuses Google authorization until expiry and refreshes when credentials change', async () => {
    await create()
    await connect([['Event', 'Name', 'Email']])
    const credentials = { ...env, GOOGLE_SERVICE_ACCOUNT_EMAIL: 'cache-test@example.com', GOOGLE_PRIVATE_KEY: 'first-key' }
    const sync = () => worker.fetch(request('/manage/api/rsvp-sheet/sync', 'POST', undefined, true), credentials)
    const token = vi.mocked(getGoogleAccessToken)
    token.mockClear()
    expect((await sync()).status).toBe(200)
    expect((await sync()).status).toBe(200)
    expect(token).toHaveBeenCalledTimes(1)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 51 * 60 * 1000)
    try {
      expect((await sync()).status).toBe(200)
      expect(token).toHaveBeenCalledTimes(2)
      credentials.GOOGLE_PRIVATE_KEY = 'rotated-key'
      expect((await sync()).status).toBe(200)
      expect(token).toHaveBeenCalledTimes(3)
    } finally { clock.mockRestore() }
  })
  it('awaits sheet persistence, deduplicates retries, and deletes a freshly reordered row', async () => {
    const created = await create()
    const rows = [['Event','Name','Email'],[created.title,'Existing','existing@example.com']]
    await connect(rows)
    const path = `/api/events/${created.id}/rsvp`
    expect((await call(path,'POST',{name:'Jane',email:'jane@example.com'})).status).toBe(200)
    expect(rows).toHaveLength(3)
    expect((await call(path,'POST',{name:'Jane',email:'jane@example.com'})).status).toBe(200)
    expect(rows).toHaveLength(3)
    rows.splice(1,0,rows.pop()!)
    expect((await call(`/manage/api/events/${created.id}/rsvps`,'DELETE',{email:'jane@example.com'},true)).status).toBe(200)
    expect(rows).toEqual([['Event','Name','Email','Event ID'],[created.title,'Existing','existing@example.com',created.id]])
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
  })
  it('only reads the current sheet state and appends on a routine RSVP', async () => {
    const created = await create()
    await create({ title: 'Date TBA', date: '', startTime: '', endTime: '' })
    const rows = [['Event','Name','Email']]
    const sheet = await connect(rows)
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    // Sheets omits trailing empty cells, including the date on TBA events.
    for (const row of sheet.getRegistry()) while (row.at(-1) === '') row.pop()
    sheet.requests.length = 0
    const path = `/api/events/${created.id}/rsvp`
    expect((await call(path,'POST',{name:'Jane',email:'jane@example.com'})).status).toBe(200)
    expect(sheet.requests).toEqual(['metadata','registry','participants','append'])
    expect(rows[1]).toEqual([created.title,'Jane','jane@example.com',created.id])
    sheet.requests.length = 0
    expect((await call(path,'POST',{name:'Jane',email:'jane@example.com'})).status).toBe(200)
    expect(sheet.requests).toEqual(['metadata','registry','participants'])
    expect(rows).toHaveLength(2)
    await env.EVENTS_DB.exec("CREATE TRIGGER reject_unchanged_rsvp BEFORE UPDATE ON rsvps WHEN old.name = new.name BEGIN SELECT RAISE(ABORT, 'Unnecessary RSVP write'); END")
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    await env.EVENTS_DB.exec('DROP TRIGGER reject_unchanged_rsvp')
  })
  it.each(['normal', 'special'])('saves %s event details without contacting a linked Google Sheet', async (kind) => {
    const created = await create({ kind })
    await connect([['Event','Name','Email']])
    const sheetRequest = vi.fn(() => new HttpResponse(null, { status: 503 }))
    network.use(http.all('https://sheets.googleapis.com/*', sheetRequest))
    const changes = {
      location: 'New venue', room: 'Garden Room', description: 'Updated lesson program', startTime: '19:00',
      ...(kind === 'normal' ? { title: 'Monday swing', date: '2099-10-12' } : {}),
    }
    const response = await call(`/manage/api/events/${created.id}`, 'PUT', { ...created, ...changes }, true)
    expect(response.status).toBe(200)
    expect(sheetRequest).not.toHaveBeenCalled()
    const stored = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(created.id).first()
    expect(stored).toMatchObject(changes)
    expect((await call(`/manage/api/events/${created.id}`, 'PUT', { ...created, location: 'Stale venue' }, true)).status).toBe(409)
    expect(sheetRequest).not.toHaveBeenCalled()
  })
  it.each([{ title: 'Renamed dance' }, { date: '2099-10-12' }, { kind: 'normal' }])('keeps sheet persistence required for special event identity changes: %j', async (changes) => {
    const created = await create()
    await connect([['Event','Name','Email']], true)
    const response = await call(`/manage/api/events/${created.id}`, 'PUT', { ...created, ...changes }, true)
    expect(response.status).toBe(502)
    const stored = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(created.id).first()
    expect(stored).toMatchObject({ title: created.title, date: created.date, kind: created.kind, updatedAt: created.updatedAt })
  })
  it('does not return success or persist D1 when the connected sheet rejects a write', async () => {
    const created = await create()
    await connect([['Event','Name','Email']],true)
    expect((await call(`/api/events/${created.id}/rsvp`,'POST',{name:'Jane',email:'jane@example.com'})).status).toBe(502)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
  })
  it('mirrors sheet additions and removals without changing sheet rows', async () => {
    const created = await create()
    await call(`/api/events/${created.id}/rsvp`,'POST',{name:'Old',email:'old@example.com'})
    const rows = [['Event','Name','Email'],[created.title,'From sheet','sheet@example.com']]
    await connect(rows)
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    const stored = await env.EVENTS_DB.prepare('SELECT name,email FROM rsvps').all()
    expect(stored.results).toEqual([{name:'From sheet',email:'sheet@example.com'}])
    expect(rows).toHaveLength(2)
  })
  it('restores sheet titles if the database rejects a rename', async () => {
    const created = await create()
    const rows = [['Event','Name','Email'],[created.title,'Jane','jane@example.com']]
    await connect(rows)
    network.use(http.post('https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values:batchUpdate', async ({ request }) => {
      const body = await request.json() as { data: { range: string; values: string[][] }[] }
      for (const entry of body.data) if (!entry.range.includes('_Swing events') && /!A\d+/.test(entry.range)) rows[Number(entry.range.match(/!A(\d+)/)![1])-1][0] = entry.values[0][0]
      return HttpResponse.json({})
    }))
    await expect(changeEventWithSheet(env, created, 'New title', async () => { throw new Error('Database rejected update') }, 'special')).rejects.toThrow()
    expect(rows[1][0]).toBe(created.title)
  })
  it('migrates hidden IDs without changing visible rows and keeps identity through display edits, renames, and deletion', async () => {
    const created = await create()
    const other = await create({title:'Another event',date:'2099-10-11'})
    const rows = [['Event','Name','Email'],[created.title,'Jane','jane@example.com']]
    const sheet = await connect(rows)
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    expect(rows[1]).toEqual([created.title,'Jane','jane@example.com',created.id])
    expect(sheet.getRegistry()).toContainEqual([created.id,created.title,created.date])
    rows[1][0] = other.title
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    expect(await env.EVENTS_DB.prepare('SELECT eventId FROM rsvps').first('eventId')).toBe(created.id)
    expect((await call(`/manage/api/events/${created.id}`,'PUT',{...created,title:'Renamed event'},true)).status).toBe(200)
    expect(rows[1]).toEqual(['Renamed event','Jane','jane@example.com',created.id])
    expect(sheet.getRegistry()).toContainEqual([created.id,'Renamed event',created.date])
    expect((await call(`/manage/api/events/${created.id}`,'DELETE',undefined,true)).status).toBe(200)
    expect(rows).toEqual([['Event','Name','Email','Event ID']])
    expect(sheet.getRegistry().some(row => row[0]===created.id)).toBe(false)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
  })
  it('treats cleared visible RSVP cells as deletion and clears their remaining hidden ID', async () => {
    const created = await create()
    const rows = [['Event','Name','Email'],[created.title,'Jane','jane@example.com']]
    await connect(rows)
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    rows[1] = ['', '', '', created.id]
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(200)
    expect(rows[1]).toEqual(['','','',''])
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(1)
  })
  it('reports a duplicate title as a conflict without marking the sheet as failing', async () => {
    const first = await create({ title: 'Fall formal' })
    const second = await create({ title: 'Winter formal', date: '2099-10-11' })
    await connect([['Event','Name','Email']])
    const response = await call(`/manage/api/events/${second.id}`, 'PUT', { ...second, title: first.title }, true)
    expect(response.status).toBe(409)
    expect(await env.EVENTS_DB.prepare('SELECT error FROM rsvp_sheet_connection').first('error')).toBeNull()
  })
  it('deletes a weekly lesson without the sheet even when the sheet is failing', async () => {
    const lesson = await create({ kind: 'normal' })
    await connect([['Event','Name','Email']], true)
    expect((await call(`/manage/api/events/${lesson.id}`, 'DELETE', undefined, true)).status).toBe(200)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM events').first('count')).toBe(0)
  })
  it('rejects ambiguous event titles without importing any participants', async () => {
    const created = await create()
    await env.EVENTS_DB.prepare("INSERT INTO events (id,kind,title,date,updatedAt) VALUES ('duplicate','special',?,?,?)").bind(created.title,created.date,created.updatedAt).run()
    await connect([['Event','Name','Email'],[created.title,'Jane','jane@example.com']])
    expect((await call('/manage/api/rsvp-sheet/sync','POST',undefined,true)).status).toBe(502)
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM rsvps').first('count')).toBe(0)
  })
})

describe('redirect manager', () => {
  const lists = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/rules/lists`
  // A fake Bulk Redirect List: POST replaces items with the same source URL, as Cloudflare does.
  function fakeList(initial: { source_url: string; target_url: string; status_code?: number }[]) {
    let items = initial.map((redirect, index) => ({ id: `item-${index}`, redirect }))
    const operations: string[] = []
    network.use(
      http.get(`${lists}/${env.REDIRECT_LIST_ID}/items`, () => HttpResponse.json({ success: true, result: items, result_info: { cursors: {} } })),
      http.post(`${lists}/${env.REDIRECT_LIST_ID}/items`, async ({ request }) => {
        const added = await request.json() as typeof items
        for (const { redirect } of added) items = [...items.filter(item => item.redirect.source_url !== redirect.source_url), { id: crypto.randomUUID(), redirect }]
        operations.push(`add ${added.map(item => item.redirect.source_url).join(' ')}`)
        return HttpResponse.json({ success: true, result: { operation_id: 'op' } })
      }),
      http.delete(`${lists}/${env.REDIRECT_LIST_ID}/items`, async ({ request }) => {
        const ids = (await request.json() as { items: { id: string }[] }).items.map(item => item.id)
        operations.push(`delete ${items.filter(item => ids.includes(item.id)).map(item => item.redirect.source_url).join(' ')}`)
        items = items.filter(item => !ids.includes(item.id))
        return HttpResponse.json({ success: true, result: { operation_id: 'op' } })
      }),
      http.get(`${lists}/bulk_operations/op`, () => HttpResponse.json({ success: true, result: { status: 'completed' } })),
    )
    return operations
  }
  const redirect = { source: '/join/', destination: 'https://forms.example.com/join', code: 302 }

  it('stores both slash variants for swingsyndicate.club and lists only this site', async () => {
    const operations = fakeList([{ source_url: 'shamus.li/cv', target_url: 'https://example.com/cv' }])
    expect((await call('/redirects/api', 'POST', redirect, true)).status).toBe(200)
    expect(operations).toEqual(['add swingsyndicate.club/join swingsyndicate.club/join/'])
    expect(await (await call('/redirects/api', 'GET', undefined, true)).json()).toEqual([{ ...redirect, source: '/join' }])
  })

  it('adds a renamed redirect before deleting the old source', async () => {
    const operations = fakeList([{ source_url: 'swingsyndicate.club/join', target_url: redirect.destination, status_code: 302 }, { source_url: 'swingsyndicate.club/join/', target_url: redirect.destination, status_code: 302 }])
    expect((await call('/redirects/api', 'PUT', { source: '/join', redirect: { ...redirect, source: '/signup' } }, true)).status).toBe(200)
    expect(operations).toEqual(['add swingsyndicate.club/signup swingsyndicate.club/signup/', 'delete swingsyndicate.club/join swingsyndicate.club/join/'])
  })

  it.each(['/', '/manage', '/redirects/api', '/assets/logo.png'])('refuses to redirect %s, which the website uses', async (source) => {
    const operations = fakeList([])
    expect((await call('/redirects/api', 'POST', { ...redirect, source }, true)).status).toBe(400)
    expect(operations).toEqual([])
  })
})

describe('CampusGroups member list', () => {
  beforeEach(async () => { await env.MEMBER_CACHE.delete(campusGroupsKey) })
  it('names the General Risk tag for the August-to-July academic year in New York', () => {
    expect(generalRiskTag(new Date('2026-10-06T12:00:00Z'))).toBe('AY 26/27 - General Risk')
    expect(generalRiskTag(new Date('2027-03-01T12:00:00Z'))).toBe('AY 26/27 - General Risk')
    expect(generalRiskTag(new Date('2027-08-01T03:30:00Z'))).toBe('AY 26/27 - General Risk')
    expect(generalRiskTag(new Date('2027-08-15T12:00:00Z'))).toBe('AY 27/28 - General Risk')
    expect(generalRiskTag(new Date('2099-09-01T12:00:00Z'))).toBe('AY 99/00 - General Risk')
  })
  it('stores member and current-year waiver flags by lowercased email for managers only', async () => {
    const tag = generalRiskTag()
    const [start] = tag.match(/\d{2}/)!
    const stale = `AY ${String(Number(start) + 99).slice(-2)}/${start} - General Risk`
    const rows = [
      { email: ' Jane@Cornell.EDU ', memberType: 'Member', tags: `${tag}|Main Campus|Over 21` },
      { email: 'old@cornell.edu', memberType: 'Member', tags: `${stale}|Main Campus` },
      { email: 'contact@cornell.edu', memberType: 'Contact', tags: tag },
      { email: 'past@cornell.edu', memberType: 'Past Member', tags: '-' },
      { email: '', memberType: 'Member', tags: tag },
      ...Array.from({ length: 1500 }, (_, index) => ({ email: `guest${index}@cornell.edu`, memberType: 'Contact', tags: 'Main Campus|Over 21' })),
    ]
    expect((await call('/manage/api/campusgroups', 'PUT', { rows })).status).toBe(401)
    expect(await (await call('/manage/api/campusgroups', 'GET', undefined, true)).json()).toEqual({ uploadedAt: null, count: null, members: null, generalRisk: null })
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(90000)
    const response = await call('/manage/api/campusgroups', 'PUT', { rows }, true)
    const summary = await response.json() as { uploadedAt: string }
    expect(summary).toMatchObject({ count: 1504, members: 2, generalRisk: 2 })
    const stored = await env.MEMBER_CACHE.get<{ uploadedAt: string; people: Record<string, unknown> }>(campusGroupsKey, 'json')
    expect(stored!.uploadedAt).toBe(summary.uploadedAt)
    expect(stored!.people).toMatchObject({
      'jane@cornell.edu': { member: true, generalRisk: true },
      'old@cornell.edu': { member: true, generalRisk: false },
      'contact@cornell.edu': { member: false, generalRisk: true },
      'past@cornell.edu': { member: false, generalRisk: false },
    })
    expect(await (await call('/manage/api/campusgroups', 'GET', undefined, true)).json()).toEqual(summary)
    expect((await call('/manage/api/campusgroups', 'PUT', { rows: [{ email: 'jane@cornell.edu' }] }, true)).status).toBe(400)
  })
})

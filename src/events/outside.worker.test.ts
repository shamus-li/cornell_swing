import { env as runtimeEnv } from 'cloudflare:workers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { resetEventsDb } from '../../check-in/test/events-db'
import worker from './worker'
import type { OutsideEvent } from './outside'

const env = runtimeEnv as typeof runtimeEnv
const network = setupNetwork()
const origin = 'https://swingsyndicate.club'
let managerToken = ''
const manage = (path: string, method = 'GET', body?: unknown) => worker.fetch(new Request(`${origin}/manage/api${path}`, { method, headers: { origin, 'content-type': 'application/json', 'Cf-Access-Jwt-Assertion': managerToken }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
const contra = { groupName: 'Hands Four', title: 'An Evening of Contra and Swing', date: '2099-11-20', startTime: '19:00', endTime: '22:30', location: 'Lehman Alternative Community School', styles: ['Contra', 'Swing'], price: '', url: 'https://www.hands4dancers.org/upcoming-dances', published: true }

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
  network.enable()
  network.use(http.get(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, () => HttpResponse.json({ keys: [jwk] })))
  managerToken = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`).setAudience(env.ACCESS_AUD).setExpirationTime('1h').sign(privateKey)
  await resetEventsDb()
  await env.EVENTS_DB.exec('DELETE FROM outside_events')
})
afterAll(() => network.disable())

describe('other groups\' events', () => {
  it('lists published events on /events and keeps drafts off it', async () => {
    const created = await manage('/outside-events', 'POST', contra)
    expect(created.status).toBe(201)
    const { event } = await created.json() as { event: OutsideEvent }
    // Group names match without regard to case, so the second event joins the first one's group.
    expect((await manage('/outside-events', 'POST', { ...contra, groupName: 'hands four', title: 'Winter Afternoon of Contras', date: '2099-12-12', published: false })).status).toBe(201)
    expect((await manage(`/outside-events/${event.id}`, 'PUT', { ...contra, location: 'LACS' })).status).toBe(200)
    const listed = await (await manage('/outside-events')).json() as { events: OutsideEvent[]; groups: string[] }
    expect(listed.groups.filter(name => name.toLowerCase() === 'hands four')).toEqual(['Hands Four'])
    expect(listed.events.map(item => [item.title, item.groupName, item.location, item.styles])).toEqual([['An Evening of Contra and Swing', 'Hands Four', 'LACS', ['Swing', 'Contra']], ['Winter Afternoon of Contras', 'Hands Four', 'Lehman Alternative Community School', ['Swing', 'Contra']]])

    const assets = { ...env.ASSETS, fetch: async () => new Response('<div id="root"></div><script id="dances-data" type="application/json">null</script>', { headers: { 'Content-Type': 'text/html' } }) }
    const page = await (await worker.fetch(new Request(`${origin}/events`), { ...env, ASSETS: assets })).text()
    expect(page).toContain('An Evening of Contra and Swing')
    expect(page).toContain('<span class="nowrap">Contra</span>')
    expect(page).toContain('https://www.google.com/maps/search/?api=1&amp;query=LACS%2C%20Ithaca%2C%20NY')
    expect(page).not.toContain('Winter Afternoon of Contras')
  })

  it('saves visitors\' requests for review', async () => {
    const send = (body: unknown) => worker.fetch(new Request(`${origin}/api/event-requests`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env)
    const request = { ...contra, title: 'Contra Request', published: true, email: 'dancer@example.com' }
    expect((await send({ ...request, email: '' })).status).toBe(400)
    expect((await send({ ...request, date: '2000-01-01' })).status).toBe(400)
    expect((await send(request)).status).toBe(201)
    const listed = await (await manage('/outside-events')).json() as { events: OutsideEvent[] }
    expect(listed.events.find(event => event.title === 'Contra Request')).toMatchObject({ groupName: 'Hands Four', published: false, needsReview: true, sourceNote: 'Requested by dancer@example.com' })
    // Publishing ends the wait for review.
    const requested = listed.events.find(event => event.title === 'Contra Request')!
    const published = await (await manage(`/outside-events/${requested.id}`, 'PUT', { ...requested, published: true })).json() as { event: OutsideEvent }
    expect(published.event).toMatchObject({ published: true, needsReview: false })
  })

  it('rejects events without a known dance style', async () => {
    const response = await manage('/outside-events', 'POST', { ...contra, styles: ['Contra', 'Polka'] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Choose a dance style.' })
  })
})

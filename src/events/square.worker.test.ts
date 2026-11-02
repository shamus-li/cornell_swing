import { env as runtimeEnv } from 'cloudflare:workers'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import eventsMigration from '../../migrations/events/0001_events.sql?raw'
import roomMigration from '../../migrations/events/0004_event_room.sql?raw'
import publishedMigration from '../../migrations/events/0005_event_published.sql?raw'
import pricesMigration from '../../migrations/events/0006_event_prices.sql?raw'
import venmoMigration from '../../migrations/events/0008_venmo.sql?raw'
import gmailMigration from '../../migrations/events/0012_gmail.sql?raw'
import squareMigration from '../../migrations/events/0013_square.sql?raw'
import worker from './worker'
import { syncSquare } from './square'

vi.mock('../../check-in/worker/google', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../check-in/worker/google')>(),
  getGoogleAccessToken: vi.fn(async () => 'test-token'),
}))

const env = runtimeEnv as typeof runtimeEnv
const network = setupNetwork()
const origin = 'https://swingsyndicate.club'
let managerToken = ''
let ledger: { range: string; values: unknown[][] }[] = []
// Column N of the fake Ledger, by row number; row 1 is the header.
let ledgerIds: Record<number, string> = {}
// The connected Square account's payments.
let payments: Record<string, unknown>[] = []

const payment = (id: string, createdAt: string, cents: number, extra: Record<string, unknown> = {}) => ({ id, created_at: createdAt, status: 'COMPLETED', source_type: 'CARD', amount_money: { amount: cents, currency: 'USD' }, ...extra })
const fee = (cents: number) => ({ processing_fee: [{ amount_money: { amount: cents, currency: 'USD' } }] })
const manage = (path: string, method = 'GET') => worker.fetch(new Request(`${origin}/manage/api${path}`, { method, headers: { origin, 'Cf-Access-Jwt-Assertion': managerToken } }), env)
const callback = (query: string, cookie: string) => worker.fetch(new Request(`${origin}/manage/square/callback?${query}`, { headers: { cookie, 'Cf-Access-Jwt-Assertion': managerToken } }), env)
const ledgerRow = (id: string) => {
  const row = Object.entries(ledgerIds).find(([, value]) => value === id)?.[0]
  return ledger.filter(item => item.range === `'Ledger'!E${row}:J${row}`).at(-1)?.values[0]
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
  network.enable()
  network.use(
    http.get(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, () => HttpResponse.json({ keys: [jwk] })),
    http.post('https://connect.squareup.com/oauth2/token', () => HttpResponse.json({ access_token: 'square-token', refresh_token: 'refresh', expires_at: '2026-12-01T00:00:00Z', merchant_id: 'club' })),
    http.post('https://connect.squareup.com/oauth2/revoke', () => HttpResponse.json({ success: true })),
    http.get('https://connect.squareup.com/v2/merchants/club', () => HttpResponse.json({ merchant: { business_name: 'Swing Syndicate' } })),
    http.get('https://connect.squareup.com/v2/payments', ({ request }) => {
      const begin = new URL(request.url).searchParams.get('begin_time')!
      return HttpResponse.json({ payments: payments.filter(item => String(item.created_at) >= begin) })
    }),
    http.get('https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchGet', () => HttpResponse.json({ valueRanges: [{ values: [['Date'], ['2026-09-01']] }, { values: Array.from({ length: Math.max(1, ...Object.keys(ledgerIds).map(Number)) }, (_, index) => [index ? ledgerIds[index + 1] ?? '' : 'Transaction ID']) }] })),
    http.post('https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchUpdate', async ({ request }) => {
      const { data } = await request.json() as { data: { range: string; values: unknown[][] }[] }
      ledger.push(...data)
      for (const item of data) if (item.range.includes('!N')) ledgerIds[Number(item.range.split('!N')[1])] = String(item.values[0][0])
      return HttpResponse.json({})
    }),
  )
  managerToken = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`).setAudience(env.ACCESS_AUD).setExpirationTime('1h').sign(privateKey)
  for (const sql of [eventsMigration, roomMigration, publishedMigration, pricesMigration, venmoMigration, gmailMigration, squareMigration]) await env.EVENTS_DB.exec(sql.replace(/^--.*$/gm, '').replaceAll('\n', ' '))
})
afterAll(() => { network.disable(); vi.useRealTimers() })
beforeEach(async () => {
  // The night of the event.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
  ledger = []; ledgerIds = {}; payments = []
  await env.EVENTS_DB.exec('DELETE FROM square_payments; DELETE FROM events; DELETE FROM square_connection;')
  await env.EVENTS_DB.prepare("INSERT INTO square_connection (id, merchantId, name, accessToken, refreshToken, expiresAt, syncedAt) VALUES (1, 'club', 'Swing Syndicate', 'square-token', 'refresh', '2026-12-01T00:00:00Z', '2026-10-17T12:00:00Z')").run()
  await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, updatedAt) VALUES ('haunt', 'special', 'The Lindy Haunt', '2026-10-17', '18:15', '22:00', '2026-10-01T00:00:00Z')").run()
})

describe('Square feed', () => {
  it('connects the Square account an officer authorizes', async () => {
    await env.EVENTS_DB.exec('DELETE FROM square_connection')
    expect(await (await manage('/square')).json()).toEqual({ square: null, payments: [] })
    expect((await callback('state=forged&code=abc', 'square_state=real')).status).toBe(400)
    const response = await callback('state=real&code=abc', 'square_state=real')
    expect(response.headers.get('location')).toBe('/manage?view=finances')
    expect(await (await manage('/square')).json()).toMatchObject({ square: 'Swing Syndicate' })
    await manage('/square', 'DELETE')
    expect(await (await manage('/square')).json()).toMatchObject({ square: null })
  })
  it('files door payments as card, cash and fee rows for the event', async () => {
    payments.push(
      payment('card-1', '2026-10-17T22:30:00Z', 1000, fee(41)),
      payment('card-2', '2026-10-17T23:10:00Z', 500, fee(28)),
      payment('cash-1', '2026-10-17T23:15:00Z', 1000, { source_type: 'CASH' }),
      payment('failed', '2026-10-17T23:20:00Z', 1000, { status: 'FAILED' }),
      payment('shirt', '2026-10-17T15:00:00Z', 2000, { ...fee(67), note: 'T-shirt' }),
    )
    await syncSquare(env)
    expect(ledgerRow('square-card:haunt')).toEqual(['Income', 'Ticket sales', 'Door payments (Square)', 15, 'Square', 'Paid'])
    expect(ledgerRow('square-cash:haunt')).toEqual(['Income', 'Ticket sales', 'Door payments (cash)', 10, 'Cash', 'Paid'])
    expect(ledgerRow('square-fees:haunt')).toEqual(['Expense', 'Fees', 'Square fees', 0.69, 'Square', 'Paid'])
    expect(ledgerRow('square:shirt')).toEqual(['Income', 'Other income', 'Square payment: T-shirt', 20, 'Square', 'Paid'])
    expect(await (await manage('/square')).json()).toMatchObject({ payments: [{ id: 'cash-1', event: 'The Lindy Haunt', cash: true, amount: 1000 }, { id: 'card-2' }, { id: 'card-1' }, { id: 'shirt', event: null }] })

    // A refund the next day updates the event's row in place.
    ledger = []
    payments[0] = payment('card-1', '2026-10-17T22:30:00Z', 1000, { ...fee(41), refunded_money: { amount: 1000, currency: 'USD' } })
    await syncSquare(env)
    expect(ledger.filter(item => item.range.includes('!E'))).toHaveLength(3)
    expect(ledgerRow('square-card:haunt')).toEqual(['Income', 'Ticket sales', 'Door payments (Square)', 5, 'Square', 'Paid'])
  })
  it('asks to connect again once Square access is removed', async () => {
    network.use(http.get('https://connect.squareup.com/v2/payments', () => HttpResponse.json({ errors: [{ code: 'UNAUTHORIZED' }] }, { status: 401 })))
    await syncSquare(env)
    expect(await (await manage('/square')).json()).toMatchObject({ square: null })
  })
})

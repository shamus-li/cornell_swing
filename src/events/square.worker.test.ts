import { env as runtimeEnv } from 'cloudflare:workers'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { resetEventsDb } from '../../check-in/test/events-db'
import worker from './worker'
import { fileNow, syncSquare } from './square'
import type { EventActivity, FinanceOverview } from './finance'

vi.mock('../../check-in/worker/google', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../check-in/worker/google')>(),
  getGoogleAccessToken: vi.fn(async () => 'test-token'),
}))

const env = runtimeEnv as typeof runtimeEnv
const network = setupNetwork()
const origin = 'https://swingsyndicate.club'
let managerToken = ''
let sheetReads = 0
let ledger: { range: string; values: unknown[][] }[] = []
// The fake Transaction History's ID and source columns, by row number; row 1 is the header.
type SheetRow = { id: string; source: string; amount: string | number }
let sheet: Record<number, SheetRow> = {}
// The connected Square account's payments.
let payments: Record<string, unknown>[] = []

const payment = (id: string, createdAt: string, cents: number, extra: Record<string, unknown> = {}) => ({ id, created_at: createdAt, status: 'COMPLETED', source_type: 'CARD', amount_money: { amount: cents, currency: 'USD' }, ...extra })
const fee = (cents: number) => ({ processing_fee: [{ amount_money: { amount: cents, currency: 'USD' } }] })
const manage = (path: string, method = 'GET') => worker.fetch(new Request(`${origin}/manage/api${path}`, { method, headers: { origin, 'Cf-Access-Jwt-Assertion': managerToken } }), env)
const callback = (query: string, cookie: string) => worker.fetch(new Request(`${origin}/manage/square/callback?${query}`, { headers: { cookie, 'Cf-Access-Jwt-Assertion': managerToken } }), env)
const ledgerRow = (id: string, source: string) => {
  const row = Object.entries(sheet).find(([, value]) => value.id === id && value.source === source)?.[0]
  return ledger.filter(item => item.range === `'Transaction History'!A${row}:F${row}`).at(-1)?.values[0]
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
    http.get('https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchGet', ({ request }) => {
      // The Finances tab's read of the Balance Sheet.
      const ranges = new URL(request.url).searchParams.getAll('ranges')
      if (ranges[0].endsWith('A2:I')) sheetReads++
      if (ranges[0].endsWith('A2:I')) return HttpResponse.json({ valueRanges: [
        { values: [['26-27', 46283, 10, 'Cash', 'Y', 'Fall 26 The Lindy Haunt: Cash Profits', '', 'haunt'], ['26-27', 46286, -400, 'GPSA', 'Y', 'Fall 26 The Lindy Haunt: Ageless Jazz Band', '', '', 'haunt'], ['26-27', 46300, -25, 'GPSA', 'Y', 'Band tip']] },
        { values: [['GPSA', 0, 3500, -950, 2550], ['Venmo', 0, 0, 0, 0], ['Cash', 989, 225, 0, 1214], ['Totals', 989, 3725, -950, 3764]] },
        { values: [[1214.78]] },
      ].slice(0, ranges.length) })
      const rows = Math.max(1, ...Object.keys(sheet).map(Number))
      const column = (read: (row: SheetRow) => string, header: string) => ({ values: Array.from({ length: rows }, (_, index) => [index ? read(sheet[index + 1] ?? { id: '', source: '', amount: '' }) : header]) })
      return HttpResponse.json({ valueRanges: [column(() => '2026-09-01', 'Date'), column(row => row.amount as string, 'Amount'), column(row => row.source, 'Source'), column(row => row.id, 'Event ID')] })
    }),
    // The check-in sheet: Oct 17, 2026 at 7:12 PM.
    http.get('https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range', () => HttpResponse.json({ values: [[46312.8, 'Maya', 'maya@example.edu', '', 'Community Member', '', 'haunt'], [46312.8, 'Lesson', 'lesson@example.edu', '', 'Community Member', '', 'normal-2026-10-17']] })),
    http.get('https://sheets.googleapis.com/v4/spreadsheets/:id', () => HttpResponse.json({ sheets: [{ properties: { sheetId: 77, title: 'Transaction History' } }] })),
    http.post(/spreadsheets\/[^/]+:batchUpdate$/, async ({ request }) => {
      const { requests } = await request.json() as { requests: { deleteDimension: { range: { sheetId: number; startIndex: number } } }[] }
      for (const { deleteDimension: { range } } of requests) {
        expect(range.sheetId).toBe(77)
        const row = range.startIndex + 1
        const last = Math.max(...Object.keys(sheet).map(Number))
        for (let at = row; at <= last; at++) { if (sheet[at + 1]) sheet[at] = sheet[at + 1]; else delete sheet[at] }
      }
      return HttpResponse.json({})
    }),
    http.post('https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchUpdate', async ({ request }) => {
      const { data } = await request.json() as { data: { range: string; values: unknown[][] }[] }
      ledger.push(...data)
      for (const item of data) {
        const at = Number(item.range.match(/\d+$/)![0])
        sheet[at] ??= { id: '', source: '', amount: '' }
        if (item.range.includes('!A')) { sheet[at].source = String(item.values[0][3]); sheet[at].amount = item.values[0][2] as number }
        else sheet[at].id = String(item.values[0][0])
      }
      return HttpResponse.json({})
    }),
  )
  managerToken = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`).setAudience(env.ACCESS_AUD).setExpirationTime('1h').sign(privateKey)
  await resetEventsDb()
})
afterAll(() => { network.disable(); vi.useRealTimers() })
beforeEach(async () => {
  // The night of the event.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
  ledger = []; sheet = {}; payments = []
  await env.EVENTS_DB.exec('DELETE FROM square_payments; DELETE FROM events; DELETE FROM square_connection;')
  await env.EVENTS_DB.prepare("INSERT INTO square_connection (id, merchantId, name, accessToken, refreshToken, expiresAt, syncedAt) VALUES (1, 'club', 'Swing Syndicate', 'square-token', 'refresh', '2026-12-01T00:00:00Z', '2026-10-17T12:00:00Z')").run()
  await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, updatedAt) VALUES ('haunt', 'special', 'The Lindy Haunt 👻', '2026-10-17', '18:15', '22:00', '2026-10-01T00:00:00Z')").run()
})

describe('Square feed', () => {
  it('connects the Square account an officer authorizes', async () => {
    await env.EVENTS_DB.exec('DELETE FROM square_connection')
    expect(await (await manage('/square')).json()).toEqual({ square: null })
    expect((await callback('state=forged&code=abc', 'square_state=real')).status).toBe(400)
    const response = await callback('state=real&code=abc', 'square_state=real')
    expect(response.headers.get('location')).toBe('/manage?tab=settings')
    expect(await (await manage('/square')).json()).toMatchObject({ square: 'Swing Syndicate' })
    await manage('/square', 'DELETE')
    expect(await (await manage('/square')).json()).toMatchObject({ square: null })
  })
  it('files door payments as Square and cash rows for the event', async () => {
    payments.push(
      payment('card-1', '2026-10-17T22:30:00Z', 1000, fee(41)),
      payment('card-2', '2026-10-17T23:10:00Z', 500, fee(28)),
      payment('cash-1', '2026-10-17T23:15:00Z', 1000, { source_type: 'CASH' }),
      payment('failed', '2026-10-17T23:20:00Z', 1000, { status: 'FAILED' }),
      payment('shirt', '2026-10-17T15:00:00Z', 2000, { ...fee(67), note: 'T-shirt' }),
    )
    await syncSquare(env)
    expect(ledgerRow('haunt', 'Square')).toEqual(['26-27', 46312, 14.31, 'Square', 'Y', 'Fall 26 The Lindy Haunt: Square Profits'])
    expect(ledgerRow('haunt', 'Cash')).toEqual(['26-27', 46312, 10, 'Cash', 'Y', 'Fall 26 The Lindy Haunt: Cash Profits'])
    expect(ledgerRow('payments-2026-10-17', 'Square')).toEqual(['26-27', 46312, 19.33, 'Square', 'Y', 'Square payments'])
    const overview = await (await manage('/finance')).json() as FinanceOverview
    expect(overview.accounts).toEqual([
      { name: 'GPSA', start: 0, moneyIn: 3500, moneyOut: 950, balance: 2550, check: null },
      { name: 'Cash box', start: 989, moneyIn: 225, moneyOut: 0, balance: 1214, check: { source: 'Last count', difference: 0.78 } },
    ])
    expect(overview.transactions.find(item => item.id === 'cash-1')).toMatchObject({ eventId: 'haunt', eventName: 'The Lindy Haunt 👻', amount: 10, account: 'Cash' })
    expect(overview.transactions.some(item => item.description === 'Square Profits')).toBe(false)
    // The next page gets the saved copy without waiting on Google, then asks for the sheet as it is now.
    expect(sheetReads).toBe(1)
    await manage('/finance')
    expect(sheetReads).toBe(1)
    await manage('/finance?fresh=1')
    expect(sheetReads).toBe(2)
    const activity = await (await manage('/events/haunt/activity')).json() as EventActivity
    expect(activity.checkins).toEqual([{ name: 'Maya', email: 'maya@example.edu', memberId: '', time: '7:12 PM', ticket: null }])
    expect(activity.transactions.map(item => item.description)).toContain('Ageless Jazz Band')
    expect(activity.transactions.some(item => item.id === 'shirt')).toBe(false)

    // A refund the next day updates the event's row in place.
    ledger = []
    payments[0] = payment('card-1', '2026-10-17T22:30:00Z', 1000, { ...fee(41), refunded_money: { amount: 1000, currency: 'USD' } })
    await syncSquare(env)
    expect(ledger.filter(item => item.range.includes('!A'))).toHaveLength(2)
    expect(ledgerRow('haunt', 'Square')).toEqual(['26-27', 46312, 4.31, 'Square', 'Y', 'Fall 26 The Lindy Haunt: Square Profits'])

    // A full refund removes the row instead of leaving the old total behind.
    payments[2] = payment('cash-1', '2026-10-17T23:15:00Z', 1000, { source_type: 'CASH', refunded_money: { amount: 1000, currency: 'USD' } })
    await syncSquare(env)
    expect(Object.values(sheet).some(row => row.id === 'haunt' && row.source === 'Cash')).toBe(false)
  })
  it('batches a day of payments outside an event into one row', async () => {
    payments.push(payment('shirt', '2026-10-17T15:00:00Z', 2000, fee(67)))
    await syncSquare(env)
    payments.push(payment('hat', '2026-10-17T15:30:00Z', 1000, fee(41)))
    await syncSquare(env)
    expect(Object.values(sheet)).toMatchObject([{ id: 'payments-2026-10-17', source: 'Square' }])
    expect(ledgerRow('payments-2026-10-17', 'Square')?.[2]).toBe(28.92)
  })
  it('adds no row for a total of zero', async () => {
    payments.push(payment('card-1', '2026-10-17T22:30:00Z', 1000, fee(41)))
    await syncSquare(env)
    expect(ledgerRow('haunt', 'Square')?.[2]).toBe(9.59)
    expect(ledgerRow('haunt', 'Cash')).toBeUndefined()
  })
  it('files now, catching a refund on an older payment and removing rows that reached zero', async () => {
    // Filed months ago, and refunded since, so the morning job no longer lists it.
    payments.push(payment('old', '2026-03-01T15:00:00Z', 1000, { source_type: 'CASH' }))
    await fileNow(env)
    expect(Object.values(sheet)).toMatchObject([{ id: 'payments-2026-03-01', source: 'Cash', amount: 10 }])
    payments[0] = payment('old', '2026-03-01T15:00:00Z', 1000, { source_type: 'CASH', refunded_money: { amount: 1000, currency: 'USD' } })
    await syncSquare(env)
    expect(Object.values(sheet)).toMatchObject([{ id: 'payments-2026-03-01', amount: 10 }])
    // A row someone typed, an event's blank placeholder and an already zero site row.
    sheet[3] = { id: '', source: 'Square', amount: 0 }
    sheet[4] = { id: 'upcoming', source: 'Square', amount: '' }
    sheet[5] = { id: 'payments-2026-10-01', source: 'Cash', amount: 0 }
    expect((await manage('/finance/file', 'POST')).status).toBe(200)
    expect(Object.values(sheet)).toMatchObject([{ id: '', source: 'Square', amount: 0 }, { id: 'upcoming', source: 'Square', amount: '' }])
  })
  it('keeps a refunded card sale on the sheet as the fee Square kept', async () => {
    payments.push(payment('card', '2026-10-17T15:00:00Z', 1000, fee(41)))
    await syncSquare(env)
    payments[0] = payment('card', '2026-10-17T15:00:00Z', 1000, { ...fee(41), refunded_money: { amount: 1000, currency: 'USD' } })
    await syncSquare(env)
    expect(ledgerRow('payments-2026-10-17', 'Square')?.[2]).toBe(-0.41)
  })
  it('counts tickets from what was kept after refunds', async () => {
    const charge = (id: string, status: string, amount: number, paymentId: string | null) => env.EVENTS_DB.prepare("INSERT INTO door_charges (id, eventId, sessionDate, email, attendee, ticketName, amount, days, status, paymentId, createdAt) VALUES (?, 'haunt', '2026-10-17', ?, '{}', 'Student', ?, 1, ?, ?, '')").bind(id, `${id}@example.edu`, amount, status, paymentId).run()
    const paid = (id: string, amount: number) => env.EVENTS_DB.prepare("INSERT INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) VALUES (?, '2026-10-17T23:00:00Z', ?, 0, 0, '', 'haunt')").bind(id, amount).run()
    await env.EVENTS_DB.exec('DELETE FROM door_charges')
    await charge('kept', 'card', 1000, 'p-kept'); await paid('p-kept', 1000)
    await charge('partial', 'card', 1000, 'p-partial'); await paid('p-partial', 400)
    await charge('refunded', 'cash', 1000, 'p-refunded'); await paid('p-refunded', 0)
    await charge('unsent', 'cash', 1000, null); await paid('unsent:unsent', 1000)
    await charge('volunteer', 'waived', 0, null)
    const activity = await (await manage('/events/haunt/activity')).json() as EventActivity
    expect(activity.tickets).toEqual([{ name: 'Student', count: 4, amount: 24 }])
    await env.EVENTS_DB.exec('DELETE FROM door_charges')
  })
  it('adds what an uploaded CampusGroups export has that the sheet is missing', async () => {
    ledger = []
    const row = (source: string, amount: string, paymentStatus: string, item: string, date: string) => ({ source, amount, paymentStatus, item, date })
    const upload = await worker.fetch(new Request(`${origin}/manage/api/finance/campusgroups`, { method: 'PUT', headers: { origin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': managerToken }, body: JSON.stringify({ rows: [
      row('GPSAFC - FY27', '-400', 'Approved', 'Already on the sheet', '9/21/2026 8:24:18 PM'),
      row('GPSAFC - FY27', '-75', 'Pending Approval', 'Room booking', '10/1/2026 3:00:00 PM'),
      row('Outside Funding - FY27', '-30', 'Approved', 'Snacks', '10/2/2026'),
      row('GPSAFC - FY27', '-90', 'Rejected', 'Turned down', '10/3/2026 3:00:00 PM'),
      row('GPSAFC - FY20', '-500', 'Approved', 'Before the sheet starts', '3/16/2020 12:31:06 PM'),
    ] }) }), env)
    expect(upload.status).toBe(200)
    expect(ledger.map(item => item.values[0])).toEqual([
      ['26-27', 46296, -75, 'GPSA', 'Incomplete', 'Room booking'],
      ['26-27', 46297, -30, 'Outside Funding', 'Y', 'Snacks'],
    ])
    expect(ledger.every(item => item.range.includes('!A'))).toBe(true)
    await env.MEMBER_CACHE.delete('finance:campusgroups:v1')
  })
  it('links a treasurer row to an event, and refuses once the sheet has moved that row', async () => {
    ledger = []
    const link = (body: object) => worker.fetch(new Request(`${origin}/manage/api/finance/link`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': managerToken }, body: JSON.stringify(body) }), env)
    const tip = { id: 'sheet-2', date: '2026-10-05', amount: -25, description: 'Band tip' }
    expect((await link({ ...tip, eventId: 'haunt' })).status).toBe(200)
    expect(ledger).toEqual([{ range: "'Transaction History'!I4", values: [['haunt']] }])
    ledger = []
    expect((await link({ ...tip, eventId: null })).status).toBe(200)
    expect(ledger).toEqual([{ range: "'Transaction History'!I4", values: [['']] }])
    ledger = []
    expect((await link({ ...tip, id: 'sheet-1', eventId: 'haunt' })).status).toBe(409)
    expect((await link({ ...tip, eventId: 'gone' })).status).toBe(409)
    expect((await link({ id: 'sheet-0', date: '2026-09-18', amount: 10, description: 'Fall 26 The Lindy Haunt: Cash Profits', eventId: 'haunt' })).status).toBe(409)
    expect(ledger).toEqual([])
  })
  it('refuses to file while another filing is running', async () => {
    await env.EVENTS_DB.prepare("INSERT INTO filing_lock (id, until) VALUES (1, ?)").bind(new Date(Date.now() + 60_000).toISOString()).run()
    expect((await manage('/finance/file', 'POST')).status).toBe(409)
    await env.EVENTS_DB.exec('DELETE FROM filing_lock')
  })
  it('asks to connect again once Square access is removed', async () => {
    network.use(http.get('https://connect.squareup.com/v2/payments', () => HttpResponse.json({ errors: [{ code: 'UNAUTHORIZED' }] }, { status: 401 })))
    await syncSquare(env)
    expect(await (await manage('/square')).json()).toMatchObject({ square: null })
  })
})

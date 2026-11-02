import { dateKeyInTimeZone, timestampForSheet } from '../../check-in/worker/google'
import type { SquareFeed, SquarePayment } from './finance'
import { upsertLedgerRows, type LedgerRow } from './ledger'
import { logError } from './logging'

// An officer connects the club's Square account from the Finances tab. The site then reads its payments
// on SQUARE_CRON and files them on the finance sheet's Ledger.
export const SQUARE_CRON = '*/10 * * * *'
const SQUARE = 'https://connect.squareup.com'
const VERSION = '2025-01-23'
// Payments are listed again for this long, so refunds and fees that settle later still reach the Ledger.
const RELIST_MS = 3 * 86_400_000

type Connection = { merchantId: string; accessToken: string; refreshToken: string; expiresAt: string; syncedAt: string }
type Money = { amount: number }
type Payment = { id: string; created_at: string; status: string; source_type: string; amount_money: Money; refunded_money?: Money; processing_fee?: { amount_money: Money }[]; note?: string }
type Tokens = { access_token: string; refresh_token: string; expires_at: string; merchant_id: string }
type Event = { id: string; date: string; startTime: string; endTime: string }

class SquareAuthError extends Error {}

const redirectUri = (origin: string) => `${origin}/manage/square/callback`

export function squareConnectUrl(env: Env, origin: string, state: string): string {
  const url = new URL(`${SQUARE}/oauth2/authorize`)
  url.search = new URLSearchParams({ client_id: env.SQUARE_APPLICATION_ID, scope: 'PAYMENTS_READ MERCHANT_PROFILE_READ', redirect_uri: redirectUri(origin), state }).toString()
  return url.toString()
}

async function oauth(env: Env, params: Record<string, string>): Promise<Tokens> {
  const response = await fetch(`${SQUARE}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Square-Version': VERSION }, body: JSON.stringify({ client_id: env.SQUARE_APPLICATION_ID, client_secret: env.SQUARE_APPLICATION_SECRET, ...params }) })
  if (response.status === 400 || response.status === 401) throw new SquareAuthError(await response.text())
  if (!response.ok) throw new Error(`Square returned ${response.status}`)
  return response.json() as Promise<Tokens>
}

async function api<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${SQUARE}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Square-Version': VERSION } })
  if (response.status === 401) throw new SquareAuthError(await response.text())
  if (!response.ok) throw new Error(`Square returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function connectSquare(env: Env, origin: string, code: string): Promise<void> {
  const tokens = await oauth(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(origin) })
  const { merchant } = await api<{ merchant: { business_name?: string } }>(tokens.access_token, `/v2/merchants/${tokens.merchant_id}`)
  // Reconnecting the same account keeps its place; a different account starts from now.
  await env.EVENTS_DB.prepare('INSERT INTO square_connection (id, merchantId, name, accessToken, refreshToken, expiresAt, syncedAt) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, accessToken = excluded.accessToken, refreshToken = excluded.refreshToken, expiresAt = excluded.expiresAt, syncedAt = CASE WHEN merchantId = excluded.merchantId THEN syncedAt ELSE excluded.syncedAt END, merchantId = excluded.merchantId')
    .bind(tokens.merchant_id, merchant.business_name || 'Square', tokens.access_token, tokens.refresh_token, tokens.expires_at, new Date().toISOString()).run()
  await syncSquare(env).catch(error => logError('Square sync failed', error))
}

export async function disconnectSquare(env: Env): Promise<void> {
  const merchantId = await env.EVENTS_DB.prepare('SELECT merchantId FROM square_connection').first<string>('merchantId')
  await env.EVENTS_DB.prepare('DELETE FROM square_connection').run()
  if (merchantId) await fetch(`${SQUARE}/oauth2/revoke`, { method: 'POST', headers: { Authorization: `Client ${env.SQUARE_APPLICATION_SECRET}`, 'Content-Type': 'application/json', 'Square-Version': VERSION }, body: JSON.stringify({ client_id: env.SQUARE_APPLICATION_ID, merchant_id: merchantId }) })
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

// The event a payment was taken at: one that day whose times, widened for early and late payers, include it.
async function eventAt(env: Env, paidAt: string): Promise<string | null> {
  const ms = Date.parse(paidAt)
  const serial = timestampForSheet(ms, env.TIME_ZONE)
  const minutes = (serial - Math.floor(serial)) * 24 * 60
  const events = (await env.EVENTS_DB.prepare('SELECT id, date, startTime, endTime FROM events WHERE date = ? ORDER BY startTime').bind(dateKeyInTimeZone(ms, env.TIME_ZONE)).all<Event>()).results
  return events.find(event => (!event.startTime || minutes >= minutesOf(event.startTime) - 120) && (!event.endTime || minutes <= minutesOf(event.endTime) + 180))?.id ?? null
}

async function savePayment(env: Env, payment: Payment): Promise<void> {
  const amount = payment.amount_money.amount - (payment.refunded_money?.amount ?? 0)
  const fee = (payment.processing_fee ?? []).reduce((sum, item) => sum + item.amount_money.amount, 0)
  await env.EVENTS_DB.prepare('INSERT INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET amount = excluded.amount, fee = excluded.fee, synced = 0 WHERE amount != excluded.amount OR fee != excluded.fee')
    .bind(payment.id, payment.created_at, amount, fee, payment.source_type === 'CASH' ? 1 : 0, payment.note ?? '', await eventAt(env, payment.created_at)).run()
}

export async function syncSquare(env: Env): Promise<void> {
  const connection = await env.EVENTS_DB.prepare('SELECT merchantId, accessToken, refreshToken, expiresAt, syncedAt FROM square_connection').first<Connection>()
  if (!connection) return
  const startedAt = new Date().toISOString()
  try {
    let token = connection.accessToken
    if (Date.parse(connection.expiresAt) - Date.now() < 86_400_000) {
      const tokens = await oauth(env, { grant_type: 'refresh_token', refresh_token: connection.refreshToken })
      token = tokens.access_token
      await env.EVENTS_DB.prepare('UPDATE square_connection SET accessToken = ?, expiresAt = ? WHERE id = 1').bind(tokens.access_token, tokens.expires_at).run()
    }
    const begin = new Date(Date.parse(connection.syncedAt) - RELIST_MS).toISOString()
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ begin_time: begin, sort_order: 'ASC', limit: '100', ...cursor && { cursor } })
      const page = await api<{ payments?: Payment[]; cursor?: string }>(token, `/v2/payments?${query}`)
      for (const payment of page.payments ?? []) if (payment.status === 'COMPLETED') await savePayment(env, payment)
      cursor = page.cursor
    } while (cursor)
  } catch (error) {
    // Access was removed in Square, so the Finances tab asks to connect again.
    if (!(error instanceof SquareAuthError)) throw error
    await env.EVENTS_DB.prepare('DELETE FROM square_connection').run()
    logError('Square access was revoked', error)
    return
  }
  await env.EVENTS_DB.prepare('UPDATE square_connection SET syncedAt = ? WHERE id = 1').bind(startedAt).run()
  await syncLedger(env)
}

type Stored = { id: string; paidAt: string; amount: number; fee: number; cash: number; note: string; eventId: string | null }

// Payments during an event become one card row, one cash row and one fee row for that event, recomputed
// from every payment so the totals stay right however often it runs. Other payments get rows of their own.
async function syncLedger(env: Env): Promise<void> {
  const pending = (await env.EVENTS_DB.prepare('SELECT id, paidAt, amount, fee, cash, note, eventId FROM square_payments WHERE synced = 0').all<Stored>()).results
  if (!pending.length) return
  const rows: LedgerRow[] = []
  const row = (id: string, date: string, eventDate: string, type: LedgerRow['type'], category: string, description: string, cents: number, account: string) =>
    cents && rows.push({ id, date, eventDate, type, category, description, amount: cents / 100, account, status: 'Paid' })
  for (const eventId of new Set(pending.map(payment => payment.eventId).filter(id => id !== null))) {
    const date = await env.EVENTS_DB.prepare('SELECT date FROM events WHERE id = ?').bind(eventId).first<string>('date') ?? ''
    const totals = (await env.EVENTS_DB.prepare('SELECT SUM(amount * (1 - cash)) AS card, SUM(amount * cash) AS cash, SUM(fee) AS fees FROM square_payments WHERE eventId = ?').bind(eventId).first<{ card: number; cash: number; fees: number }>())!
    row(`square-card:${eventId}`, date, date, 'Income', 'Ticket sales', 'Door payments (Square)', totals.card, 'Square')
    row(`square-cash:${eventId}`, date, date, 'Income', 'Ticket sales', 'Door payments (cash)', totals.cash, 'Cash')
    row(`square-fees:${eventId}`, date, date, 'Expense', 'Fees', 'Square fees', totals.fees, 'Square')
  }
  for (const payment of pending.filter(payment => payment.eventId === null)) {
    const date = dateKeyInTimeZone(Date.parse(payment.paidAt), env.TIME_ZONE)
    row(`square:${payment.id}`, date, '', 'Income', 'Other income', `Square payment${payment.note ? `: ${payment.note}` : ''}`, payment.amount, payment.cash ? 'Cash' : 'Square')
    row(`square-fee:${payment.id}`, date, '', 'Expense', 'Fees', 'Square fee', payment.fee, 'Square')
  }
  await upsertLedgerRows(env, rows)
  await env.EVENTS_DB.batch(pending.map(payment => env.EVENTS_DB.prepare('UPDATE square_payments SET synced = 1 WHERE id = ?').bind(payment.id)))
}

export async function squareFeed(env: Env): Promise<SquareFeed> {
  const [square, payments] = await Promise.all([
    env.EVENTS_DB.prepare('SELECT name FROM square_connection').first<string>('name'),
    env.EVENTS_DB.prepare('SELECT p.id, p.paidAt, p.amount, p.cash, p.note, e.title AS event FROM square_payments p LEFT JOIN events e ON e.id = p.eventId ORDER BY p.paidAt DESC LIMIT 50').all<Omit<SquarePayment, 'cash'> & { cash: number }>(),
  ])
  return { square, payments: payments.results.map(payment => ({ ...payment, cash: payment.cash === 1 })) }
}

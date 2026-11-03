import { findCharge, settleCardCharge } from '../../check-in/worker/door'
import { findSession } from '../../check-in/worker/events'
import { sendAlert } from './alert-email'
import { dateKeyInTimeZone, timestampForSheet } from '../../check-in/worker/google'
import type { SquareFeed, SquarePayment } from './finance'
import { upsertLedgerRows, type LedgerRow } from './ledger'
import { logError } from './logging'

// An officer connects the club's Square account from the Finances tab. The site then reads its payments
// on SQUARE_CRON and files them on the Balance Sheet.
export const SQUARE_CRON = '*/10 * * * *'
const SQUARE = 'https://connect.squareup.com'
const VERSION = '2025-01-23'
// Payments are listed again for this long, so refunds and fees that settle later still reach the Balance Sheet.
const RELIST_MS = 3 * 86_400_000

type Connection = { merchantId: string; accessToken: string; refreshToken: string; expiresAt: string; syncedAt: string }
type Money = { amount: number }
type Payment = { id: string; created_at: string; status: string; source_type: string; amount_money: Money; refunded_money?: Money; processing_fee?: { amount_money: Money }[]; note?: string }
type Tokens = { access_token: string; refresh_token: string; expires_at: string; merchant_id: string }

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

async function savePayment(env: Env, payment: Payment): Promise<void> {
  const amount = payment.amount_money.amount - (payment.refunded_money?.amount ?? 0)
  const fee = (payment.processing_fee ?? []).reduce((sum, item) => sum + item.amount_money.amount, 0)
  // The door queue puts its charge's ID in the note, which ties the payment to that person and event.
  const chargeId = payment.note?.match(/door:(\S+)/)?.[1]
  const charge = chargeId ? await findCharge(env, chargeId) : null
  const known = await env.EVENTS_DB.prepare('SELECT 1 FROM square_payments WHERE id = ?').bind(payment.id).first()
  const paidAt = Date.parse(payment.created_at)
  const eventId = charge?.eventId ?? (await findSession(env, timestampForSheet(paidAt, env.TIME_ZONE)))?.id ?? null
  await env.EVENTS_DB.prepare('INSERT INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET amount = excluded.amount, fee = excluded.fee, synced = 0 WHERE amount != excluded.amount OR fee != excluded.fee')
    .bind(payment.id, payment.created_at, amount, fee, payment.source_type === 'CASH' ? 1 : 0, payment.note ?? '', eventId).run()
  if (!charge) return
  if (charge.status === 'pending' && payment.amount_money.amount === charge.amount) return settleCardCharge(env, charge, payment.id, paidAt)
  // Money came in that doesn't match what the person owes, or they had already paid another way.
  if (!known) await sendAlert(env, 'A door payment needs checking', [
    `Square took $${(payment.amount_money.amount / 100).toFixed(2)} for ${charge.email}, whose ${charge.ticketName} ticket costs $${(charge.amount / 100).toFixed(2)} and was ${charge.status === 'pending' ? 'still waiting for payment' : `already marked ${charge.status}`}.`,
    'They may need a refund in Square, or to be checked in by hand.',
  ]).catch((error: unknown) => logError('Door payment alert failed', error))
}

// Reads new payments from Square, which settles any door charge they pay for.
export async function syncPayments(env: Env): Promise<void> {
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
}

// Only the cron and connecting run this, because two writers at once could claim the same new row on the sheet.
export async function syncSquare(env: Env): Promise<void> {
  await syncPayments(env)
  await syncLedger(env)
}

type Stored = { id: string; paidAt: string; amount: number; fee: number; cash: number; note: string; eventId: string | null }

// "Fall 26 The Lindy Haunt", the way the Balance Sheet names an event.
function eventLabel(title: string, date: string): string {
  const name = title.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').trim()
  return `${Number(date.slice(5, 7)) < 8 ? 'Spring' : 'Fall'} ${date.slice(2, 4)} ${name}`
}

// Payments during an event become one Square row, after Square's fees, and one cash row for that event,
// recomputed from every payment so the totals stay right however often it runs. Other payments are batched by day the same way.
async function syncLedger(env: Env): Promise<void> {
  const pending = (await env.EVENTS_DB.prepare('SELECT id, paidAt, amount, fee, cash, note, eventId FROM square_payments WHERE synced = 0').all<Stored>()).results
  if (!pending.length) return
  const rows: LedgerRow[] = []
  for (const eventId of new Set(pending.map(payment => payment.eventId).filter(id => id !== null))) {
    const event = (await env.EVENTS_DB.prepare('SELECT title, date FROM events WHERE id = ?').bind(eventId).first<{ title: string; date: string }>())!
    const totals = (await env.EVENTS_DB.prepare('SELECT SUM(amount * (1 - cash)) AS card, SUM(amount * cash) AS cash, SUM(fee) AS fees FROM square_payments WHERE eventId = ?').bind(eventId).first<{ card: number; cash: number; fees: number }>())!
    const label = eventLabel(event.title, event.date)
    rows.push({ id: eventId, date: event.date, source: 'Square', description: `${label}: Square Profits`, amount: (totals.card - totals.fees) / 100 })
    rows.push({ id: eventId, date: event.date, source: 'Cash', description: `${label}: Cash Profits`, amount: totals.cash / 100 })
  }
  const dayOf = (payment: Stored) => dateKeyInTimeZone(Date.parse(payment.paidAt), env.TIME_ZONE)
  const days = new Set(pending.filter(payment => payment.eventId === null).map(dayOf))
  if (days.size) {
    const others = (await env.EVENTS_DB.prepare('SELECT id, paidAt, amount, fee, cash, note, eventId FROM square_payments WHERE eventId IS NULL').all<Stored>()).results
    for (const date of days) {
      const day = others.filter(payment => dayOf(payment) === date)
      const net = (cash: number) => day.filter(payment => payment.cash === cash).reduce((sum, payment) => sum + payment.amount - payment.fee, 0) / 100
      rows.push({ id: `payments-${date}`, date, source: 'Square', description: 'Square payments', amount: net(0) })
      rows.push({ id: `payments-${date}`, date, source: 'Cash', description: 'Cash payments', amount: net(1) })
    }
  }
  await upsertLedgerRows(env, rows)
  await env.EVENTS_DB.batch(pending.map(payment => env.EVENTS_DB.prepare('UPDATE square_payments SET synced = 1 WHERE id = ?').bind(payment.id)))
}

export async function squareFeed(env: Env): Promise<SquareFeed> {
  const [square, payments] = await Promise.all([
    env.EVENTS_DB.prepare('SELECT name FROM square_connection').first<string>('name'),
    env.EVENTS_DB.prepare('SELECT p.id, p.paidAt, p.amount, p.cash, p.note, e.title AS event FROM square_payments p LEFT JOIN events e ON e.id = p.eventId ORDER BY p.paidAt DESC LIMIT 50').all<Omit<SquarePayment, 'cash'> & { cash: number }>(),
  ])
  return { square, payments: payments.results.map(payment => ({ ...payment, cash: payment.cash === 1, note: payment.note.replace(/door:\S+\s*/, '') })) }
}

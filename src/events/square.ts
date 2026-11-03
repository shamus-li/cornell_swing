import { findCharge, settleCardCharge, UNSENT_CASH } from '../../check-in/worker/door'
import { findSession } from '../../check-in/worker/events'
import { sendAlert } from './alert-email'
import { dateKeyInTimeZone, timestampForSheet } from '../../check-in/worker/google'
import type { SquareFeed } from './finance'
import { upsertLedgerRows, type LedgerRow } from './ledger'
import { logError } from './logging'

// An officer connects the club's Square account from the Settings tab. The site then reads its payments
// each morning and files them on the Balance Sheet, and records door cash in Square.
const SQUARE = 'https://connect.squareup.com'
const VERSION = '2025-01-23'
// Payments are listed again for this long, so refunds and fees that settle later still reach the Balance Sheet.
const RELIST_MS = 3 * 86_400_000
const FILE_NOW_RELIST_MS = 365 * 86_400_000
const FILING_LOCK_MS = 2 * 60_000
// Someone is waiting at the door, and a payment that doesn't get through is sent again by the next sync.
const SEND_CASH_TIMEOUT_MS = 5_000

type Connection = { merchantId: string; accessToken: string; refreshToken: string; expiresAt: string; syncedAt: string }
type Money = { amount: number }
type Payment = { id: string; created_at: string; status: string; source_type: string; amount_money: Money; refunded_money?: Money; processing_fee?: { amount_money: Money }[]; note?: string; order_id?: string; reference_id?: string }
type Tokens = { access_token: string; refresh_token: string; expires_at: string; merchant_id: string }

class SquareAuthError extends Error {}

const redirectUri = (origin: string) => `${origin}/manage/square/callback`

export function squareConnectUrl(env: Env, origin: string, state: string): string {
  const url = new URL(`${SQUARE}/oauth2/authorize`)
  url.search = new URLSearchParams({ client_id: env.SQUARE_APPLICATION_ID, scope: 'PAYMENTS_READ PAYMENTS_WRITE MERCHANT_PROFILE_READ ORDERS_READ', redirect_uri: redirectUri(origin), state }).toString()
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
  // 403 means the connection lacks a permission the site now needs, so it has to be made again.
  if (response.status === 401 || response.status === 403) throw new SquareAuthError(await response.text())
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

// The saved cash row takes Square's ID, so the next sync recognizes the payment instead of adding it again.
async function linkCash(env: Env, chargeId: string, paymentId: string): Promise<void> {
  await env.EVENTS_DB.batch([
    env.EVENTS_DB.prepare('UPDATE square_payments SET id = ? WHERE id = ?').bind(paymentId, `${UNSENT_CASH}${chargeId}`),
    env.EVENTS_DB.prepare('UPDATE door_charges SET paymentId = ? WHERE id = ?').bind(paymentId, chargeId),
  ])
}

// Records door cash in Square. Check-in never waits on this succeeding, so failures are only logged and the next
// sync sends the payment again; the charge's ID as the key means Square keeps one payment however often it's sent.
// A 403 here must not disconnect Square the way a failed read does: a connection made before this permission
// existed can still read payments until an officer connects it again.
export async function sendUnsentCash(env: Env): Promise<void> {
  // Staging shares the club's real Square account.
  if (env.STAGING) return
  const token = await env.EVENTS_DB.prepare('SELECT accessToken FROM square_connection').first<string>('accessToken')
  if (!token) return
  const { results } = await env.EVENTS_DB.prepare('SELECT id, amount, note FROM square_payments WHERE id LIKE ?').bind(`${UNSENT_CASH}%`).all<{ id: string; amount: number; note: string }>()
  try {
    for (const row of results) {
      const chargeId = row.id.slice(UNSENT_CASH.length)
      const money = { amount: row.amount, currency: 'USD' }
      const response = await fetch(`${SQUARE}/v2/payments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Square-Version': VERSION },
        body: JSON.stringify({ idempotency_key: chargeId, source_id: 'CASH', amount_money: money, cash_details: { buyer_supplied_money: money }, reference_id: chargeId, note: row.note }),
        signal: AbortSignal.timeout(SEND_CASH_TIMEOUT_MS),
      })
      // Square refused this one payment, which shouldn't hold up the others.
      if (response.status === 400) {
        logError('Square refused door cash', new Error(await response.text()))
        continue
      }
      if (!response.ok) throw new Error(`Square returned ${response.status}`)
      const { payment } = await response.json() as { payment: Payment }
      await linkCash(env, chargeId, payment.id)
    }
  } catch (error) {
    logError('Door cash not sent to Square', error)
  }
}

type SeenPayment = { amount: number; fee: number }

// The door phone sends its charge's ID as a note on the sale. Square keeps that note on the sale's order, not
// on the payment, so this finds which charge a payment is for, whichever phone took it.
async function doorChargeId(token: string, payment: Payment): Promise<string | undefined> {
  if (!payment.order_id) return undefined
  const order = await api<unknown>(token, `/v2/orders/${payment.order_id}`)
  return JSON.stringify(order).match(/door:([0-9a-f-]{36})/)?.[1]
}

async function savePayment(env: Env, token: string, payment: Payment, seen?: SeenPayment): Promise<void> {
  const amount = payment.amount_money.amount - (payment.refunded_money?.amount ?? 0)
  const fee = (payment.processing_fee ?? []).reduce((sum, item) => sum + item.amount_money.amount, 0)
  // Listing a payment again only picks up refunds and fees.
  if (seen) {
    if (seen.amount !== amount || seen.fee !== fee) await env.EVENTS_DB.prepare('UPDATE square_payments SET amount = ?, fee = ?, synced = 0 WHERE id = ?').bind(amount, fee, payment.id).run()
    return
  }
  // Door cash whose reply from Square was lost. Its row is already saved, so the insert below changes nothing.
  if (payment.reference_id) await linkCash(env, payment.reference_id, payment.id)
  const paidAt = Date.parse(payment.created_at)
  const chargeId = await doorChargeId(token, payment)
  const charge = chargeId ? await findCharge(env, chargeId) : null
  const settles = charge?.status === 'pending' && payment.amount_money.amount === charge.amount
  // This runs first so a failed check-in leaves the payment unsaved, and the next sync tries it again.
  if (settles) await settleCardCharge(env, charge, payment.id, paidAt)
  const eventId = charge?.eventId ?? (await findSession(env, timestampForSheet(paidAt, env.TIME_ZONE)))?.id ?? null
  await env.EVENTS_DB.prepare('INSERT OR IGNORE INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(payment.id, payment.created_at, amount, fee, payment.source_type === 'CASH' ? 1 : 0, payment.note ?? '', eventId).run()
  // Another sync may have just settled this same payment.
  if (!charge || settles || charge.paymentId === payment.id) return
  // Money came in for this person, but it doesn't match what they owe or they had already paid.
  await sendAlert(env, 'A door payment needs checking', [
    `Square took $${(payment.amount_money.amount / 100).toFixed(2)} for ${charge.email}, whose ${charge.ticketName} ticket costs $${(charge.amount / 100).toFixed(2)} and was ${charge.status === 'pending' ? 'still waiting for payment' : `already marked ${charge.status}`}.`,
    'They may need a refund in Square, or to be checked in by hand.',
  ]).catch((error: unknown) => logError('Door payment alert failed', error))
}

// Reads new payments from Square, which settles any door charge they pay for.
export async function syncPayments(env: Env, relistMs = RELIST_MS): Promise<void> {
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
    await sendUnsentCash(env)
    const begin = new Date(Date.parse(connection.syncedAt) - relistMs).toISOString()
    const seen = new Map((await env.EVENTS_DB.prepare('SELECT id, amount, fee FROM square_payments WHERE paidAt >= ?').bind(begin).all<SeenPayment & { id: string }>()).results.map(row => [row.id, row]))
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ begin_time: begin, sort_order: 'ASC', limit: '100', ...cursor && { cursor } })
      const page = await api<{ payments?: Payment[]; cursor?: string }>(token, `/v2/payments?${query}`)
      for (const payment of page.payments ?? []) if (payment.status === 'COMPLETED') await savePayment(env, token, payment, seen.get(payment.id))
      cursor = page.cursor
    } while (cursor)
  } catch (error) {
    // Access was removed in Square, so the Settings tab asks to connect again.
    if (!(error instanceof SquareAuthError)) throw error
    await env.EVENTS_DB.prepare('DELETE FROM square_connection').run()
    logError('Square access was revoked', error)
    return
  }
  await env.EVENTS_DB.prepare('UPDATE square_connection SET syncedAt = ? WHERE id = 1').bind(startedAt).run()
}

// Reads Square and files what changed on the Balance Sheet, unless that's already running, because two writers at
// once could claim the same new row on the sheet. Returns whether it ran.
export async function syncSquare(env: Env, relistMs = RELIST_MS): Promise<boolean> {
  const now = Date.now()
  const lock = await env.EVENTS_DB.prepare('INSERT INTO filing_lock (id, until) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET until = ?1 WHERE until < ?2')
    .bind(new Date(now + FILING_LOCK_MS).toISOString(), new Date(now).toISOString()).run()
  if (!lock.meta.changes) return false
  try {
    await syncPayments(env, relistMs)
    await syncLedger(env)
    return true
  } finally {
    await env.EVENTS_DB.prepare('DELETE FROM filing_lock').run()
  }
}

// An officer filing by hand also catches a refund on an older payment.
export const fileNow = (env: Env) => syncSquare(env, FILE_NOW_RELIST_MS)

type Stored = { id: string; paidAt: string; amount: number; fee: number; cash: number; note: string; eventId: string | null }

// "Fall 26 The Lindy Haunt", the way the Balance Sheet names an event.
export function eventLabel(title: string, date: string): string {
  const name = title.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').trim()
  return `${Number(date.slice(5, 7)) < 8 ? 'Spring' : 'Fall'} ${date.slice(2, 4)} ${name}`
}

// Payments during an event become one Square row, after Square's fees, and one cash row for that event,
// recomputed from every payment so the totals stay right however often it runs. Other payments are batched by day the same way.
async function syncLedger(env: Env): Promise<void> {
  const pending = (await env.EVENTS_DB.prepare('SELECT id, paidAt, amount, fee, cash, note, eventId FROM square_payments WHERE synced = 0').all<Stored>()).results
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
  if (pending.length) await env.EVENTS_DB.batch(pending.map(payment => env.EVENTS_DB.prepare('UPDATE square_payments SET synced = 1 WHERE id = ?').bind(payment.id)))
}

export async function squareFeed(env: Env): Promise<SquareFeed> {
  return { square: await env.EVENTS_DB.prepare('SELECT name FROM square_connection').first<string>('name') }
}

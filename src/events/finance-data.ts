import { createCachedGoogleAccessTokenProvider, getGoogleAccessToken, readCheckins } from '../../check-in/worker/google'
import type { CampusGroupsRow, EventActivity, FinanceEvent, FinanceOverview, Transaction } from './finance'
import { appendLedgerRows, fiscalYear, linkLedgerRow } from './ledger'
import { todayInNewYork } from './model'
import { EventConflict } from './sheets'
import { withFilingLock } from './square'

// The Finances tab and event pages: the Balance Sheet, with its batched Square and cash rows replaced by each
// payment, checked row by row against the latest CampusGroups transactions export.
export const campusGroupsTransactionsKey = 'finance:campusgroups:v1'
type StoredExport = { uploadedAt: string; rows: CampusGroupsRow[] }
type Payment = { id: string; paidAt: string; amount: number; fee: number; cash: number; note: string; eventId: string | null; title: string | null }
type EventRow = { id: string; title: string; date: string }
type SheetRow = { index: number; date: string; amount: number; account: string; description: string; siteRow: boolean; eventId: string }

const DAY_MS = 86_400_000
// Reading whole sheets from Google takes seconds, so a page first gets the last read saved in KV, then asks again
// with fresh set so that an edit to a sheet shows up right away.
const accessToken = createCachedGoogleAccessTokenProvider(getGoogleAccessToken)
// How far apart CampusGroups and the sheet can date the same transaction.
const MATCH_DAYS = 14
const MAX_SPLIT_LINES = 4
const SHEET_EPOCH_MS = Date.UTC(1899, 11, 30)
const round = (amount: number) => Math.round(amount * 100) / 100
const cornellAccount = (source: string) => /^GPSA/i.test(source.trim()) ? 'GPSA' : /^Outside/i.test(source.trim()) ? 'Outside Funding' : null

function sheetDate(value: unknown): string {
  if (typeof value === 'number') return new Date(SHEET_EPOCH_MS + value * DAY_MS).toISOString().slice(0, 10)
  return usDate(String(value ?? ''))
}

// "9/21/2026 8:24:18 PM" as 2026-09-21.
function usDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : ''
}

// A row on an event's page drops the "Fall 2025 Back-2-Skool Swing: " the sheet starts it with.
const withoutEventName = (description: string) => description.replace(/^(Fall|Spring) (?:20)?\d\d [^:]+:\s*/, '') || description

// A row names its event by ID: the site's own rows in column H, and the treasurer's in column I.
export function parseSheetRows(values: unknown[][]): SheetRow[] {
  return values.flatMap((row, index) => {
    const source = String(row[3] ?? '').trim()
    if (typeof row[2] !== 'number' || !row[2]) return []
    const siteRow = !!row[7] && (source === 'Square' || source === 'Cash')
    return [{ index, date: sheetDate(row[1]), amount: row[2], account: source, description: String(row[5] ?? '').trim(), siteRow, eventId: String((siteRow ? row[7] : row[8]) ?? '').trim() }]
  })
}

// The fewest lines, two or more, that add up to the amount, or none.
function linesAddingUpTo(lines: SheetRow[], amount: number): SheetRow[] {
  for (let size = 2; size <= Math.min(lines.length, MAX_SPLIT_LINES); size++) {
    const pick = (from: number, left: number, chosen: SheetRow[]): SheetRow[] | null => {
      if (chosen.length === size) return Math.abs(left) < 0.005 ? chosen : null
      for (let at = from; at < lines.length; at++) {
        const found = pick(at + 1, left - lines[at].amount, [...chosen, lines[at]])
        if (found) return found
      }
      return null
    }
    const found = pick(0, amount, [])
    if (found) return found
  }
  return []
}

// Pairs the CampusGroups export with the sheet. One sheet row pairs with one export row: same account and amount,
// close in date. A payment can also be several lines on the sheet, like an instructor's fee and travel.
function pairExport(rows: SheetRow[], stored: StoredExport | null) {
  const earliest = rows.reduce((first, row) => row.date && row.date < first ? row.date : first, '9999')
  const exported = (stored?.rows ?? []).flatMap((row, index) => {
    const account = cornellAccount(row.source)
    const date = usDate(row.date)
    const amount = Number(row.amount)
    return account && date >= earliest && amount && !/rejected/i.test(row.paymentStatus) ? [{ index, account, date, amount, item: row.item.trim(), pending: /pending/i.test(row.paymentStatus) }] : []
  })
  const paired = new Set<number>()
  const unpaired = exported.filter(row => {
    const match = rows.find(sheet => !paired.has(sheet.index) && sheet.account === row.account && Math.abs(sheet.amount - row.amount) < 0.005 && Math.abs(Date.parse(sheet.date) - Date.parse(row.date)) <= MATCH_DAYS * DAY_MS)
    if (match) paired.add(match.index)
    return !match
  }).filter(row => {
    const nearby = rows.filter(sheet => !paired.has(sheet.index) && sheet.account === row.account && sheet.amount * row.amount > 0 && Math.abs(Date.parse(sheet.date) - Date.parse(row.date)) <= MATCH_DAYS * DAY_MS)
    const parts = linesAddingUpTo(nearby, row.amount)
    for (const part of parts) paired.add(part.index)
    return !parts.length
  })
  return { paired, unpaired }
}

export function buildTransactions(rows: SheetRow[], payments: Payment[], stored: StoredExport | null, events: EventRow[]): Transaction[] {
  const byId = new Map(events.map(event => [event.id, event]))
  const uploaded = stored?.uploadedAt.slice(0, 10) ?? ''
  const { paired, unpaired } = pairExport(rows, stored)
  const fromSheet = rows.filter(row => !row.siteRow).map((row): Transaction => {
    const event = byId.get(row.eventId)
    const cornell = !!stored && (row.account === 'GPSA' || row.account === 'Outside Funding')
    return {
      id: `sheet-${row.index}`, date: row.date, description: event ? withoutEventName(row.description) : row.description, account: row.account || 'No account', eventId: event?.id ?? null, eventName: event?.title ?? null, amount: row.amount, fee: 0,
      status: !cornell ? null : paired.has(row.index) ? 'in-campusgroups' : row.date > uploaded ? 'after-export' : 'not-in-campusgroups',
    }
  })
  const fromSquare = payments.filter(payment => payment.amount).map((payment): Transaction => ({
    id: payment.id, date: new Date(payment.paidAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), description: payment.note || (payment.cash ? 'Cash sale' : 'Card sale'), account: payment.cash ? 'Cash' : 'Square', eventId: payment.eventId, eventName: payment.title, amount: payment.amount / 100, fee: payment.fee / 100, status: null,
  }))
  const fromExport = unpaired.map((row): Transaction => ({ id: `campusgroups-${row.index}`, date: row.date, description: row.item, account: row.account, eventId: null, eventName: null, amount: row.amount, fee: 0, status: 'only-campusgroups' }))
  return [...fromSheet, ...fromSquare, ...fromExport].sort((a, b) => b.date.localeCompare(a.date))
}

export function buildEvents(rows: SheetRow[], events: EventRow[]): FinanceEvent[] {
  const byId = new Map(events.map(event => [event.id, event]))
  const grouped = new Map<string, FinanceEvent>()
  for (const row of rows) {
    const event = byId.get(row.eventId)
    if (!event) continue
    const entry = grouped.get(event.id) ?? { id: event.id, name: event.title, date: event.date, earned: 0, spent: 0, grant: 0 }
    if (row.amount > 0) entry.earned += row.amount
    else { entry.spent -= row.amount; if (row.account === 'GPSA') entry.grant -= row.amount }
    grouped.set(event.id, entry)
  }
  return [...grouped.values()].map(event => ({ ...event, earned: round(event.earned), spent: round(event.spent), grant: round(event.grant) })).sort((a, b) => b.date.localeCompare(a.date))
}

async function cached<T>(env: Env, fresh: boolean, key: string, read: () => Promise<T>): Promise<T> {
  if (!fresh) {
    const stored = await env.MEMBER_CACHE.get<T>(key, 'json')
    if (stored) return stored
  }
  const value = await read()
  const saved = JSON.stringify(value)
  if (saved !== await env.MEMBER_CACHE.get(key)) await env.MEMBER_CACHE.put(key, saved)
  return value
}

// The tabs Finances and event pages use, read together so they share one saved copy.
function readBalanceSheet(env: Env, fresh: boolean) {
  const [first, second] = fiscalYear(todayInNewYork()).split('-')
  const tabs = [TRANSACTIONS, `'20${first}-20${second} Synopsis'!A2:E8`, "'Quick Cash Calculation Tool'!C11"]
  return cached(env, fresh, `finance:sheet:v3:${first}`, () => fetchBalanceSheet(env, tabs))
}

async function fetchBalanceSheet(env: Env, tabs: string[]): Promise<unknown[][][]> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}/values:batchGet`)
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE')
  for (const tab of tabs) url.searchParams.append('ranges', tab)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(env)}` } })
  if (!response.ok) throw new Error(`Balance Sheet read failed with ${response.status}`)
  return ((await response.json()) as { valueRanges: { values?: unknown[][] }[] }).valueRanges.map(range => range.values ?? [])
}

const readPayments = async (env: Env, where = '', ...bind: string[]) => (await env.EVENTS_DB.prepare(`SELECT p.id, p.paidAt, p.amount, p.fee, p.cash, p.note, p.eventId, e.title FROM square_payments p LEFT JOIN events e ON e.id = p.eventId ${where}`).bind(...bind).all<Payment>()).results
const readEvents = async (env: Env) => (await env.EVENTS_DB.prepare("SELECT id, title, date FROM events WHERE kind = 'special'").all<EventRow>()).results
const TRANSACTIONS = "'Transaction History'!A2:I"

export async function financeOverview(env: Env, fresh = false): Promise<FinanceOverview> {
  const year = fiscalYear(todayInNewYork())
  const second = year.split('-')[1]
  const [[history, synopsis, count], payments, events, stored] = await Promise.all([readBalanceSheet(env, fresh), readPayments(env), readEvents(env), env.MEMBER_CACHE.get<StoredExport>(campusGroupsTransactionsKey, 'json')])
  const rows = parseSheetRows(history)
  const inYear = (date: string) => date && fiscalYear(date) === year
  const exportTotal = (account: string) => round((stored?.rows ?? []).filter(row => cornellAccount(row.source) === account && row.source.includes(`FY${second}`) && !/rejected/i.test(row.paymentStatus)).reduce((sum, row) => sum + (Number(row.amount) || 0), 0))
  const squareSales = round(payments.filter(payment => !payment.cash && inYear(payment.paidAt.slice(0, 10))).reduce((sum, payment) => sum + payment.amount - payment.fee, 0) / 100)
  const filedSquare = round(rows.filter(row => row.siteRow && row.account === 'Square' && inYear(row.date)).reduce((sum, row) => sum + row.amount, 0))
  const accounts = synopsis.flatMap(row => {
    const name = String(row[0] ?? '').trim()
    const [start, moneyIn, moneyOut, balance] = [row[1], row[2], row[3], row[4]].map(value => Number(value) || 0)
    if (!name || name === 'Totals' || (name === 'Venmo' && !balance)) return []
    const check = name === 'GPSA' || name === 'Outside Funding' ? (stored ? { source: 'CampusGroups', difference: round(exportTotal(name) - balance) } : null)
      : name === 'Cash' ? { source: 'Last count', difference: round(Number(count[0]?.[0] ?? 0) - balance) }
      : name === 'Square' ? { source: 'Square sales', difference: round(squareSales - filedSquare) } : null
    return [{ name: name === 'Square' ? 'Square Checking' : name === 'Cash' ? 'Cash box' : name, start, moneyIn, moneyOut: Math.abs(moneyOut), balance, check }]
  })
  return { accounts, events: buildEvents(rows, events), transactions: buildTransactions(rows, payments, stored, events), eventOptions: [...events].sort((a, b) => b.date.localeCompare(a.date)), campusGroupsUploadedAt: stored?.uploadedAt ?? null }
}

// Keeps what the page needs from each row of the export, which also names the officers who filed them, and adds
// what the Balance Sheet is missing. Those rows then pair with the export, so a later upload doesn't add them again.
export async function saveCampusGroupsTransactions(env: Env, body: unknown): Promise<void> {
  const rows = (body as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error('Upload the transactions export CSV from CampusGroups.')
  const clean = (rows as Record<string, unknown>[]).map(row => ({ source: String(row.source ?? ''), amount: String(row.amount ?? ''), paymentStatus: String(row.paymentStatus ?? ''), item: String(row.item ?? '').slice(0, 200), date: String(row.date ?? '') }))
  const stored: StoredExport = { uploadedAt: new Date().toISOString(), rows: clean }
  await env.MEMBER_CACHE.put(campusGroupsTransactionsKey, JSON.stringify(stored))
  const added = await withFilingLock(env, async () => {
    const [history] = await readBalanceSheet(env, true)
    await appendLedgerRows(env, pairExport(parseSheetRows(history), stored).unpaired.map(row => ({ date: row.date, amount: row.amount, source: row.account, complete: !row.pending, description: row.item })))
  })
  if (!added) throw new Error('The Balance Sheet is being updated. Upload the export again in a minute.')
}

// Links one of the treasurer's rows to an event, or removes the link. Sorting the tab moves rows, so the row must
// still be the one the officer was looking at.
export async function linkSheetRow(env: Env, body: unknown): Promise<void> {
  const { id, eventId, date, amount, description } = (body ?? {}) as Partial<Transaction>
  const index = Number(id?.match(/^sheet-(\d+)$/)?.[1] ?? NaN)
  const changed = new EventConflict('The Balance Sheet changed. Refresh and try again.')
  if (eventId && !await env.EVENTS_DB.prepare("SELECT 1 FROM events WHERE id = ? AND kind = 'special'").bind(eventId).first()) throw changed
  const linked = await withFilingLock(env, async () => {
    const [history] = await readBalanceSheet(env, true)
    const row = parseSheetRows(history).find(item => item.index === index)
    if (!row || row.siteRow || row.date !== date || row.amount !== amount || withoutEventName(row.description) !== withoutEventName(description ?? '')) throw changed
    // The tab's values start on sheet row 2.
    await linkLedgerRow(env, index + 2, eventId ?? '')
  })
  if (!linked) throw new EventConflict('The Balance Sheet is being updated. Try again in a minute.')
}

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })

export async function eventActivity(env: Env, eventId: string, fresh = false): Promise<EventActivity | null> {
  const event = await env.EVENTS_DB.prepare('SELECT id, title, date, attendance FROM events WHERE id = ?').bind(eventId).first<EventRow & { attendance: number | null }>()
  if (!event) return null
  const [sheet, payments, charges, stored, checkins] = await Promise.all([
    readBalanceSheet(env, fresh),
    readPayments(env, 'WHERE p.eventId = ?', eventId),
    // A ticket's money follows its payment, which a refund lowers. Door cash waits under an unsent ID until Square has it.
    env.EVENTS_DB.prepare("SELECT c.email, c.ticketName, c.amount, p.amount AS paid FROM door_charges c LEFT JOIN square_payments p ON p.id IN (c.paymentId, 'unsent:' || c.id) WHERE c.eventId = ? AND c.status IN ('card', 'cash', 'free', 'waived')").bind(eventId).all<{ email: string; ticketName: string; amount: number; paid: number | null }>(),
    env.MEMBER_CACHE.get<StoredExport>(campusGroupsTransactionsKey, 'json'),
    cached(env, fresh, 'finance:checkins:v2', async () => readCheckins(env, await accessToken(env))),
  ])
  const tickets = new Map<string, { name: string; count: number; amount: number }>()
  for (const charge of charges.results) {
    // Fully refunded, so no longer sold. Free and volunteer tickets never had a payment.
    if (charge.paid === 0) continue
    const ticket = tickets.get(charge.ticketName) ?? { name: charge.ticketName, count: 0, amount: 0 }
    tickets.set(charge.ticketName, { ...ticket, count: ticket.count + 1, amount: ticket.amount + (charge.paid ?? charge.amount) / 100 })
  }
  return {
    attendance: event.attendance,
    tickets: [...tickets.values()],
    transactions: buildTransactions(parseSheetRows(sheet[0]), payments, stored, [event]).filter(item => item.eventId === eventId),
    checkins: checkins.filter(row => row.eventId === eventId).map(row => ({
      name: row.name, email: row.email,
      time: typeof row.timestamp === 'number' ? clock.format(new Date(SHEET_EPOCH_MS + row.timestamp * DAY_MS)) : '',
      ticket: charges.results.find(charge => charge.email === row.email)?.ticketName ?? null,
    })),
  }
}

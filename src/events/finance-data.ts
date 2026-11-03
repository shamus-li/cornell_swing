import { getGoogleAccessToken, readCheckins } from '../../check-in/worker/google'
import type { CampusGroupsRow, EventActivity, FinanceEvent, FinanceOverview, Transaction } from './finance'
import { fiscalYear } from './ledger'
import { todayInNewYork } from './model'
import { eventLabel } from './square'

// The Finances tab and event pages: the Balance Sheet, with its batched Square and cash rows replaced by each
// payment, checked row by row against the latest CampusGroups transactions export.
export const campusGroupsTransactionsKey = 'finance:campusgroups:v1'
type StoredExport = { uploadedAt: string; rows: CampusGroupsRow[] }
type Payment = { id: string; paidAt: string; amount: number; fee: number; cash: number; note: string; eventId: string | null; title: string | null }
type EventRow = { id: string; title: string; date: string }
type SheetRow = { index: number; date: string; amount: number; account: string; description: string; siteRow: boolean; label: { key: string; name: string; rest: string } | null }

const DAY_MS = 86_400_000
// How far apart CampusGroups and the sheet can date the same transaction.
const MATCH_DAYS = 14
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

// Rows named like "Fall 2025 Back-2-Skool Swing: Room Rental" belong to an event.
function parseLabel(description: string): SheetRow['label'] {
  const match = description.match(/^(Fall|Spring) (?:20)?(\d\d) ([^:]+):\s*(.*)$/)
  return match ? { key: `${match[1]} ${match[2]} ${match[3].trim()}`, name: match[3].trim(), rest: match[4].trim() } : null
}

export function parseSheetRows(values: unknown[][]): SheetRow[] {
  return values.flatMap((row, index) => {
    const source = String(row[3] ?? '').trim()
    if (typeof row[2] !== 'number' || !row[2]) return []
    const description = String(row[5] ?? '').trim()
    return [{ index, date: sheetDate(row[1]), amount: row[2], account: source, description, siteRow: !!row[7] && (source === 'Square' || source === 'Cash'), label: parseLabel(description) }]
  })
}

// The sheet labels an event with its plain name; a year in the site's title only keeps titles unique.
const sheetLabel = (event: EventRow) => eventLabel(event.title.replace(/ 20\d\d$/, ''), event.date)

export function buildTransactions(rows: SheetRow[], payments: Payment[], stored: StoredExport | null, events: EventRow[]): Transaction[] {
  const byLabel = new Map(events.map(event => [sheetLabel(event), event]))
  const uploaded = stored?.uploadedAt.slice(0, 10) ?? ''
  const earliest = rows.reduce((first, row) => row.date && row.date < first ? row.date : first, '9999')
  const exported = (stored?.rows ?? []).flatMap((row, index) => {
    const account = cornellAccount(row.source)
    const date = usDate(row.date)
    const amount = Number(row.amount)
    return account && date >= earliest && amount && !/rejected/i.test(row.paymentStatus) ? [{ index, account, date, amount, item: row.item.trim() }] : []
  })
  // One sheet row pairs with one export row: same account and amount, close in date.
  const paired = new Set<number>()
  const unpaired = exported.filter(row => {
    const match = rows.find(sheet => !paired.has(sheet.index) && sheet.account === row.account && Math.abs(sheet.amount - row.amount) < 0.005 && Math.abs(Date.parse(sheet.date) - Date.parse(row.date)) <= MATCH_DAYS * DAY_MS)
    if (match) paired.add(match.index)
    return !match
  })
  const fromSheet = rows.filter(row => !row.siteRow).map((row): Transaction => {
    const event = row.label && byLabel.get(row.label.key)
    const cornell = !!stored && (row.account === 'GPSA' || row.account === 'Outside Funding')
    return {
      id: `sheet-${row.index}`, date: row.date, description: row.label?.rest || row.description, account: row.account || 'No account', eventId: event?.id ?? null, eventName: row.label?.name ?? null, amount: row.amount, fee: 0,
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
  const byLabel = new Map(events.map(event => [sheetLabel(event), event]))
  const grouped = new Map<string, FinanceEvent>()
  for (const row of rows) {
    if (!row.label) continue
    const event = byLabel.get(row.label.key)
    const entry = grouped.get(row.label.key) ?? { id: event?.id ?? null, name: row.label.name, date: event?.date ?? row.date, earned: 0, spent: 0, grant: 0 }
    if (row.amount > 0) entry.earned += row.amount
    else { entry.spent -= row.amount; if (row.account === 'GPSA') entry.grant -= row.amount }
    grouped.set(row.label.key, entry)
  }
  return [...grouped.values()].map(event => ({ ...event, earned: round(event.earned), spent: round(event.spent), grant: round(event.grant) })).sort((a, b) => b.date.localeCompare(a.date))
}

async function readBalanceSheet(env: Env, tabs: string[]): Promise<unknown[][][]> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}/values:batchGet`)
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE')
  for (const tab of tabs) url.searchParams.append('ranges', tab)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await getGoogleAccessToken(env)}` } })
  if (!response.ok) throw new Error(`Balance Sheet read failed with ${response.status}`)
  return ((await response.json()) as { valueRanges: { values?: unknown[][] }[] }).valueRanges.map(range => range.values ?? [])
}

const readPayments = async (env: Env, where = '', ...bind: string[]) => (await env.EVENTS_DB.prepare(`SELECT p.id, p.paidAt, p.amount, p.fee, p.cash, p.note, p.eventId, e.title FROM square_payments p LEFT JOIN events e ON e.id = p.eventId ${where}`).bind(...bind).all<Payment>()).results
const readEvents = async (env: Env) => (await env.EVENTS_DB.prepare("SELECT id, title, date FROM events WHERE kind = 'special'").all<EventRow>()).results
const TRANSACTIONS = "'Transaction History'!A2:H"

export async function financeOverview(env: Env): Promise<FinanceOverview> {
  const year = fiscalYear(todayInNewYork())
  const [first, second] = year.split('-')
  const [history, synopsis, count] = await readBalanceSheet(env, [TRANSACTIONS, `'20${first}-20${second} Synopsis'!A2:E8`, "'Quick Cash Calculation Tool'!C11"])
  const [payments, events, stored] = await Promise.all([readPayments(env), readEvents(env), env.MEMBER_CACHE.get<StoredExport>(campusGroupsTransactionsKey, 'json')])
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
  return { accounts, events: buildEvents(rows, events), transactions: buildTransactions(rows, payments, stored, events), campusGroupsUploadedAt: stored?.uploadedAt ?? null }
}

// Keeps what the page needs from each row of the export, which also names the officers who filed them.
export async function saveCampusGroupsTransactions(env: Env, body: unknown): Promise<void> {
  const rows = (body as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error('Upload the transactions export CSV from CampusGroups.')
  const clean = (rows as Record<string, unknown>[]).map(row => ({ source: String(row.source ?? ''), amount: String(row.amount ?? ''), paymentStatus: String(row.paymentStatus ?? ''), item: String(row.item ?? '').slice(0, 200), date: String(row.date ?? '') }))
  await env.MEMBER_CACHE.put(campusGroupsTransactionsKey, JSON.stringify({ uploadedAt: new Date().toISOString(), rows: clean } satisfies StoredExport))
}

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })

export async function eventActivity(env: Env, eventId: string): Promise<EventActivity | null> {
  const event = await env.EVENTS_DB.prepare('SELECT id, title, date, attendance FROM events WHERE id = ?').bind(eventId).first<EventRow & { attendance: number | null }>()
  if (!event) return null
  const [[history], payments, charges, stored, checkins] = await Promise.all([
    readBalanceSheet(env, [TRANSACTIONS]),
    readPayments(env, 'WHERE p.eventId = ?', eventId),
    env.EVENTS_DB.prepare("SELECT email, ticketName, amount FROM door_charges WHERE eventId = ? AND status IN ('card', 'cash', 'free', 'waived')").bind(eventId).all<{ email: string; ticketName: string; amount: number }>(),
    env.MEMBER_CACHE.get<StoredExport>(campusGroupsTransactionsKey, 'json'),
    getGoogleAccessToken(env).then(token => readCheckins(env, token)),
  ])
  const tickets = new Map<string, { name: string; count: number; amount: number }>()
  for (const charge of charges.results) {
    const ticket = tickets.get(charge.ticketName) ?? { name: charge.ticketName, count: 0, amount: 0 }
    tickets.set(charge.ticketName, { ...ticket, count: ticket.count + 1, amount: ticket.amount + charge.amount / 100 })
  }
  return {
    attendance: event.attendance,
    tickets: [...tickets.values()],
    transactions: buildTransactions(parseSheetRows(history), payments, stored, [event]).filter(item => item.eventId === eventId),
    checkins: checkins.filter(row => row.eventId === eventId).map(row => ({
      name: row.name, email: row.email,
      time: typeof row.timestamp === 'number' ? clock.format(new Date(SHEET_EPOCH_MS + row.timestamp * DAY_MS)) : '',
      ticket: charges.results.find(charge => charge.email === row.email)?.ticketName ?? null,
    })),
  }
}

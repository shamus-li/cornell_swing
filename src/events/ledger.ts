import { getGoogleAccessToken } from '../../check-in/worker/google'

// Rows the site owns on the Balance Sheet's Transaction History tab. Hidden column H holds the event's ID, or
// the Square payment's ID for a payment outside an event. An ID and source together name one row, so writing
// them again updates that row wherever it now sits, even after the treasurer sorts the tab.
export type LedgerRow = {
  id: string
  date: string
  source: 'Square' | 'Cash'
  description: string
  amount: number
}

const TAB = "'Transaction History'"
const DAY_MS = 86_400_000
// Sheet dates count days from 1899-12-30.
const SHEET_EPOCH_MS = Date.UTC(1899, 11, 30)

// The tab's Year column: "26-27" runs from August 2026 through July 2027.
function fiscalYear(date: string): string {
  const start = Number(date.slice(2, 4)) - (Number(date.slice(5, 7)) < 8 ? 1 : 0)
  return `${start}-${start + 1}`
}

export async function upsertLedgerRows(env: Env, rows: LedgerRow[]): Promise<void> {
  if (!rows.length) return
  const token = await getGoogleAccessToken(env)
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}/values`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const read = new URL(`${base}:batchGet`)
  read.searchParams.append('ranges', `${TAB}!B:B`)
  read.searchParams.append('ranges', `${TAB}!D:D`)
  read.searchParams.append('ranges', `${TAB}!H:H`)
  const response = await fetch(read, { headers })
  if (!response.ok) throw new Error(`Ledger read failed with ${response.status}`)
  const { valueRanges } = await response.json() as { valueRanges: { values?: unknown[][] }[] }
  const [dates, sources, ids] = valueRanges.map(range => range.values ?? [])
  const key = (id: unknown, source: unknown) => `${String(id ?? '')}|${String(source ?? '')}`
  const rowOf = new Map(ids.map((row, index) => [key(row[0], sources[index]?.[0]), index + 1]))
  let next = Math.max(dates.length, ids.length) + 1
  // A total that reaches zero, like a full refund, still updates its row, but never adds a new one.
  // Column G stays with the treasurer for notes.
  const data = rows.filter(row => row.amount || rowOf.has(key(row.id, row.source))).flatMap(row => {
    const at = rowOf.get(key(row.id, row.source)) ?? next++
    const serial = (Date.parse(`${row.date}T00:00:00Z`) - SHEET_EPOCH_MS) / DAY_MS
    return [
      { range: `${TAB}!A${at}:F${at}`, values: [[fiscalYear(row.date), serial, row.amount, row.source, 'Y', row.description]] },
      { range: `${TAB}!H${at}`, values: [[row.id]] },
    ]
  })
  if (!data.length) return
  // RAW keeps "26-27" as text and stops a payment note from running as a formula.
  const write = await fetch(`${base}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ valueInputOption: 'RAW', data }) })
  if (!write.ok) throw new Error(`Ledger write failed with ${write.status}`)
}

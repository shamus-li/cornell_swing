import { getGoogleAccessToken } from '../../check-in/worker/google'

// Rows the site owns on the Balance Sheet's Transaction History tab. Hidden column H holds the event's ID, or
// payments-<date> for a day's payments outside an event. An ID and source together name one row, so writing
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
export function fiscalYear(date: string): string {
  const start = Number(date.slice(2, 4)) - (Number(date.slice(5, 7)) < 8 ? 1 : 0)
  return `${start}-${start + 1}`
}

// The sheet leaves a blank amount for a row someone set up ahead of an event.
const isBlank = (cell: unknown) => cell === undefined || cell === null || cell === ''

// Writes each row, then removes the site's rows that have reached zero, like a full refund. Only rows with an ID
// and a Square or Cash source are the site's; a total that reaches zero never adds a row.
export async function upsertLedgerRows(env: Env, rows: LedgerRow[]): Promise<void> {
  const token = await getGoogleAccessToken(env)
  const sheet = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}`
  const base = `${sheet}/values`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const read = new URL(`${base}:batchGet`)
  read.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE')
  for (const column of ['B', 'C', 'D', 'H']) read.searchParams.append('ranges', `${TAB}!${column}:${column}`)
  const response = await fetch(read, { headers })
  if (!response.ok) throw new Error(`Ledger read failed with ${response.status}`)
  const { valueRanges } = await response.json() as { valueRanges: { values?: unknown[][] }[] }
  const [dates, amounts, sources, ids] = valueRanges.map(range => range.values ?? [])
  const key = (id: unknown, source: unknown) => `${String(id ?? '')}|${String(source ?? '')}`
  const rowOf = new Map(ids.map((row, index) => [key(row[0], sources[index]?.[0]), index + 1]))
  const totals = new Map(rows.map(row => [key(row.id, row.source), row.amount]))
  let next = Math.max(dates.length, ids.length) + 1
  // Column G stays with the treasurer for notes.
  const data = rows.filter(row => row.amount).flatMap(row => {
    const at = rowOf.get(key(row.id, row.source)) ?? next++
    const serial = (Date.parse(`${row.date}T00:00:00Z`) - SHEET_EPOCH_MS) / DAY_MS
    return [
      { range: `${TAB}!A${at}:F${at}`, values: [[fiscalYear(row.date), serial, row.amount, row.source, 'Y', row.description]] },
      { range: `${TAB}!H${at}`, values: [[row.id]] },
    ]
  })
  if (data.length) {
    // RAW keeps "26-27" as text and stops a payment note from running as a formula.
    const write = await fetch(`${base}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ valueInputOption: 'RAW', data }) })
    if (!write.ok) throw new Error(`Ledger write failed with ${write.status}`)
  }
  const zeroed = ids.flatMap((row, index) => {
    const source = sources[index]?.[0]
    if (!row[0] || (source !== 'Square' && source !== 'Cash') || isBlank(amounts[index]?.[0])) return []
    return (totals.get(key(row[0], source)) ?? Number(amounts[index][0])) === 0 ? [index] : []
  })
  if (!zeroed.length) return
  const tabs = await fetch(`${sheet}?fields=sheets.properties(sheetId,title)`, { headers })
  if (!tabs.ok) throw new Error(`Ledger read failed with ${tabs.status}`)
  const { sheets } = await tabs.json() as { sheets: { properties: { sheetId: number; title: string } }[] }
  const sheetId = sheets.find(({ properties }) => `'${properties.title}'` === TAB)!.properties.sheetId
  // From the bottom up, so removing a row doesn't move the ones still to remove.
  const requests = zeroed.reverse().map(index => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 } } }))
  const remove = await fetch(`${sheet}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ requests }) })
  if (!remove.ok) throw new Error(`Ledger row removal failed with ${remove.status}`)
}

// Hidden column I links one of the treasurer's rows to an event, and an empty ID removes the link.
export async function linkLedgerRow(env: Env, row: number, eventId: string): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}/values:batchUpdate`
  const write = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await getGoogleAccessToken(env)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data: [{ range: `${TAB}!I${row}`, values: [[eventId]] }] }) })
  if (!write.ok) throw new Error(`Ledger write failed with ${write.status}`)
}

// Rows from elsewhere that belong to the treasurer once added, so they get no ID. An unfinished one is marked Incomplete.
export async function appendLedgerRows(env: Env, rows: { date: string; amount: number; source: string; complete: boolean; description: string }[]): Promise<void> {
  if (!rows.length) return
  const headers = { Authorization: `Bearer ${await getGoogleAccessToken(env)}`, 'Content-Type': 'application/json' }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}/values`
  const read = new URL(`${base}:batchGet`)
  for (const column of ['B', 'H']) read.searchParams.append('ranges', `${TAB}!${column}:${column}`)
  const response = await fetch(read, { headers })
  if (!response.ok) throw new Error(`Ledger read failed with ${response.status}`)
  const { valueRanges } = await response.json() as { valueRanges: { values?: unknown[][] }[] }
  const first = Math.max(...valueRanges.map(range => range.values?.length ?? 0)) + 1
  const data = rows.map((row, index) => ({ range: `${TAB}!A${first + index}:F${first + index}`, values: [[fiscalYear(row.date), (Date.parse(`${row.date}T00:00:00Z`) - SHEET_EPOCH_MS) / DAY_MS, row.amount, row.source, row.complete ? 'Y' : 'Incomplete', row.description]] }))
  const write = await fetch(`${base}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ valueInputOption: 'RAW', data }) })
  if (!write.ok) throw new Error(`Ledger write failed with ${write.status}`)
}

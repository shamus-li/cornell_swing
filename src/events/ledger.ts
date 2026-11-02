import { getGoogleAccessToken } from '../../check-in/worker/google'

// Rows the site owns on the finance sheet's Ledger tab. Column N holds each row's ID, so writing the
// same ID again updates that row wherever it now sits, even after the treasurer sorts the tab.
export type LedgerRow = {
  id: string
  date: string
  eventDate: string
  type: 'Income' | 'Expense'
  category: string
  description: string
  amount: number
  account: string
  status: string
}

const TAB = "'Ledger'"

export async function upsertLedgerRows(env: Env, rows: LedgerRow[]): Promise<void> {
  if (!rows.length) return
  const token = await getGoogleAccessToken(env)
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.FINANCE_SPREADSHEET_ID)}/values`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const read = new URL(`${base}:batchGet`)
  read.searchParams.append('ranges', `${TAB}!A:A`)
  read.searchParams.append('ranges', `${TAB}!N:N`)
  const response = await fetch(read, { headers })
  if (!response.ok) throw new Error(`Ledger read failed with ${response.status}`)
  const { valueRanges } = await response.json() as { valueRanges: { values?: unknown[][] }[] }
  const [dates, ids] = valueRanges.map(range => range.values ?? [])
  const rowOf = new Map(ids.map((row, index) => [String(row[0] ?? ''), index + 1]))
  let next = Math.max(dates.length, ids.length) + 1
  // Columns C and D are array formulas for the event name and fiscal year, so they are left alone.
  const data = rows.flatMap(row => {
    const at = rowOf.get(row.id) ?? next++
    return [
      { range: `${TAB}!A${at}:B${at}`, values: [[row.date, row.eventDate]] },
      { range: `${TAB}!E${at}:J${at}`, values: [[row.type, row.category, row.description, row.amount, row.account, row.status]] },
      { range: `${TAB}!N${at}`, values: [[row.id]] },
    ]
  })
  const write = await fetch(`${base}:batchUpdate`, { method: 'POST', headers, body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) })
  if (!write.ok) throw new Error(`Ledger write failed with ${write.status}`)
}

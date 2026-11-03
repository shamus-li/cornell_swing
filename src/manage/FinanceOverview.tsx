import { useEffect, useState, type ChangeEvent } from "react"
import { Check, TriangleAlert } from "lucide-react"
import Papa from "papaparse"
import { Button } from "../../check-in/src/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../check-in/src/components/ui/select"
import { Card } from "../components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table"
import { clubYear, type FinanceEvent, type FinanceOverview as Overview } from "../events/finance"
import { api, errorMessage, loadSheetData } from "./api"
import { money } from "./money"
import { Transactions } from "./Transactions"

const BALANCE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1VvZ_LG8_fNkqCuVqp_-3MBQPVFsAHl5mVo450IX1y00/edit"
const columns = ["Source", "Amount", "Payment Status", "Item Name", "Date"]
const wideNumber = "hidden text-right tabular-nums sm:table-cell"
const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const uploaded = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
const dateOf = (date: string) => new Date(`${date}T00:00:00Z`)
const sum = (events: FinanceEvent[], amount: (event: FinanceEvent) => number) => events.reduce((total, event) => total + amount(event), 0)
// What the event did to the club's own money, since GPSA money can't be kept.
const netAfterGrant = (event: FinanceEvent) => event.earned - event.spent + event.grant

function EventFigures({ events }: { events: FinanceEvent[] }) {
  return <>
    <TableCell className="text-right tabular-nums">{money(sum(events, event => event.earned))}</TableCell>
    <TableCell className={wideNumber}>{money(sum(events, event => event.spent))}</TableCell>
    <TableCell className={wideNumber}>{money(sum(events, event => event.grant))}</TableCell>
    <TableCell className="text-right font-medium tabular-nums">{money(sum(events, netAfterGrant))}</TableCell>
  </>
}

// All of the club's money, from the Balance Sheet, with each account checked against another record and every transaction listed.
export function FinanceOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [eventYear, setEventYear] = useState("all")

  useEffect(() => {
    const controller = new AbortController()
    void loadSheetData<Overview>("/finance", "The Balance Sheet could not be read.", setData, controller.signal).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [])

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setBusy(true); setError("")
    try {
      const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>((complete, error) => Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete, error }))
      if (!columns.every(column => parsed.meta.fields?.includes(column))) throw new Error("Upload the transactions export CSV from CampusGroups.")
      const rows = parsed.data.map(row => ({ source: row.Source ?? "", amount: row.Amount ?? "", paymentStatus: row["Payment Status"] ?? "", item: row["Item Name"] ?? "", date: row.Date ?? "" }))
      setData(await api<Overview>("/finance/campusgroups", { method: "PUT", body: JSON.stringify({ rows }) }, "The transactions could not be uploaded. Try again."))
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false); input.value = "" }
  }

  if (!data && !error) return <p role="status" className="event-muted manage-notice">Loading the Balance Sheet…</p>
  if (!data) return <p role="alert" className="event-error manage-notice">{error}</p>

  const total = data.accounts.reduce((sumSoFar, account) => sumSoFar + account.balance, 0)
  const years = [...new Set(data.events.map(event => clubYear(event.date)))]

  return <div className="finance">
    <section aria-labelledby="finance-total-label">
      <div className="finance-heading"><h2 id="finance-total-label">Club money</h2><Button asChild><a href="/check-in/door/" target="_blank" rel="noreferrer">Open door payment page</a></Button></div>
      <p className="finance-total">{money(total)}</p>
    </section>

    <section aria-labelledby="finance-accounts-title">
      <div className="finance-heading">
        <h2 id="finance-accounts-title">Accounts this year</h2>
        <div className="finance-actions">
          <span className="event-muted">{busy ? "Uploading…" : data.campusGroupsUploadedAt ? `CampusGroups export from ${uploaded.format(new Date(data.campusGroupsUploadedAt))}` : "No CampusGroups export yet"}</span>
          <Button asChild variant="outline" size="sm"><a href={BALANCE_SHEET_URL} target="_blank" rel="noreferrer">Open Balance Sheet</a></Button>
          <Button asChild variant="outline" size="sm"><label>Upload export<input className="sr-only" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void upload(e)} /></label></Button>
        </div>
      </div>
      {error && <p role="alert" className="event-error">{error}</p>}
      <Card><Table aria-labelledby="finance-accounts-title">
        <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className={wideNumber}>Start</TableHead><TableHead className={wideNumber}>In</TableHead><TableHead className={wideNumber}>Out</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="hidden sm:table-cell">Checked against</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
        <TableBody>{data.accounts.map(account => <TableRow key={account.name}>
          <TableCell className="font-medium">{account.name}</TableCell>
          <TableCell className={wideNumber}>{money(account.start)}</TableCell>
          <TableCell className={wideNumber}>{money(account.moneyIn)}</TableCell>
          <TableCell className={wideNumber}>{money(account.moneyOut)}</TableCell>
          <TableCell className="text-right font-medium tabular-nums">{money(account.balance)}</TableCell>
          <TableCell className="hidden sm:table-cell">{account.check?.source}</TableCell>
          <TableCell>{account.check && <span className={`finance-check${account.check.difference ? " is-off" : ""}`}>{account.check.difference ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}{account.check.difference ? `${money(Math.abs(account.check.difference))} off` : "Matches"}</span>}</TableCell>
        </TableRow>)}</TableBody>
      </Table></Card>
    </section>

    <Transactions transactions={data.transactions} />

    <section aria-labelledby="finance-events-title">
      <div className="finance-heading">
        <h2 id="finance-events-title">Events</h2>
        <Select value={eventYear} onValueChange={setEventYear}>
          <SelectTrigger aria-label="Club year"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All years</SelectItem>{years.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {data.events.length ? <Card><Table aria-labelledby="finance-events-title">
        <TableHeader><TableRow><TableHead>Event</TableHead><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead className="text-right">Earned</TableHead><TableHead className={wideNumber}>Spent</TableHead><TableHead className={wideNumber}>GPSA paid</TableHead><TableHead className="text-right">Net after GPSA</TableHead></TableRow></TableHeader>
        {years.filter(year => eventYear === "all" || year === eventYear).map(year => {
          const inYear = data.events.filter(event => clubYear(event.date) === year)
          return <TableBody key={year}>
            <TableRow className="bg-muted/50 font-medium"><TableCell>{year}</TableCell><TableCell className="hidden sm:table-cell" /><EventFigures events={inYear} /></TableRow>
            {inYear.map(event => <TableRow key={`${event.name}-${event.date}`}>
              <TableCell>{event.id ? <a href={`/manage/?event=${event.id}`}>{event.name}</a> : event.name}</TableCell>
              <TableCell className="hidden whitespace-nowrap sm:table-cell">{longDate.format(dateOf(event.date))}</TableCell>
              <EventFigures events={[event]} />
            </TableRow>)}
          </TableBody>
        })}
      </Table></Card> : <p className="event-muted">No events on the Balance Sheet yet.</p>}
    </section>
  </div>
}

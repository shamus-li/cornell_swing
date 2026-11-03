import { useEffect, useState, type ChangeEvent } from "react"
import { Check, TriangleAlert } from "lucide-react"
import Papa from "papaparse"
import { Button } from "../../check-in/src/components/ui/button"
import type { FinanceEvent, FinanceOverview as Overview } from "../events/finance"
import { api, errorMessage } from "./api"

const BALANCE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1VvZ_LG8_fNkqCuVqp_-3MBQPVFsAHl5mVo450IX1y00/edit"
const columns = ["Source", "Amount", "Payment Status"]
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const money = (amount: number) => currency.format(amount).replace("-", "−")
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const uploaded = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
const dateOf = (date: string) => new Date(`${date}T00:00:00Z`)
const sum = (events: FinanceEvent[], amount: (event: FinanceEvent) => number) => events.reduce((total, event) => total + amount(event), 0)
// What the event did to the club's own money, since GPSA money can't be kept.
const netAfterGrant = (event: FinanceEvent) => event.earned - event.spent + event.grant

// "2026–27": the club's year runs August through July.
function clubYear(date: string): string {
  const start = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 8 ? 1 : 0)
  return `${start}–${String(start + 1).slice(2)}`
}

function EventFigures({ events }: { events: FinanceEvent[] }) {
  return <>
    <td className="number">{money(sum(events, event => event.earned))}</td>
    <td className="number finance-wide">{money(sum(events, event => event.spent))}</td>
    <td className="number finance-wide">{money(sum(events, event => event.grant))}</td>
    <td className="number strong">{money(sum(events, netAfterGrant))}</td>
  </>
}

// All of the club's money, from the Balance Sheet, leading with what disagrees with another record.
export function FinanceOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void api<Overview>("/finance", { signal: controller.signal }, "The Balance Sheet could not be read.").then(setData).catch((err: unknown) => {
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
      const rows = parsed.data.map(row => ({ source: row.Source ?? "", amount: row.Amount ?? "", paymentStatus: row["Payment Status"] ?? "" }))
      setData(await api<Overview>("/finance/campusgroups", { method: "PUT", body: JSON.stringify({ rows }) }, "The transactions could not be uploaded. Try again."))
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false); input.value = "" }
  }

  if (!data && !error) return <p role="status" className="event-muted manage-notice">Loading the Balance Sheet…</p>
  if (!data) return <p role="alert" className="event-error manage-notice">{error}</p>

  const total = data.accounts.reduce((sumSoFar, account) => sumSoFar + account.balance, 0)
  const grant = data.accounts.find(account => account.name === "GPSA")?.balance ?? 0
  const alerts = data.accounts.filter(account => account.check?.difference).map(account => {
    const difference = account.check!.difference
    return `${account.check!.source} shows ${money(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than the Balance Sheet for ${account.name}.`
  })
  if (data.unassigned.count) alerts.push(`${data.unassigned.count} ${data.unassigned.count === 1 ? "expense has" : "expenses have"} no account on the Balance Sheet, so ${money(data.unassigned.amount)} isn't in any balance.`)
  const widest = Math.max(1, ...data.events.map(event => Math.abs(netAfterGrant(event))))
  const years = [...new Set(data.events.map(event => clubYear(event.date)))]

  return <div className="finance">
    <section aria-labelledby="finance-total-label">
      <h2 id="finance-total-label">Club money</h2>
      <p className="finance-total">{money(total)}</p>
      <p className="finance-takeaway">{money(grant)} is GPSA money that has to be spent by {longDate.format(dateOf(data.grantExpires))}. The other {money(total - grant)} carries over.</p>
    </section>

    {alerts.length > 0 && <section aria-labelledby="finance-alerts-title">
      <div className="finance-heading"><h2 id="finance-alerts-title">Needs a look</h2><a href={BALANCE_SHEET_URL} target="_blank" rel="noreferrer">Open the Balance Sheet</a></div>
      <ul className="finance-alerts finance-card">{alerts.map(alert => <li key={alert}><TriangleAlert aria-hidden="true" /><span>{alert}</span></li>)}</ul>
    </section>}

    <section aria-labelledby="finance-accounts-title">
      <div className="finance-heading">
        <h2 id="finance-accounts-title">Accounts this year</h2>
        <div className="finance-upload">
          <span>{busy ? "Uploading…" : data.campusGroupsUploadedAt ? `CampusGroups export from ${uploaded.format(new Date(data.campusGroupsUploadedAt))}` : "No CampusGroups export yet"}</span>
          <Button asChild variant="outline" size="sm"><label>Upload export<input className="sr-only" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void upload(e)} /></label></Button>
        </div>
      </div>
      {error && <p role="alert" className="event-error">{error}</p>}
      <div className="finance-card"><table className="finance-table" aria-labelledby="finance-accounts-title">
        <thead><tr><th scope="col">Account</th><th scope="col" className="number finance-wide">Start</th><th scope="col" className="number finance-wide">In</th><th scope="col" className="number finance-wide">Out</th><th scope="col" className="number">Balance</th><th scope="col">Checked against</th></tr></thead>
        <tbody>{data.accounts.map(account => <tr key={account.name}>
          <th scope="row"><strong>{account.name}</strong><small>{account.note}</small></th>
          <td className="number finance-wide">{money(account.start)}</td>
          <td className="number finance-wide">{money(account.moneyIn)}</td>
          <td className="number finance-wide">{money(account.moneyOut)}</td>
          <td className="number strong">{money(account.balance)}</td>
          <td>{account.check
            ? <span className={`finance-check${account.check.difference ? " is-off" : ""}`}>{account.check.difference ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}{account.check.difference ? `${money(Math.abs(account.check.difference))} off` : "Matches"}</span>
            : "Nothing to check"}<small>{account.check?.source}</small></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section aria-labelledby="finance-events-title">
      <div className="finance-heading"><h2 id="finance-events-title">Events</h2></div>
      {data.events.length ? <div className="finance-card"><table className="finance-table" aria-labelledby="finance-events-title">
        <thead><tr><th scope="col">Event</th><th scope="col" className="number">Earned</th><th scope="col" className="number finance-wide">Spent</th><th scope="col" className="number finance-wide">GPSA paid</th><th scope="col" className="number">Net after GPSA</th><th scope="col" className="finance-wide"><span className="sr-only">Net after GPSA as a bar</span></th></tr></thead>
        {years.map(year => {
          const inYear = data.events.filter(event => clubYear(event.date) === year)
          return <tbody key={year}>
            <tr className="finance-year"><th scope="rowgroup">{year}</th><EventFigures events={inYear} /><td className="finance-wide" /></tr>
            {inYear.map(event => {
              const net = netAfterGrant(event)
              return <tr key={`${event.name}-${event.date}`}>
                <th scope="row"><strong>{event.name}</strong><small>{shortDate.format(dateOf(event.date))}{event.people !== null && `, ${event.people} ${event.people === 1 ? "person" : "people"}`}</small></th>
                <EventFigures events={[event]} />
                <td className="finance-wide"><span className="finance-bar" aria-hidden="true"><span className={net < 0 ? "is-down" : "is-up"} style={{ width: `${Math.abs(net) / widest * 50}%` }} /></span></td>
              </tr>
            })}
          </tbody>
        })}
      </table></div> : <p className="event-muted">No events on the Balance Sheet yet.</p>}
    </section>
  </div>
}

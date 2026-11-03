import { useEffect, useState } from "react"
import { Card, CardContent } from "../components/ui/card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table"
import type { EventRecord, RSVP } from "../events/model"
import type { EventActivity } from "../events/finance"
import { api, errorMessage } from "./api"
import { ConfirmButton } from "./ConfirmButton"
import { CopyButton } from "./CopyButton"
import { money } from "./money"
import { onSheet, TransactionsTable } from "./Transactions"

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })

// An event's headcounts and all of its money.
export function EventOverview({ event, rsvpCount }: { event: EventRecord; rsvpCount: number }) {
  const [data, setData] = useState<EventActivity | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { void api<EventActivity>(`/events/${event.id}/activity`, {}, "This event's money and check-ins could not be loaded.").then(setData).catch(err => setError(errorMessage(err))) }, [event.id])
  if (error) return <p role="alert" className="event-error manage-notice">{error}</p>
  if (!data) return <p role="status" className="event-muted manage-notice">Loading…</p>

  const counted = data.transactions.filter(onSheet)
  const earned = counted.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount - item.fee, 0)
  const expenses = counted.filter(item => item.amount < 0)
  const spent = -expenses.reduce((sum, item) => sum + item.amount, 0)
  const grant = -expenses.filter(item => item.account === "GPSA").reduce((sum, item) => sum + item.amount, 0)
  const came = data.checkins.length || data.attendance
  const stats = [["RSVPs", String(rsvpCount)], [data.checkins.length ? "Checked in" : "Attended", came === null ? "Not recorded" : String(came)], ["Earned", money(earned)], ["Spent", money(spent)], ["Net after GPSA", money(earned - spent + grant)]]

  return <div className="finance">
    <div className="event-stats">{stats.map(([label, value]) => <Card key={label}><CardContent><div className="event-muted">{label}</div><div className="event-stat">{value}</div></CardContent></Card>)}</div>
    <section aria-labelledby="event-tickets-title">
      <div className="finance-heading"><h2 id="event-tickets-title">Tickets</h2></div>
      {data.tickets.length ? <Card><Table aria-labelledby="event-tickets-title">
        <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>{data.tickets.map(ticket => <TableRow key={ticket.name}><TableCell>{ticket.name}</TableCell><TableCell className="text-right tabular-nums">{ticket.count}</TableCell><TableCell className="text-right tabular-nums">{money(ticket.amount)}</TableCell></TableRow>)}</TableBody>
        <TableFooter><TableRow><TableCell>Total</TableCell><TableCell className="text-right tabular-nums">{data.tickets.reduce((sum, ticket) => sum + ticket.count, 0)}</TableCell><TableCell className="text-right tabular-nums">{money(data.tickets.reduce((sum, ticket) => sum + ticket.amount, 0))}</TableCell></TableRow></TableFooter>
      </Table></Card> : <p className="event-muted">No tickets sold yet.</p>}
    </section>
    <section aria-labelledby="event-transactions-title">
      <div className="finance-heading"><h2 id="event-transactions-title">Transactions</h2></div>
      {data.transactions.length ? <TransactionsTable transactions={data.transactions} showEvent={false} /> : <p className="event-muted">No transactions on the Balance Sheet yet.</p>}
    </section>
  </div>
}

// Everyone who RSVPed or checked in, on one row each.
export function EventGuests({ event, onChange }: { event: EventRecord; onChange: () => void }) {
  const [rsvps, setRsvps] = useState<RSVP[] | null>(null)
  const [checkins, setCheckins] = useState<EventActivity["checkins"]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    void api<{ rsvps: RSVP[] }>(`/events/${event.id}/rsvps`).then(data => setRsvps(data.rsvps)).catch(err => setError(errorMessage(err)))
    void api<EventActivity>(`/events/${event.id}/activity`, {}, "Check-ins could not be loaded.").then(data => setCheckins(data.checkins)).catch(err => setError(errorMessage(err)))
  }, [event.id])
  async function remove(email: string) {
    setError("")
    try {
      await api(`/events/${event.id}/rsvps`, { method: "DELETE", body: JSON.stringify({ email }) })
      setRsvps(current => current!.filter(guest => guest.email !== email)); onChange()
    } catch (err) { setError(errorMessage(err)) }
  }
  const emails = [...new Set([...(rsvps ?? []).map(rsvp => rsvp.email), ...checkins.map(checkin => checkin.email)])]
  const guests = emails.map(email => ({ email, rsvp: rsvps?.find(item => item.email === email), checkin: checkins.find(item => item.email === email) }))
  return <>
    {error && <p role="alert" className="event-error manage-notice">{error}</p>}
    {rsvps === null ? !error && <p role="status" className="event-muted manage-notice">Loading guests…</p> : guests.length ? <>
      <div className="guest-summary"><span className="event-muted">{guests.length} guest{guests.length === 1 ? "" : "s"}</span><CopyButton text={guests.map(guest => `${guest.rsvp?.name ?? guest.checkin!.name}\t${guest.email}`).join("\n")} label="Copy names and emails" /></div>
      <Card><Table className="guest-list">
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Email</TableHead><TableHead>RSVP</TableHead><TableHead>Checked in</TableHead><TableHead className="hidden sm:table-cell">Ticket</TableHead><TableHead><span className="sr-only">Remove</span></TableHead></TableRow></TableHeader>
        <TableBody>{guests.map(({ email, rsvp, checkin }) => <TableRow key={email}>
          <TableCell className="font-medium">{rsvp?.name ?? checkin!.name}</TableCell>
          <TableCell className="hidden sm:table-cell">{email}</TableCell>
          <TableCell className="whitespace-nowrap">{rsvp ? day.format(new Date(rsvp.createdAt)) : "No"}</TableCell>
          <TableCell className="whitespace-nowrap">{checkin ? checkin.time : "No"}</TableCell>
          <TableCell className="hidden sm:table-cell">{checkin?.ticket ?? ""}</TableCell>
          <TableCell className="text-right">{rsvp && <ConfirmButton size="sm" aria-label={`Remove ${rsvp.name}`} confirmLabel="Confirm" busyLabel="Removing…" onConfirm={() => remove(email)}>Remove</ConfirmButton>}</TableCell>
        </TableRow>)}</TableBody>
      </Table></Card>
    </> : <p className="event-muted manage-notice">No RSVPs or check-ins yet.</p>}
  </>
}

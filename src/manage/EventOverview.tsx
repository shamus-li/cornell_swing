import { useEffect, useState } from "react"
import { Card, CardContent } from "../components/ui/card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table"
import type { RSVP } from "../events/model"
import type { EventActivity } from "../events/finance"
import { api, errorMessage, loadSheetData } from "./api"
import { ConfirmButton } from "./ConfirmButton"
import { CopyButton } from "./CopyButton"
import { preloadMarkdownEditor } from "./MarkdownEditor"
import { money } from "./money"
import { onSheet, TransactionsTable } from "./Transactions"

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })

// An event's RSVPs and activity, loaded once for all of its tabs. guests has everyone who RSVPed or checked in, on one row each.
export function useEventRecords(eventId: string, onRsvpRemoved: () => void) {
  const [rsvps, setRsvps] = useState<RSVP[] | null>(null)
  const [activity, setActivity] = useState<EventActivity | null>(null)
  const [activityError, setActivityError] = useState("")
  const [rsvpError, setRsvpError] = useState("")
  useEffect(() => {
    if (!eventId) return
    preloadMarkdownEditor()
    void api<{ rsvps: RSVP[] }>(`/events/${eventId}/rsvps`).then(data => setRsvps(data.rsvps)).catch(err => setRsvpError(errorMessage(err)))
    void loadSheetData<EventActivity>(`/events/${eventId}/activity`, "This event's money and check-ins could not be loaded.", setActivity).catch(err => setActivityError(errorMessage(err)))
  }, [eventId])
  async function removeRsvp(email: string) {
    setRsvpError("")
    try {
      await api(`/events/${eventId}/rsvps`, { method: "DELETE", body: JSON.stringify({ email }) })
      setRsvps(current => current!.filter(guest => guest.email !== email)); onRsvpRemoved()
    } catch (err) { setRsvpError(errorMessage(err)) }
  }
  const checkins = activity?.checkins ?? []
  // One row per member, since people can share an email and someone can check in on more than one day. A row
  // an officer added by hand has no Member ID until the nightly sync.
  const person = (checkin: EventActivity["checkins"][number]) => checkin.memberId || checkin.email
  const people = checkins.filter((checkin, index) => checkins.findIndex(other => person(other) === person(checkin)) === index)
  const guests: { key: string; email: string; rsvp?: RSVP; checkin?: EventActivity["checkins"][number] }[] = people.map(checkin => ({ key: person(checkin), email: checkin.email, checkin }))
  // An RSVP goes with the person who checked in under its email, preferring the one with its name.
  for (const rsvp of rsvps ?? []) {
    const sameEmail = guests.filter(guest => guest.checkin && !guest.rsvp && guest.email === rsvp.email)
    const guest = sameEmail.find(item => item.checkin!.name.toLowerCase() === rsvp.name.toLowerCase()) ?? sameEmail[0]
    if (guest) guest.rsvp = rsvp
    else guests.push({ key: rsvp.email, email: rsvp.email, rsvp })
  }
  const attended = people.length || activity?.attendance
  return { rsvps, activity, activityError, rsvpError, guests, attended, removeRsvp }
}
type EventRecords = ReturnType<typeof useEventRecords>

// An event's headcounts and all of its money.
export function EventOverview({ records: { activity: data, activityError: error, attended: came }, rsvpCount }: { records: EventRecords; rsvpCount: number }) {
  if (error) return <p role="alert" className="event-error manage-notice">{error}</p>
  if (!data) return <p role="status" className="event-muted manage-notice">Loading…</p>

  const counted = data.transactions.filter(onSheet)
  const earned = counted.filter(item => item.amount > 0).reduce((sum, item) => sum + item.amount - item.fee, 0)
  const expenses = counted.filter(item => item.amount < 0)
  const spent = expenses.reduce((sum, item) => sum - item.amount, 0)
  const grant = expenses.filter(item => item.account === "GPSA").reduce((sum, item) => sum - item.amount, 0)
  const stats = [["RSVPs", String(rsvpCount)], [data.checkins.length ? "Checked in" : "Attended", came === null || came === undefined ? "Not recorded" : String(came)], ["Earned", money(earned)], ["Spent", money(spent)], ["Net after GPSA", money(earned - spent + grant)]]

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

// Everyone who RSVPed or checked in.
export function EventGuests({ records: { rsvps, activityError, rsvpError, guests, attended, removeRsvp } }: { records: EventRecords }) {
  const error = rsvpError || activityError
  return <>
    {error && <p role="alert" className="event-error manage-notice">{error}</p>}
    {rsvps === null ? !rsvpError && <p role="status" className="event-muted manage-notice">Loading guests…</p> : guests.length ? <>
      <div className="guest-summary"><span className="event-muted">{guests.length} guest{guests.length === 1 ? "" : "s"}</span><CopyButton size="sm" copy={() => navigator.clipboard.writeText(guests.map(guest => `${guest.rsvp?.name ?? guest.checkin!.name}\t${guest.email}`).join("\n"))} label="Copy names and emails" /></div>
      <Card><Table className="guest-list">
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Email</TableHead><TableHead>RSVP</TableHead><TableHead>Checked in</TableHead><TableHead className="hidden sm:table-cell">Ticket</TableHead><TableHead><span className="sr-only">Remove RSVP</span></TableHead></TableRow></TableHeader>
        <TableBody>{guests.map(({ key, email, rsvp, checkin }) => <TableRow key={key}>
          <TableCell className="font-medium">{rsvp?.name ?? checkin!.name}</TableCell>
          <TableCell className="hidden sm:table-cell">{email}</TableCell>
          <TableCell className="whitespace-nowrap tabular-nums">{rsvp ? day.format(new Date(rsvp.createdAt)) : "No"}</TableCell>
          <TableCell className="whitespace-nowrap tabular-nums">{checkin ? checkin.time : "No"}</TableCell>
          <TableCell className="hidden sm:table-cell">{checkin?.ticket ?? ""}</TableCell>
          <TableCell className="text-right">{rsvp && <ConfirmButton size="sm" aria-label={`Remove RSVP for ${rsvp.name}`} confirmLabel="Confirm" busyLabel="Removing…" onConfirm={() => removeRsvp(email)}>Remove RSVP</ConfirmButton>}</TableCell>
        </TableRow>)}</TableBody>
      </Table></Card>
    </> : <p className="event-muted manage-notice">{attended ? `${attended} attended. No names were recorded.` : "No RSVPs or check-ins yet."}</p>}
  </>
}

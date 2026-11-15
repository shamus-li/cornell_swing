import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table"
import type { EventTicket, RSVP } from "../events/model"
import type { EventActivity } from "../events/finance"
import { api, errorMessage, loadSheetData } from "./api"
import { ConfirmButton } from "./ConfirmButton"
import { CopyButton } from "./CopyButton"
import { preloadMarkdownEditor } from "./MarkdownEditor"
import { money } from "./money"
import { PriceInput } from "./PriceInput"
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
  const person = (checkin: Checkin) => checkin.memberId || checkin.email
  const people = checkins.filter((checkin, index) => checkins.findIndex(other => person(other) === person(checkin)) === index)
  const guests: { key: string; email: string; rsvp?: RSVP; checkin?: Checkin }[] = people.map(checkin => ({ key: person(checkin), email: checkin.email, checkin }))
  // An RSVP goes with the person who checked in under its email, preferring the one with its name.
  for (const rsvp of rsvps ?? []) {
    const sameEmail = guests.filter(guest => guest.checkin && !guest.rsvp && guest.email === rsvp.email)
    const guest = sameEmail.find(item => item.checkin!.name.toLowerCase() === rsvp.name.toLowerCase()) ?? sameEmail[0]
    if (guest) guest.rsvp = rsvp
    else guests.push({ key: rsvp.email, email: rsvp.email, rsvp })
  }
  const attended = people.length || activity?.attendance
  async function saveTicket(checkin: Checkin, ticket: string, paid: number) {
    setActivity(await api<EventActivity>(`/events/${eventId}/tickets`, { method: "PUT", body: JSON.stringify({ memberId: checkin.memberId, ticket, paid }) }, "The ticket could not be saved. Try again."))
  }
  return { rsvps, activity, activityError, rsvpError, guests, attended, removeRsvp, saveTicket }
}
type Checkin = EventActivity["checkins"][number]
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

const VOLUNTEER = "volunteer"
const dollars = (amount: number) => amount.toFixed(2).replace(/\.00$/, "")

// Adds or corrects the ticket of someone who checked in. A card sale stays as Square has it, and a row an officer
// added to the Sheet by hand can't have one until the nightly sync gives it a Member ID.
function TicketCell({ checkin, tickets, onSave }: { checkin: Checkin; tickets: EventTicket[]; onSave: (checkin: Checkin, ticket: string, paid: number) => Promise<void> }) {
  const sold = checkin.ticket
  const priceOf = (id: string) => dollars(Number(tickets.find(ticket => ticket.id === id)?.price || 0))
  const startChoice = () => sold?.method === "waived" ? VOLUNTEER : tickets.find(ticket => ticket.name === sold?.name)?.id ?? ""
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState(startChoice)
  const [paid, setPaid] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  if (sold?.method === "card" || !checkin.memberId) return sold?.name ?? ""
  function reset() {
    const chosen = startChoice()
    setChoice(chosen); setError("")
    setPaid(sold ? dollars(sold.paid) : chosen && chosen !== VOLUNTEER ? priceOf(chosen) : "")
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true); setError("")
    try { await onSave(checkin, choice, choice === VOLUNTEER ? 0 : Number(paid || 0)); setOpen(false) }
    catch (err) { setError(errorMessage(err)) }
    setSaving(false)
  }
  return <span className="finance-event">{sold && <span>{sold.name}</span>}
    <Popover open={open} onOpenChange={next => { if (next) reset(); setOpen(next) }}>
      <PopoverTrigger asChild>{sold
        ? <Button type="button" variant="ghost" size="sm" className="finance-event-edit w-(--button-small-height) px-0 text-muted-foreground" aria-label={`Change ticket for ${checkin.name}`}><Pencil aria-hidden="true" /></Button>
        : <Button type="button" variant="ghost" size="sm" className="finance-event-edit text-muted-foreground" aria-label={`Add ticket for ${checkin.name}`}>Add ticket</Button>}</PopoverTrigger>
      <PopoverContent align="start" className="gap-2 p-2" aria-label={`Ticket for ${checkin.name}`}>
        <form className="ticket-edit" onSubmit={event => void save(event)}>
          <div className="editor-row"><span>Ticket</span><Select value={choice} disabled={saving} onValueChange={value => { setChoice(value); setPaid(value === VOLUNTEER ? "" : priceOf(value)) }}>
            <SelectTrigger className="w-full" aria-label="Ticket"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>{tickets.map(ticket => <SelectItem key={ticket.id} value={ticket.id}>{ticket.name}</SelectItem>)}<SelectItem value={VOLUNTEER}>Volunteer</SelectItem></SelectContent>
          </Select></div>
          {choice !== VOLUNTEER && <div className="editor-row"><span>Cash paid</span><PriceInput label="Cash paid" placeholder="0" disabled={saving} value={paid} onChange={setPaid} /></div>}
          <Button type="submit" disabled={saving || !choice}>{saving ? "Saving…" : "Save"}</Button>
        </form>
        {error && <p role="alert" className="event-error">{error}</p>}
      </PopoverContent>
    </Popover>
  </span>
}

// Everyone who RSVPed or checked in.
export function EventGuests({ records: { rsvps, activityError, rsvpError, guests, attended, removeRsvp, saveTicket }, tickets }: { records: EventRecords; tickets: EventTicket[] }) {
  const error = rsvpError || activityError
  return <>
    {error && <p role="alert" className="event-error manage-notice">{error}</p>}
    {rsvps === null ? !rsvpError && <p role="status" className="event-muted manage-notice">Loading guests…</p> : guests.length ? <>
      <div className="guest-summary"><span className="event-muted">{guests.length} guest{guests.length === 1 ? "" : "s"}</span><CopyButton size="sm" copy={() => navigator.clipboard.writeText(guests.map(guest => `${guest.rsvp?.name ?? guest.checkin!.name}\t${guest.email}`).join("\n"))} label="Copy names and emails" /></div>
      <Card><Table className="guest-list">
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden sm:table-cell">Email</TableHead><TableHead>RSVP</TableHead><TableHead>Checked in</TableHead><TableHead className="hidden sm:table-cell">Ticket</TableHead><TableHead className="hidden sm:table-cell text-right">Paid</TableHead><TableHead><span className="sr-only">Remove RSVP</span></TableHead></TableRow></TableHeader>
        <TableBody>{guests.map(({ key, email, rsvp, checkin }) => <TableRow key={key}>
          <TableCell className="font-medium">{rsvp?.name ?? checkin!.name}</TableCell>
          <TableCell className="hidden sm:table-cell">{email}</TableCell>
          <TableCell className="whitespace-nowrap tabular-nums">{rsvp ? day.format(new Date(rsvp.createdAt)) : "No"}</TableCell>
          <TableCell className="whitespace-nowrap tabular-nums">{checkin ? checkin.time : "No"}</TableCell>
          <TableCell className="hidden sm:table-cell">{checkin && <TicketCell checkin={checkin} tickets={tickets} onSave={saveTicket} />}</TableCell>
          <TableCell className="hidden sm:table-cell text-right tabular-nums">{checkin?.ticket ? money(checkin.ticket.paid) : ""}</TableCell>
          <TableCell className="text-right">{rsvp && <ConfirmButton size="sm" aria-label={`Remove RSVP for ${rsvp.name}`} confirmLabel="Confirm" busyLabel="Removing…" onConfirm={() => removeRsvp(email)}>Remove RSVP</ConfirmButton>}</TableCell>
        </TableRow>)}</TableBody>
      </Table></Card>
    </> : <p className="event-muted manage-notice">{attended ? `${attended} attended. No names were recorded.` : "No RSVPs or check-ins yet."}</p>}
  </>
}

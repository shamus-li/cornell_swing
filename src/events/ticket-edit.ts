import type { Attendee } from '../../check-in/src/lib/checkin'
import { findTicket, UNSENT_CASH, volunteerTicket, type DoorCharge } from '../../check-in/worker/door'
import { findCheckinEvent } from '../../check-in/worker/events'
import { createCachedGoogleAccessTokenProvider, dateKeyForSheetTimestamp, getGoogleAccessToken, readCheckins } from '../../check-in/worker/google'
import { refundCash, sendUnsentCash } from './square'

export class TicketEditError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const accessToken = createCachedGoogleAccessTokenProvider(getGoogleAccessToken)
export const VOLUNTEER = 'volunteer'

// Sets the ticket of someone who checked in, from the manager: an event ticket type or Volunteer, and the cash they
// paid in cents, which a volunteer can pay too. Their old ticket is canceled and the new one covers the same days. Cash Square already has is
// refunded there and the new amount sent as new cash, so Square, the Balance Sheet and the manager agree. A card
// sale belongs to Square, so it's changed there instead.
export async function setDoorTicket(env: Env, eventId: string, memberId: string, choice: string, paid: number): Promise<void> {
  const event = await findCheckinEvent(env, eventId)
  if (!event) throw new TicketEditError(404, 'Event not found.')
  const ticket = choice === VOLUNTEER ? volunteerTicket(event) : findTicket(event, choice)
  if (!ticket) throw new TicketEditError(400, 'Choose a ticket.')
  if (!Number.isInteger(paid) || paid < 0 || paid > 100_000) throw new TicketEditError(400, 'Enter the cash they paid.')
  const rows = (await readCheckins(env, await accessToken(env))).filter(row => row.eventId === eventId && row.memberId === memberId && typeof row.timestamp === 'number')
  if (!rows.length) throw new TicketEditError(404, 'This person hasn’t checked in to this event.')
  const newest = rows.reduce((latest, row) => (row.timestamp as number) > (latest.timestamp as number) ? row : latest)
  const attendee: Attendee = { memberId, name: newest.name, email: newest.email, affiliation: newest.affiliation as Attendee['affiliation'], phone: newest.phone }

  const old = (await env.EVENTS_DB.prepare("SELECT * FROM door_charges WHERE eventId = ? AND memberId = ? AND status IN ('card', 'cash', 'free', 'waived')").bind(eventId, memberId).all<DoorCharge>()).results
  if (old.some(charge => charge.status === 'card')) throw new TicketEditError(409, 'They paid by card, so change or refund it in Square.')
  const days = old.length
    ? (await env.EVENTS_DB.prepare(`SELECT DISTINCT date FROM door_ticket_days WHERE chargeId IN (${old.map(() => '?').join(', ')}) ORDER BY date`).bind(...old.map(charge => charge.id)).all<{ date: string }>()).results.map(row => row.date)
    : [dateKeyForSheetTimestamp(Math.min(...rows.map(row => row.timestamp as number)))!]

  // Takes the old cash back out before anything changes, so a refund Square refuses leaves the ticket as it was.
  for (const charge of old.filter(charge => charge.status === 'cash')) {
    if (charge.paymentId) {
      if (!await refundCash(env, charge.paymentId, `ticket-edit:${charge.id}`)) throw new TicketEditError(502, 'Square didn’t refund the cash it already has, so nothing changed. Check that Square is connected in Settings and try again.')
    } else await env.EVENTS_DB.prepare('DELETE FROM square_payments WHERE id = ?').bind(`${UNSENT_CASH}${charge.id}`).run()
  }
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const status = paid ? 'cash' : choice === VOLUNTEER ? 'waived' : 'free'
  await env.EVENTS_DB.batch([
    ...old.map(charge => env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'canceled' WHERE id = ?").bind(charge.id)),
    env.EVENTS_DB.prepare('INSERT INTO door_charges (id, eventId, sessionDate, email, memberId, attendee, ticketName, amount, days, status, createdAt, settledAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)')
      .bind(id, eventId, days[0], attendee.email, memberId, JSON.stringify(attendee), ticket.name, paid, ticket.days, status, now),
    ...days.map(date => env.EVENTS_DB.prepare('INSERT INTO door_ticket_days (chargeId, date) VALUES (?, ?)').bind(id, date)),
    ...(status === 'cash' ? [env.EVENTS_DB.prepare('INSERT INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) VALUES (?, ?, ?, 0, 1, ?, ?)').bind(`${UNSENT_CASH}${id}`, now, paid, `Door cash: ${ticket.name}`, eventId)] : []),
  ])
  if (status === 'cash') await sendUnsentCash(env)
}

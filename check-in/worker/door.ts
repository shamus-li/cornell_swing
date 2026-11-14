import type { Attendee, DoorTicket } from "../src/lib/checkin"
import type { EventDay } from "../../src/events/model"
import type { CheckinEvent, EventSession } from "./events"
import { timestampForSheet } from "./google"

// Tickets at the door. A check-in at a paid event waits here until the attendee picks a ticket and pays,
// and a ticket covering several days checks them in on that many of the event's days without paying again.
export type DoorStatus = "pending" | "card" | "cash" | "free" | "waived" | "canceled"
export type DoorCharge = { id: string; eventId: string; sessionDate: string; email: string; memberId: string | null; attendee: string; ticketName: string; amount: number; days: number; status: DoorStatus; paymentId: string | null; tappedAt: string | null; createdAt: string }

const SETTLED = "('card', 'cash', 'free', 'waived')"
// Whether charge c is for this person, given SQL parameters holding their Member ID and email. People can share an
// email, so it only links a first-timer, who has no Member ID, to a charge they bought as a first-timer. Checking in
// gives that charge their new Member ID, which links it once they come back as a member.
const forPerson = (memberId: string, email: string) =>
  `(c.memberId = ${memberId} OR (${memberId} IS NULL AND c.email = ${email} AND json_extract(c.attendee, '$.memberId') IS NULL))`
// How long a trip to Square keeps being checked.
const VERIFY_MS = 10 * 60_000

// Every ticket type for the event; none means the event is free to enter.
function eventTickets(event: CheckinEvent): DoorTicket[] {
  return (JSON.parse(event.tickets) as { id: string; name: string; price: string; days: number }[])
    .map(({ id, name, price, days }) => ({ id, name, amount: Math.round(Number(price) * 100), days }))
}

const eventDates = (event: CheckinEvent) => [event.date, ...(JSON.parse(event.moreDays) as EventDay[]).map((day) => day.date)]

// The tickets to offer on this day, leaving out any covering more days than remain. An event where every
// ticket is free asks for nothing.
export function ticketsToOffer(session: EventSession): DoorTicket[] {
  const tickets = eventTickets(session)
  if (!tickets.some((ticket) => ticket.amount)) return []
  const daysLeft = eventDates(session).filter((date) => date >= session.sessionDate).length
  const fitting = tickets.filter((ticket) => ticket.days <= daysLeft)
  return fitting.length ? fitting : tickets
}

export const findTicket = (event: CheckinEvent, id: unknown) => eventTickets(event).find((ticket) => ticket.id === id)

// A volunteer is covered for the whole event.
const volunteerDays = (event: CheckinEvent) => eventDates(event).length
export const volunteerTicket = (event: CheckinEvent) => ({ name: "Volunteer", amount: 0, days: volunteerDays(event) })

// Puts this day on a ticket the attendee already holds and returns whether they had one. Asking again for the
// same day finds the same ticket without using another day, so a failed check-in can simply be retried.
export async function useHeldTicket(env: Env, session: EventSession, attendee: Attendee): Promise<boolean> {
  const held = await env.EVENTS_DB.prepare(`SELECT c.id FROM door_charges c LEFT JOIN door_ticket_days today ON today.chargeId = c.id AND today.date = ?1 WHERE c.eventId = ?2 AND ${forPerson("?3", "?4")} AND c.status IN ${SETTLED} AND (today.date IS NOT NULL OR (SELECT COUNT(*) FROM door_ticket_days used WHERE used.chargeId = c.id) < c.days) ORDER BY today.date IS NULL, c.settledAt LIMIT 1`)
    .bind(session.sessionDate, session.id, attendee.memberId, attendee.email).first<string>("id")
  if (!held) return false
  await env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_ticket_days (chargeId, date) VALUES (?, ?)").bind(held, session.sessionDate).run()
  return true
}

// Queues a card charge for the iPhone. Filling in the form again with the same ticket keeps the charge, and
// its Square link, while a different ticket replaces it, so an old link can't pay for the new ticket.
export async function openCardCharge(env: Env, session: EventSession, attendee: Attendee, ticket: Pick<DoorTicket, "name" | "amount" | "days">): Promise<DoorCharge> {
  const now = new Date().toISOString()
  const same = await env.EVENTS_DB.prepare(`UPDATE door_charges AS c SET email = ?1, attendee = ?2, sessionDate = ?3, createdAt = ?4, tappedAt = NULL WHERE eventId = ?5 AND ${forPerson("?6", "?1")} AND status = 'pending' AND ticketName = ?7 AND amount = ?8 AND days = ?9 RETURNING *`)
    .bind(attendee.email, JSON.stringify(attendee), session.sessionDate, now, session.id, attendee.memberId, ticket.name, ticket.amount, ticket.days).first<DoorCharge>()
  if (same) return same
  const [, inserted] = await env.EVENTS_DB.batch<DoorCharge>([
    env.EVENTS_DB.prepare(`UPDATE door_charges AS c SET status = 'canceled' WHERE eventId = ?1 AND ${forPerson("?2", "?3")} AND status = 'pending'`).bind(session.id, attendee.memberId, attendee.email),
    env.EVENTS_DB.prepare("INSERT INTO door_charges (id, eventId, sessionDate, email, memberId, attendee, ticketName, amount, days, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(crypto.randomUUID(), session.id, session.sessionDate, attendee.email, attendee.memberId, JSON.stringify(attendee), ticket.name, ticket.amount, ticket.days, now),
  ])
  return inserted.results[0]
}

export const findCharge = (env: Env, id: string) =>
  env.EVENTS_DB.prepare("SELECT * FROM door_charges WHERE id = ?").bind(id).first<DoorCharge>()

export const cancelCharge = (env: Env, id: string) =>
  env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'canceled' WHERE id = ? AND status = 'pending'").bind(id).run()

// Checks in the person a charge is for. A first-timer's new Member ID goes on the charge, so the ticket is theirs
// on the event's later days.
async function checkInFor(env: Env, chargeId: string, sessionDate: string, attendee: Attendee, eventId: string, timestamp: number): Promise<void> {
  const memberId = await env.CHECKIN_GUARD.getByName(sessionDate).checkin(attendee, eventId, timestampForSheet(timestamp, env.TIME_ZONE))
  if (memberId && !attendee.memberId) {
    await env.EVENTS_DB.prepare("UPDATE door_charges SET memberId = ? WHERE id = ?").bind(memberId, chargeId).run()
  }
}

// Square's return says the sale went through, and its payment hasn't been found yet.
export const isAwaitingPayment = ({ status, paymentId }: DoorCharge) => status === "card" && paymentId === null

// A card sale, from Square's return (no payment ID, and callbackAt marks it as still to find) or from a payment
// found in Square, which also fills in the ID after a return. Records the check-in first, so if that fails the
// payment isn't saved and the next sync tries again, and a retry finds the check-in already there.
export async function settleCardCharge(env: Env, charge: DoorCharge, paymentId: string | null, paidAt: number): Promise<void> {
  await checkInFor(env, charge.id, charge.sessionDate, JSON.parse(charge.attendee) as Attendee, charge.eventId, paidAt)
  await env.EVENTS_DB.batch([
    env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'card', paymentId = ?1, settledAt = COALESCE(settledAt, ?2), callbackAt = CASE WHEN ?1 IS NULL THEN ?2 END WHERE id = ?3 AND (status = 'pending' OR (status = 'card' AND paymentId IS NULL))").bind(paymentId, new Date(paidAt).toISOString(), charge.id),
    env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_ticket_days (chargeId, date) VALUES (?, ?)").bind(charge.id, charge.sessionDate),
  ])
}

// Cash, a free ticket or a volunteer, confirmed on a laptop. The laptop picks the ID, so retrying after a lost
// response changes nothing, and any card charge still waiting is canceled. If another laptop already settled
// this person for this day, nothing is recorded, even when both ask at once, and this returns false. Cash goes
// on the Balance Sheet with the event's Square payments, and waits under an unsent ID until Square has it too.
export const UNSENT_CASH = "unsent:"
export async function settleAtDoor(env: Env, id: string, session: EventSession, attendee: Attendee, ticket: Pick<DoorTicket, "name" | "amount" | "days">, status: "cash" | "free" | "waived", timestamp: number): Promise<boolean> {
  const now = new Date(timestamp).toISOString()
  await env.EVENTS_DB.batch([
    env.EVENTS_DB.prepare(`INSERT OR IGNORE INTO door_charges (id, eventId, sessionDate, email, memberId, attendee, ticketName, amount, days, status, createdAt, settledAt) SELECT ?1, ?2, ?3, ?4, ?11, ?5, ?6, ?7, ?8, ?9, ?10, ?10 WHERE NOT EXISTS (SELECT 1 FROM door_charges c JOIN door_ticket_days d ON d.chargeId = c.id WHERE c.eventId = ?2 AND ${forPerson("?11", "?4")} AND d.date = ?3 AND c.status IN ${SETTLED})`)
      .bind(id, session.id, session.sessionDate, attendee.email, JSON.stringify(attendee), ticket.name, ticket.amount, ticket.days, status, now, attendee.memberId),
    env.EVENTS_DB.prepare(`UPDATE door_charges AS c SET status = 'canceled' WHERE eventId = ?1 AND ${forPerson("?2", "?3")} AND status = 'pending' AND EXISTS (SELECT 1 FROM door_charges WHERE id = ?4)`).bind(session.id, attendee.memberId, attendee.email, id),
    env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_ticket_days (chargeId, date) SELECT id, ? FROM door_charges WHERE id = ?").bind(session.sessionDate, id),
    ...(status === "cash"
      ? [env.EVENTS_DB.prepare("INSERT OR IGNORE INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) SELECT ?, ?, amount, 0, 1, ?, ? FROM door_charges WHERE id = ? AND paymentId IS NULL").bind(`${UNSENT_CASH}${id}`, now, `Door cash: ${ticket.name}`, session.id, id)]
      : []),
  ])
  if (!await findCharge(env, id)) return false
  await checkInFor(env, id, session.sessionDate, attendee, session.id, timestamp)
  return true
}

// How long someone stays on the iPhone's list.
const QUEUE_MS = 30 * 60_000

export async function queuedCharges(env: Env): Promise<DoorCharge[]> {
  return (await env.EVENTS_DB.prepare("SELECT * FROM door_charges WHERE status = 'pending' AND createdAt > ? ORDER BY createdAt")
    .bind(new Date(Date.now() - QUEUE_MS).toISOString()).all<DoorCharge>()).results
}

// Who just paid by card, for the iPhone to confirm. Finding a payment can take a little while after it's made.
const JUST_PAID_MS = 30_000
export async function justPaidCharges(env: Env): Promise<DoorCharge[]> {
  return (await env.EVENTS_DB.prepare("SELECT * FROM door_charges WHERE status = 'card' AND settledAt > ? ORDER BY settledAt DESC LIMIT 1")
    .bind(new Date(Date.now() - JUST_PAID_MS).toISOString()).all<DoorCharge>()).results
}

export const isVerifying = ({ tappedAt }: DoorCharge) => !!tappedAt && Date.now() - Date.parse(tappedAt) < VERIFY_MS

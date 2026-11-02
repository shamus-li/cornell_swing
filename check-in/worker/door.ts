import type { Attendee, DoorTicket } from "../src/lib/checkin"
import type { EventDay } from "../../src/events/model"
import type { CheckinEvent, EventSession } from "./events"
import { timestampForSheet } from "./google"

// Tickets at the door. A check-in at a paid event waits here until the attendee picks a ticket and pays,
// and a ticket covering several days checks them in on that many of the event's days without paying again.
export type DoorStatus = "pending" | "card" | "cash" | "free" | "waived" | "canceled"
export type DoorCharge = { id: string; eventId: string; sessionDate: string; email: string; attendee: string; ticketName: string; amount: number; days: number; status: DoorStatus; tappedAt: string | null; callbackAt: string | null; createdAt: string }

const SETTLED = "('card', 'cash', 'free', 'waived')"

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
export async function useHeldTicket(env: Env, session: EventSession, email: string): Promise<boolean> {
  const held = await env.EVENTS_DB.prepare(`SELECT c.id FROM door_charges c LEFT JOIN door_ticket_days today ON today.chargeId = c.id AND today.date = ?1 WHERE c.eventId = ?2 AND c.email = ?3 AND c.status IN ${SETTLED} AND (today.date IS NOT NULL OR (SELECT COUNT(*) FROM door_ticket_days used WHERE used.chargeId = c.id) < c.days) ORDER BY today.date IS NULL, c.settledAt LIMIT 1`)
    .bind(session.sessionDate, session.id, email).first<string>("id")
  if (!held) return false
  await env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_ticket_days (chargeId, date) VALUES (?, ?)").bind(held, session.sessionDate).run()
  return true
}

// Queues a card charge for the iPhone. Filling in the form again with the same ticket keeps the charge, and
// its Square link, while a different ticket replaces it, so an old link can't pay for the new ticket.
export async function openCardCharge(env: Env, session: EventSession, attendee: Attendee, ticket: Pick<DoorTicket, "name" | "amount" | "days">): Promise<DoorCharge> {
  const now = new Date().toISOString()
  const same = await env.EVENTS_DB.prepare("UPDATE door_charges SET attendee = ?, sessionDate = ?, createdAt = ?, tappedAt = NULL, callbackAt = NULL WHERE eventId = ? AND email = ? AND status = 'pending' AND ticketName = ? AND amount = ? AND days = ? RETURNING *")
    .bind(JSON.stringify(attendee), session.sessionDate, now, session.id, attendee.email, ticket.name, ticket.amount, ticket.days).first<DoorCharge>()
  if (same) return same
  const [, inserted] = await env.EVENTS_DB.batch<DoorCharge>([
    env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'canceled' WHERE eventId = ? AND email = ? AND status = 'pending'").bind(session.id, attendee.email),
    env.EVENTS_DB.prepare("INSERT INTO door_charges (id, eventId, sessionDate, email, attendee, ticketName, amount, days, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(crypto.randomUUID(), session.id, session.sessionDate, attendee.email, JSON.stringify(attendee), ticket.name, ticket.amount, ticket.days, now),
  ])
  return inserted.results[0]
}

export const findCharge = (env: Env, id: string) =>
  env.EVENTS_DB.prepare("SELECT * FROM door_charges WHERE id = ?").bind(id).first<DoorCharge>()

export const cancelCharge = (env: Env, id: string) =>
  env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'canceled' WHERE id = ? AND status = 'pending'").bind(id).run()

const checkInOn = (env: Env, sessionDate: string, attendee: Attendee, eventId: string, timestamp: number) =>
  env.CHECKIN_GUARD.getByName(sessionDate).checkin(attendee, eventId, timestampForSheet(timestamp, env.TIME_ZONE))

// A card payment found in Square. Records the check-in first, so a failure before the charge is marked paid
// is retried on the next sync and finds the check-in already there.
export async function settleCardCharge(env: Env, charge: DoorCharge, paymentId: string, paidAt: number): Promise<void> {
  await checkInOn(env, charge.sessionDate, JSON.parse(charge.attendee) as Attendee, charge.eventId, paidAt)
  await env.EVENTS_DB.batch([
    env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'card', paymentId = ?, settledAt = ? WHERE id = ? AND status = 'pending'").bind(paymentId, new Date(paidAt).toISOString(), charge.id),
    env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_ticket_days (chargeId, date) VALUES (?, ?)").bind(charge.id, charge.sessionDate),
  ])
}

// Cash, a free ticket or a volunteer, confirmed on the laptop. The laptop picks the ID, so retrying after a
// lost response changes nothing, and any card charge still waiting is canceled. Cash goes on the Balance Sheet
// with the event's Square payments.
export async function settleAtDoor(env: Env, id: string, session: EventSession, attendee: Attendee, ticket: Pick<DoorTicket, "name" | "amount" | "days">, status: "cash" | "free" | "waived", timestamp: number): Promise<void> {
  const now = new Date(timestamp).toISOString()
  await env.EVENTS_DB.batch([
    env.EVENTS_DB.prepare("UPDATE door_charges SET status = 'canceled' WHERE eventId = ? AND email = ? AND status = 'pending'").bind(session.id, attendee.email),
    env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_charges (id, eventId, sessionDate, email, attendee, ticketName, amount, days, status, createdAt, settledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, session.id, session.sessionDate, attendee.email, JSON.stringify(attendee), ticket.name, ticket.amount, ticket.days, status, now, now),
    env.EVENTS_DB.prepare("INSERT OR IGNORE INTO door_ticket_days (chargeId, date) VALUES (?, ?)").bind(id, session.sessionDate),
    ...(status === "cash"
      ? [env.EVENTS_DB.prepare("INSERT OR IGNORE INTO square_payments (id, paidAt, amount, fee, cash, note, eventId) VALUES (?, ?, ?, 0, 1, ?, ?)").bind(`cash:${id}`, now, ticket.amount, `Door cash: ${ticket.name}`, session.id)]
      : []),
  ])
  await checkInOn(env, session.sessionDate, attendee, session.id, timestamp)
}

// How long someone stays on the iPhone's list, and how long a trip to Square keeps being checked.
const QUEUE_MS = 30 * 60_000
const VERIFY_MS = 5 * 60_000

export async function queuedCharges(env: Env): Promise<DoorCharge[]> {
  return (await env.EVENTS_DB.prepare("SELECT * FROM door_charges WHERE status = 'pending' AND createdAt > ? ORDER BY createdAt")
    .bind(new Date(Date.now() - QUEUE_MS).toISOString()).all<DoorCharge>()).results
}

export const isVerifying = ({ tappedAt, callbackAt }: DoorCharge) => {
  const since = callbackAt ?? tappedAt
  return !!since && Date.now() - Date.parse(since) < VERIFY_MS
}

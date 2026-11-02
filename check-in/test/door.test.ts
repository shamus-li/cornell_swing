import { env } from "cloudflare:workers"
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test"
import { HttpResponse, http } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { handleApiRequest, handleCheckin, handleCheckinStatus } from "../worker"
import { storeMemberCache } from "../worker/cache"
import { findSession } from "../worker/events"
import { dateKeyInTimeZone, timestampForSheet } from "../worker/google"
import { syncPayments, syncSquare } from "../../src/events/square"
import { resetEventsDb } from "./events-db"
import { network } from "./network"

vi.mock("../worker/google", async (importOriginal) => ({
  ...await importOriginal<typeof import("../worker/google")>(),
  getGoogleAccessToken: vi.fn(async () => "test-token"),
}))

const DAY = 86_400_000
const today = () => dateKeyInTimeZone(Date.now(), "America/New_York")
const tomorrow = () => dateKeyInTimeZone(Date.now() + DAY, "America/New_York")
const ada = { memberId: null, name: "Ada Lovelace", email: "ada@example.com", phone: "607-555-0100", affiliation: "Staff" }
const tickets = [
  { id: "student", name: "Student", price: "10", days: 1 },
  { id: "general", name: "General", price: "15", days: 1 },
  { id: "weekend", name: "Weekend pass", price: "25", days: 2 },
  { id: "kid", name: "Under 12", price: "0", days: 1 },
]
const general = { ...ada, ticketId: "general" }
let settleCount = 0
const settle = (ticketId: string | undefined, method: string, id = `settle-${++settleCount}`) => post("door/settle", { ...ada, id, ticketId, method })
const checkInOn = (timestamp: number) => handleCheckin(new Request("https://example.com/", { method: "POST", body: JSON.stringify(ada) }), env, timestamp)
const TOMORROW = () => Date.now() + DAY

const post = (path: string, body: unknown) =>
  handleApiRequest(new Request(`https://example.com/check-in/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env)
const get = (path: string) => handleApiRequest(new Request(`https://example.com/check-in/api/${path}`), env)
const isCheckedIn = async (timestamp = Date.now()) =>
  ((await (await handleCheckinStatus(new Request("https://example.com/", { method: "POST", body: JSON.stringify(ada) }), env, timestamp)).json()) as { checkedIn: boolean }).checkedIn
const queue = async () => ((await (await get("door/queue")).json()) as { charges: { id: string; label: string; ticketName: string; amount: number; verifying: boolean }[] }).charges

let payments: Record<string, unknown>[] = []
const squarePayment = (chargeId: string, amount = 1500) => ({ id: "square-1", created_at: new Date().toISOString(), status: "COMPLETED", source_type: "CARD", amount_money: { amount, currency: "USD" }, processing_fee: [{ amount_money: { amount: 54, currency: "USD" } }], note: `door:${chargeId} Ada L.` })

beforeEach(async () => {
  await resetEventsDb()
  await storeMemberCache(env, [])
  for (const id of await listDurableObjectIds(env.CHECKIN_GUARD)) {
    await runInDurableObject(env.CHECKIN_GUARD.get(id), async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM checkin_keys")
      state.storage.sql.exec("DELETE FROM pending")
      await state.storage.deleteAlarm()
    })
  }
  payments = []
  await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, moreDays, lastDate, startTime, endTime, tickets, updatedAt) VALUES ('weekend', 'special', 'Sweater Weather Swing', ?1, ?2, ?3, '00:00', '23:59', ?4, '')")
    .bind(today(), JSON.stringify([{ date: tomorrow(), startTime: "00:00", endTime: "23:59" }]), tomorrow(), JSON.stringify(tickets)).run()
  await env.EVENTS_DB.prepare("INSERT INTO square_connection (id, merchantId, name, accessToken, refreshToken, expiresAt, syncedAt) VALUES (1, 'club', 'Club', 'token', 'refresh', '2099-01-01T00:00:00Z', ?)").bind(new Date().toISOString()).run()
  network.use(
    http.get("https://connect.squareup.com/v2/payments", () => HttpResponse.json({ payments })),
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchGet", () => HttpResponse.json({ valueRanges: [{}, {}, {}] })),
    http.post("https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchUpdate", () => HttpResponse.json({})),
  )
})

describe("door tickets", () => {
  it("holds the check-in until a ticket is chosen and paid", async () => {
    const response = await post("checkins", ada)
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({ event: "Sweater Weather Swing", tickets: [{ id: "student", amount: 1000 }, { id: "general", amount: 1500 }, { id: "weekend", amount: 2500, days: 2 }, { id: "kid", amount: 0 }] })
    expect(await isCheckedIn()).toBe(false)
  })

  it("asks for nothing when every ticket is free", async () => {
    await env.EVENTS_DB.prepare("UPDATE events SET tickets = ?").bind(JSON.stringify([{ id: "free", name: "Everyone", price: "0", days: 1 }])).run()
    expect((await post("checkins", ada)).status).toBe(201)
  })

  it("checks in on cash and files it with the ticket's price", async () => {
    expect((await settle("general", "cash")).status).toBe(201)
    expect(await isCheckedIn()).toBe(true)
    expect(await env.EVENTS_DB.prepare("SELECT amount, cash, eventId FROM square_payments").first()).toEqual({ amount: 1500, cash: 1, eventId: "weekend" })
    expect((await post("checkins", ada)).status).toBe(409)
  })

  it("records cash once when the laptop retries after a lost response", async () => {
    await settle("general", "cash", "retry")
    expect((await settle("general", "cash", "retry")).status).toBe(201)
    expect(await env.EVENTS_DB.prepare("SELECT COUNT(*) AS count FROM square_payments").first("count")).toBe(1)
    expect(await env.EVENTS_DB.prepare("SELECT COUNT(*) AS count FROM door_charges").first("count")).toBe(1)
  })

  it("checks in on a free ticket without recording money, and only on a free ticket", async () => {
    expect((await settle("general", "free")).status).toBe(400)
    expect((await settle("kid", "cash")).status).toBe(400)
    expect((await settle("kid", "free")).status).toBe(201)
    expect(await isCheckedIn()).toBe(true)
    expect(await env.EVENTS_DB.prepare("SELECT COUNT(*) AS count FROM square_payments").first("count")).toBe(0)
  })

  it("waives for a volunteer across the whole event", async () => {
    expect((await settle(undefined, "waived")).status).toBe(201)
    expect(await env.EVENTS_DB.prepare("SELECT COUNT(*) AS count FROM square_payments").first("count")).toBe(0)
    expect(await env.EVENTS_DB.prepare("SELECT status, ticketName, days FROM door_charges").first()).toEqual({ status: "waived", ticketName: "Volunteer", days: 2 })
    expect((await checkInOn(TOMORROW())).status).toBe(201)
  })

  it("lets a two-day ticket check in on both days, using one day per day even if the check-in is retried", async () => {
    await settle("weekend", "cash")
    expect((await checkInOn(TOMORROW())).status).toBe(201)
    expect((await checkInOn(TOMORROW())).status).toBe(409)
    expect(await env.EVENTS_DB.prepare("SELECT COUNT(*) AS count FROM door_ticket_days").first("count")).toBe(2)
  })

  it("asks a one-day ticket holder to buy again on the second day, without offering tickets too long for it", async () => {
    await settle("general", "cash")
    const response = await checkInOn(TOMORROW())
    expect(response.status).toBe(402)
    const { tickets: offered } = (await response.json()) as { tickets: { id: string }[] }
    expect(offered.map((ticket) => ticket.id)).toEqual(["student", "general", "kid"])
  })

  it("settles a card charge when Square has the payment", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    expect(await queue()).toMatchObject([{ id, label: "Ada L.", ticketName: "General", amount: 1500, verifying: false }])
    expect(await (await get(`door/charges/${id}`)).json()).toEqual({ status: "pending" })

    payments.push(squarePayment(id))
    expect(await (await post(`door/charges/${id}/return`, { ok: true })).json()).toEqual({ status: "paid", name: "Ada" })
    expect(await isCheckedIn()).toBe(true)
    expect(await queue()).toEqual([])
    expect(await (await get(`door/charges/${id}`)).json()).toMatchObject({ status: "paid" })
    expect(await env.EVENTS_DB.prepare("SELECT eventId, fee FROM square_payments").first()).toEqual({ eventId: "weekend", fee: 54 })
  })

  it("refuses a card charge for a ticket the event doesn't have", async () => {
    expect((await post("door/charges", { ...ada, ticketId: "nope" })).status).toBe(400)
    expect((await post("door/charges", { ...ada, ticketId: "kid" })).status).toBe(400)
  })

  it("settles a card charge even when the return from Square is lost", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    payments.push(squarePayment(id))
    await syncSquare(env)
    expect(await isCheckedIn()).toBe(true)
  })

  it("locks a name once it's tapped, and unlocks it if the payment is canceled", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    await post(`door/charges/${id}/tap`, {})
    expect(await queue()).toMatchObject([{ id, verifying: true }])
    expect(await (await post(`door/charges/${id}/return`, { ok: false })).json()).toEqual({ status: "pending", name: "Ada" })
    expect(await queue()).toMatchObject([{ id, verifying: false }])
  })

  it("takes someone off the queue when they pay another way, and doesn't settle a card payment that lands afterward", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    await handleApiRequest(new Request(`https://example.com/check-in/api/door/charges/${id}`, { method: "DELETE" }), env)
    expect(await queue()).toEqual([])
    payments.push(squarePayment(id))
    await syncPayments(env)
    expect(await isCheckedIn()).toBe(false)
    expect(await env.EVENTS_DB.prepare("SELECT status FROM door_charges").first("status")).toBe("canceled")
  })

  it("cancels a waiting card charge when cash is confirmed", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    await settle("general", "cash")
    expect(await env.EVENTS_DB.prepare("SELECT status FROM door_charges WHERE id = ?").bind(id).first("status")).toBe("canceled")
    expect(await queue()).toEqual([])
  })

  it("keeps the charge for the same ticket, and replaces it for a different one, so an old link can't pay for the new ticket", async () => {
    const first = (await (await post("door/charges", general)).json()) as { id: string }
    expect(((await (await post("door/charges", general)).json()) as { id: string }).id).toBe(first.id)
    const second = (await (await post("door/charges", { ...ada, ticketId: "weekend" })).json()) as { id: string }
    expect(second.id).not.toBe(first.id)
    expect(await queue()).toMatchObject([{ id: second.id, ticketName: "Weekend pass", amount: 2500 }])
    payments.push(squarePayment(first.id))
    await syncPayments(env)
    expect(await isCheckedIn()).toBe(false)
  })

  it("doesn't settle a payment for the wrong amount", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    payments.push(squarePayment(id, 100))
    await syncPayments(env)
    expect(await isCheckedIn()).toBe(false)
    expect(await queue()).toMatchObject([{ id }])
  })

  it("settles once Square has the payment after a return that says paid", async () => {
    const { id } = (await (await post("door/charges", general)).json()) as { id: string }
    await post(`door/charges/${id}/return`, { ok: true })
    expect(await queue()).toMatchObject([{ id, verifying: true }])
    payments.push(squarePayment(id))
    await env.EVENTS_DB.prepare("UPDATE square_connection SET syncedAt = ?").bind(new Date(Date.now() - 60_000).toISOString()).run()
    expect(await queue()).toEqual([])
  })
})

describe("which session a moment belongs to", () => {
  const at = (iso: string) => timestampForSheet(Date.parse(iso), "America/New_York")
  const add = (id: string, kind: string, date: string, startTime: string, endTime: string, moreDays: { date: string; startTime: string; endTime: string }[] = []) =>
    env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, moreDays, lastDate, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')")
      .bind(id, kind, id, date, startTime, endTime, JSON.stringify(moreDays), moreDays.at(-1)?.date ?? "").run()
  beforeEach(() => env.EVENTS_DB.exec("DELETE FROM events"))

  it("uses each day's own times", async () => {
    await add("workshop", "special", "2027-03-05", "18:00", "22:00", [{ date: "2027-03-06", startTime: "10:00", endTime: "17:00" }])
    expect(await findSession(env, at("2027-03-06T16:00:00Z"))).toMatchObject({ id: "workshop", sessionDate: "2027-03-06" })
    // 8:00 PM on the second day is past its 5:00 PM end, but within the time people linger.
    expect(await findSession(env, at("2027-03-07T01:00:00Z"))).toMatchObject({ id: "workshop", sessionDate: "2027-03-06" })
    expect(await findSession(env, at("2027-03-06T20:30:00Z"))).toMatchObject({ id: "workshop", sessionDate: "2027-03-06" })
    expect(await findSession(env, at("2027-03-07T05:00:00Z"))).toBeNull()
  })

  it("sends an arrival between two events to the one about to start", async () => {
    await add("workshop", "special", "2027-03-08", "17:00", "19:00")
    await add("lesson", "normal", "2027-03-08", "20:00", "22:00")
    expect(await findSession(env, at("2027-03-09T00:10:00Z"))).toMatchObject({ id: "lesson" })
  })

  it("takes the earlier start when two overlap, and the special event when they start together", async () => {
    await add("lesson", "normal", "2027-03-08", "19:00", "22:00")
    await add("special", "special", "2027-03-08", "20:00", "23:00")
    expect(await findSession(env, at("2027-03-09T01:30:00Z"))).toMatchObject({ id: "lesson" })
    await add("tied", "special", "2027-03-08", "19:00", "22:00")
    expect(await findSession(env, at("2027-03-09T01:30:00Z"))).toMatchObject({ id: "tied" })
  })

  it("keeps a check-in just after midnight with the night before", async () => {
    await add("dance", "special", "2027-03-05", "20:00", "23:00")
    expect(await findSession(env, at("2027-03-06T05:30:00Z"))).toMatchObject({ id: "dance", sessionDate: "2027-03-05" })
  })
})

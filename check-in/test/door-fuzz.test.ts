import { env } from "cloudflare:workers"
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test"
import { HttpResponse, http } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { handleApiRequest } from "../worker"
import { storeMemberCache } from "../worker/cache"
import { syncPayments } from "../../src/events/square"
import { resetEventsDb } from "./events-db"
import { network } from "./network"

vi.mock("../worker/google", async (importOriginal) => ({
  ...await importOriginal<typeof import("../worker/google")>(),
  getGoogleAccessToken: vi.fn(async () => "test-token"),
}))

// A busy door: several laptops checking people in at once and one or more phones taking card payments.
// Each seed plays out a different mix of people, then checks that everyone paid exactly once, for their own ticket.
const TICKETS = [{ id: "student", name: "Student", price: "10", days: 1 }, { id: "general", name: "General", price: "15", days: 1 }]
const AMOUNTS: Record<string, number> = { student: 1000, general: 1500 }
const START = Date.parse("2026-11-13T23:30:00Z")

function random(seed: number) {
  let state = seed
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  return { next, pick: <T,>(items: T[]) => items[Math.floor(next() * items.length)] }
}

const post = (path: string, body: unknown) =>
  handleApiRequest(new Request(`https://example.com/check-in/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env)
const get = (path: string) => handleApiRequest(new Request(`https://example.com/check-in/api/${path}`), env)
const advance = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000)

type Person = { attendee: { memberId: null; name: string; email: string; phone: string; affiliation: string }; ticketId: string; plan: "card" | "lost-return" | "no-return" | "cancel-then-cash" | "switch-ticket" | "cash" | "cash-retry" | "two-laptops" }
const PLANS: Person["plan"][] = ["card", "card", "card", "lost-return", "no-return", "cancel-then-cash", "switch-ticket", "cash", "cash", "cash-retry", "two-laptops"]

let squarePayments: Record<string, unknown>[] = []
let orders: Record<string, object> = {}
let settleIds = 0
let squareIds = 0

async function ringUp(amount: number, chargeId: string) {
  const id = `square-${++squareIds}`
  orders[`order-${id}`] = { order: { line_items: [{ note: `door:${chargeId} Someone` }] } }
  squarePayments.push({ id, order_id: `order-${id}`, created_at: new Date().toISOString(), status: "COMPLETED", source_type: "CARD", amount_money: { amount, currency: "USD" }, processing_fee: [{ amount_money: { amount: 50, currency: "USD" } }] })
}

async function runDoor(seed: number, count: number) {
  const { next, pick } = random(seed)
  const people: Person[] = Array.from({ length: count }, (_, index) => ({
    attendee: {
      memberId: null,
      // Some people share a name.
      name: index % 7 === 0 ? "Sam Taylor" : `Dancer Number${index}`,
      email: `dancer${index}@example.com`,
      phone: "607-555-0100",
      affiliation: "Staff",
    },
    ticketId: pick(Object.keys(AMOUNTS)),
    plan: pick(PLANS),
  }))
  const waiting = new Map<string, Person>()
  const charged = new Map<string, Person>()
  const settle = (person: Person, id = `settle-${++settleIds}`) => post("door/settle", { ...person.attendee, id, ticketId: person.ticketId, method: "cash" })

  async function arrive(person: Person) {
    expect((await post("checkins", person.attendee)).status).toBe(402)
    if (person.plan === "cash") return void await settle(person)
    if (person.plan === "cash-retry") {
      const id = `settle-${++settleIds}`
      await settle(person, id)
      expect((await settle(person, id)).status).toBe(201)
      return
    }
    if (person.plan === "two-laptops") {
      await settle(person)
      expect((await settle(person)).status).toBe(409)
      return
    }
    if (person.plan === "switch-ticket") {
      const other = person.ticketId === "student" ? "general" : "student"
      await post("door/charges", { ...person.attendee, ticketId: other })
    }
    const { id } = (await (await post("door/charges", { ...person.attendee, ticketId: person.ticketId })).json()) as { id: string }
    waiting.set(id, person)
  }

  // One phone: one person at a time taps their name and pays.
  async function serveNext() {
    const [id, person] = [...waiting.entries()][0] ?? []
    if (!id || !person) return
    waiting.delete(id)
    await post(`door/charges/${id}/tap`, {})
    advance(8)
    if (person.plan === "cancel-then-cash") {
      expect(await (await post(`door/charges/${id}/return`, { ok: false })).json()).toMatchObject({ status: "pending" })
      advance(2)
      expect((await settle(person)).status).toBe(201)
      return
    }
    await ringUp(AMOUNTS[person.ticketId], id)
    charged.set(id, person)
    // The next person may step up before the site has looked at Square.
    if (person.plan === "card") {
      advance(next() * 3)
      await post(`door/charges/${id}/return`, { ok: true })
    } else if (person.plan === "no-return") {
      advance(1)
      await get(`door/charges/${id}`)
    }
    advance(1)
  }

  for (const person of people) {
    await arrive(person)
    advance(next() * 3)
    // Laptops ask about whoever they're showing, and the phone refreshes its list.
    if (next() < 0.5) await get("door/queue")
    // Sometimes two phones are serving people at once.
    while (waiting.size && next() < 0.45) await Promise.all(next() < 0.4 ? [serveNext(), serveNext()] : [serveNext()])
  }
  while (waiting.size) await serveNext()
  advance(60)
  await syncPayments(env)
  return { people, charged }
}

async function expectEveryoneSettled({ people, charged }: Awaited<ReturnType<typeof runDoor>>) {
  const { results: charges } = await env.EVENTS_DB.prepare("SELECT id, email, status, amount, ticketName, paymentId FROM door_charges").all<{ id: string; email: string; status: string; amount: number; ticketName: string; paymentId: string | null }>()
  const { results: payments } = await env.EVENTS_DB.prepare("SELECT id, amount, cash FROM square_payments").all<{ id: string; amount: number; cash: number }>()
  for (const person of people) {
    const email = person.attendee.email
    const settled = charges.filter((charge) => charge.email === email && charge.status !== "pending" && charge.status !== "canceled")
    expect(settled, `${email} (${person.plan}) should hold exactly one ticket`).toHaveLength(1)
    expect(settled[0].amount, `${email} (${person.plan}) paid for the wrong ticket`).toBe(AMOUNTS[person.ticketId])
    const status = await (await handleApiRequest(new Request("https://example.com/check-in/api/checkins/status", { method: "POST", body: JSON.stringify(person.attendee) }), env)).json() as { checkedIn: boolean }
    expect(status.checkedIn, `${email} (${person.plan}) should be checked in`).toBe(true)
  }
  expect(charges.filter((charge) => charge.status === "pending"), "nobody should still be waiting").toEqual([])
  // Every card payment settled the charge that person was paying for, and each payment was used once.
  for (const [id, person] of charged) {
    const charge = charges.find((item) => item.id === id)!
    expect(charge.status, `${person.attendee.email} (${person.plan}) paid by card`).toBe("card")
  }
  const used = charges.flatMap((charge) => charge.paymentId ?? [])
  expect(new Set(used).size).toBe(used.length)
  expect(used.length).toBe(squarePayments.length)
  const cashPeople = people.filter((person) => ["cash", "cash-retry", "two-laptops", "cancel-then-cash"].includes(person.plan))
  const cashTotal = payments.filter((payment) => payment.cash).reduce((sum, payment) => sum + payment.amount, 0)
  expect(cashTotal, "cash on the books should match the cash taken").toBe(cashPeople.reduce((sum, person) => sum + AMOUNTS[person.ticketId], 0))
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(START)
  await resetEventsDb()
  await storeMemberCache(env, [])
  for (const id of await listDurableObjectIds(env.CHECKIN_GUARD)) {
    await runInDurableObject(env.CHECKIN_GUARD.get(id), async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM checkin_keys")
      state.storage.sql.exec("DELETE FROM pending")
      await state.storage.deleteAlarm()
    })
  }
  squarePayments = []
  await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, tickets, updatedAt) VALUES ('dance', 'special', 'Dance', '2026-11-13', '18:00', '22:00', ?, '')").bind(JSON.stringify(TICKETS)).run()
  await env.EVENTS_DB.prepare("INSERT INTO square_connection (id, merchantId, name, accessToken, refreshToken, expiresAt, syncedAt) VALUES (1, 'club', 'Club', 'token', 'refresh', '2099-01-01T00:00:00Z', ?)").bind(new Date(START - 60_000).toISOString()).run()
  orders = {}
  network.use(
    http.get("https://connect.squareup.com/v2/payments", () => HttpResponse.json({ payments: squarePayments })),
    http.get("https://connect.squareup.com/v2/orders/:id", ({ params }) => HttpResponse.json(orders[params.id as string])),
  )
})
afterEach(() => vi.useRealTimers())

describe("a busy door with several laptops and phones", () => {
  const person = (index: number) => ({ memberId: null, name: `Dancer Number${index}`, email: `dancer${index}@example.com`, phone: "607-555-0100", affiliation: "Staff" })
  const count = async (sql: string) => env.EVENTS_DB.prepare(sql).first<number>("count")

  it("records one ticket when two laptops confirm the same person's cash at once", async () => {
    const [first, second] = await Promise.all([
      post("door/settle", { ...person(1), id: "laptop-a", ticketId: "general", method: "cash" }),
      post("door/settle", { ...person(1), id: "laptop-b", ticketId: "general", method: "cash" }),
    ])
    expect([first.status, second.status].sort()).toEqual([201, 409])
    expect(await count("SELECT COUNT(*) AS count FROM door_charges")).toBe(1)
    expect(await env.EVENTS_DB.prepare("SELECT SUM(amount) AS total FROM square_payments").first("total")).toBe(1500)
  })

  it("handles many laptops checking in different people at the same moment", async () => {
    const responses = await Promise.all(Array.from({ length: 30 }, (_, index) => post("door/settle", { ...person(index), id: `same-time-${index}`, ticketId: "student", method: "cash" })))
    expect(responses.every((response) => response.status === 201)).toBe(true)
    expect(await env.EVENTS_DB.prepare("SELECT SUM(amount) AS total FROM square_payments").first("total")).toBe(30 * 1000)
    expect(await count("SELECT COUNT(*) AS count FROM door_charges WHERE status = 'cash'")).toBe(30)
  })

  it("settles a payment once when every laptop and the phone ask at the same moment", async () => {
    const ids = await Promise.all([0, 1].map(async (index) => ((await (await post("door/charges", { ...person(index), ticketId: "general" })).json()) as { id: string }).id))
    await post(`door/charges/${ids[0]}/tap`, {})
    advance(8)
    await ringUp(1500, ids[0])
    advance(10)
    await Promise.all([get("door/queue"), get(`door/charges/${ids[0]}`), get(`door/charges/${ids[1]}`), syncPayments(env), syncPayments(env), post(`door/charges/${ids[0]}/return`, { ok: true })])
    expect(await env.EVENTS_DB.prepare("SELECT status FROM door_charges WHERE id = ?").bind(ids[0]).first("status")).toBe("card")
    expect(await env.EVENTS_DB.prepare("SELECT status FROM door_charges WHERE id = ?").bind(ids[1]).first("status")).toBe("pending")
    expect(await count("SELECT COUNT(*) AS count FROM square_payments")).toBe(1)
  })

  it("gives the next person's payment to them when they tap before the site has looked at Square", async () => {
    const ids = await Promise.all([0, 1].map(async (index) => ((await (await post("door/charges", { ...person(index), ticketId: "general" })).json()) as { id: string }).id))
    await post(`door/charges/${ids[0]}/tap`, {})
    advance(8)
    await ringUp(1500, ids[0])
    advance(2)
    await post(`door/charges/${ids[1]}/tap`, {})
    advance(8)
    await ringUp(1500, ids[1])
    advance(1)
    await syncPayments(env)
    const { results } = await env.EVENTS_DB.prepare("SELECT id, paymentId FROM door_charges").all<{ id: string; paymentId: string }>()
    expect(new Set(results.map((row) => row.paymentId)).size).toBe(2)
    expect(results.every((row) => row.paymentId)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("settles everyone correctly with seed %i", async (seed) => {
    await expectEveryoneSettled(await runDoor(seed, 40))
  }, 60_000)
})

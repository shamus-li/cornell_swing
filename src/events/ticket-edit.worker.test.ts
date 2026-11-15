import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import { resetEventsDb } from '../../check-in/test/events-db'
import { setDoorTicket } from './ticket-edit'

vi.mock('../../check-in/worker/google', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../check-in/worker/google')>(),
  getGoogleAccessToken: vi.fn(async () => 'test-token'),
}))

const network = setupNetwork()
let sent: { amount: number; reference: string }[] = []
let refunds: { paymentId: string; amount: number }[] = []
const charges = async () => (await env.EVENTS_DB.prepare("SELECT ticketName, amount, status, paymentId FROM door_charges WHERE memberId = 'Ruby_0000001' ORDER BY createdAt").all()).results
const payment = (id: string) => env.EVENTS_DB.prepare('SELECT amount, synced FROM square_payments WHERE id = ?').bind(id).first()

beforeAll(() => {
  network.enable()
  network.use(
    // Ruby checked in to The Lindy Haunt at 7:12 PM on Oct 17, 2026.
    http.get('https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range', () => HttpResponse.json({ values: [[46312.8, 'Ruby Valoy', 'ruby@example.com', '(607) 555-0100', 'Community Member', 'Ruby_0000001', 'haunt']] })),
    http.post('https://connect.squareup.com/v2/payments', async ({ request }) => {
      const body = await request.json() as { amount_money: { amount: number }; reference_id: string }
      sent.push({ amount: body.amount_money.amount, reference: body.reference_id })
      return HttpResponse.json({ payment: { id: `square-${sent.length}` } })
    }),
    http.post('https://connect.squareup.com/v2/refunds', async ({ request }) => {
      const body = await request.json() as { payment_id: string; amount_money: { amount: number } }
      refunds.push({ paymentId: body.payment_id, amount: body.amount_money.amount })
      return HttpResponse.json({ refund: { id: `refund-${refunds.length}`, status: 'COMPLETED' } })
    }),
  )
})
afterAll(() => network.disable())
beforeEach(async () => {
  sent = []; refunds = []
  await resetEventsDb()
  await env.EVENTS_DB.prepare("INSERT INTO square_connection (id, merchantId, name, accessToken, refreshToken, expiresAt, syncedAt) VALUES (1, 'club', 'Swing Syndicate', 'square-token', 'refresh', '2099-01-01T00:00:00Z', '2026-10-17T12:00:00Z')").run()
  await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, tickets, updatedAt) VALUES ('haunt', 'special', 'The Lindy Haunt', '2026-10-17', '18:15', '22:00', ?, '')")
    .bind(JSON.stringify([{ id: 'student', name: 'Student', price: '10', days: 1 }, { id: 'general', name: 'General', price: '15', days: 1 }])).run()
})

describe('changing a ticket from the manager', () => {
  it('adds a ticket for someone the door missed, and records their cash in Square', async () => {
    await setDoorTicket(env, 'haunt', 'Ruby_0000001', 'general', 500)
    expect(await charges()).toEqual([{ ticketName: 'General', amount: 500, status: 'cash', paymentId: 'square-1' }])
    expect(sent).toMatchObject([{ amount: 500 }])
    expect(await env.EVENTS_DB.prepare('SELECT date FROM door_ticket_days').all().then(({ results }) => results)).toEqual([{ date: '2026-10-17' }])
  })

  it('refunds the cash Square already has before recording the corrected amount', async () => {
    await setDoorTicket(env, 'haunt', 'Ruby_0000001', 'general', 500)
    await setDoorTicket(env, 'haunt', 'Ruby_0000001', 'general', 1500)
    expect(refunds).toEqual([{ paymentId: 'square-1', amount: 500 }])
    expect(await payment('square-1')).toEqual({ amount: 0, synced: 0 })
    expect(await charges()).toEqual([
      { ticketName: 'General', amount: 500, status: 'canceled', paymentId: 'square-1' },
      { ticketName: 'General', amount: 1500, status: 'cash', paymentId: 'square-2' },
    ])
  })

  it('changes cash that hasn’t reached Square without a refund', async () => {
    await env.EVENTS_DB.prepare('DELETE FROM square_connection').run()
    await setDoorTicket(env, 'haunt', 'Ruby_0000001', 'general', 500)
    await setDoorTicket(env, 'haunt', 'Ruby_0000001', 'volunteer', 0)
    expect(refunds).toEqual([])
    expect(await env.EVENTS_DB.prepare('SELECT COUNT(*) AS count FROM square_payments').first('count')).toBe(0)
    expect((await charges()).map(charge => charge.status)).toEqual(['canceled', 'waived'])
  })

  it('leaves a card sale to Square', async () => {
    await env.EVENTS_DB.prepare("INSERT INTO door_charges (id, eventId, sessionDate, email, memberId, attendee, ticketName, amount, days, status, paymentId, createdAt, settledAt) VALUES ('card', 'haunt', '2026-10-17', 'ruby@example.com', 'Ruby_0000001', '{}', 'General', 1500, 1, 'card', 'square-card', '2026-10-17T23:00:00Z', '2026-10-17T23:00:00Z')").run()
    await expect(setDoorTicket(env, 'haunt', 'Ruby_0000001', 'general', 500)).rejects.toThrow('Square')
    expect(refunds).toEqual([])
    expect((await charges()).map(charge => charge.status)).toEqual(['card'])
  })
})

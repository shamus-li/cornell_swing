import { useEffect, useRef, useState } from "react"

import { Button } from "@shared/components/ui/button"
import { isConnectionError, REQUEST_TIMEOUT_MS, type Attendee, type DoorTicket, type NextSteps } from "@/lib/checkin"
import { largeButtonClass } from "@shared/lib/sizes"
import { TimedButton } from "@/TimedButton"

export const formatAmount = (cents: number) => cents ? `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}` : "Free"
const POLL_MS = 2000

type SettleMethod = "cash" | "free" | "waived"

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`/check-in/api/door/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

const failure = (error: unknown) =>
  isConnectionError(error) ? "Couldn't reach the server. Check the Wi-Fi connection and try again." : "That didn't go through. Please try again."

// Shown when an event has tickets to buy. The check-in is recorded once the ticket is paid for.
export function Payment({ attendee, event, tickets, onPaid, onLeave }: { attendee: Attendee; event: string; tickets: DoorTicket[]; onPaid: (next: NextSteps | null) => void; onLeave: () => void }) {
  // With one ticket type there is nothing to pick.
  const [ticket, setTicket] = useState<DoorTicket | null>(tickets.length === 1 ? tickets[0] : null)
  const [method, setMethod] = useState<"card" | "cash" | null>(null)
  const [chargeId, setChargeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  // Sent with cash, free and volunteer check-ins, so retrying after a lost response can't record them twice.
  const settleId = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!chargeId) return
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/check-in/api/door/charges/${chargeId}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        const payload = (await response.json()) as { status?: string; next?: NextSteps }
        if (payload.status === "paid") onPaid(payload.next ?? null)
        // The volunteer canceled them on the phone.
        if (payload.status === "canceled") onLeave()
      } catch (error) {
        console.error(error)
      }
    }, POLL_MS)
    return () => window.clearInterval(interval)
  }, [chargeId, onPaid, onLeave])

  async function payOnPhone(chosen: DoorTicket) {
    setBusy(true)
    setMessage("")
    try {
      const response = await post("charges", { ...attendee, ticketId: chosen.id })
      if (response.status === 409) return onPaid(((await response.json()) as { next?: NextSteps }).next ?? null)
      if (!response.ok) throw new Error(`Charge failed with ${response.status}`)
      setChargeId(((await response.json()) as { id: string }).id)
      setMethod("card")
    } catch (error) {
      console.error(error)
      setMessage(failure(error))
    }
    setBusy(false)
  }

  // Takes them off the iPhone's list so they can pay another way.
  async function backFromCard() {
    const id = chargeId
    setChargeId(null)
    setMethod(null)
    if (id) await fetch(`/check-in/api/door/charges/${id}`, { method: "DELETE" }).catch(console.error)
  }

  async function settle(settleMethod: SettleMethod, ticketId?: string) {
    setBusy(true)
    setMessage("")
    try {
      const response = await post("settle", { ...attendee, id: settleId.current, method: settleMethod, ticketId })
      if (!response.ok && response.status !== 409) throw new Error(`Settle failed with ${response.status}`)
      return onPaid(((await response.json()) as { next?: NextSteps }).next ?? null)
    } catch (error) {
      console.error(error)
      setMessage(failure(error))
    }
    setBusy(false)
  }

  function choose(chosen: DoorTicket) {
    settleId.current = crypto.randomUUID()
    if (chosen.amount) setTicket(chosen)
    else void settle("free", chosen.id)
  }

  const main = "mx-auto flex min-h-svh w-full max-w-[620px] flex-col justify-center gap-6 px-5 py-12"
  const heading = "text-[length:var(--title-font-size)] leading-tight font-semibold"
  const alert = message && <p className="text-destructive text-base" role="alert">{message}</p>
  const volunteer = <Button variant="ghost" className={largeButtonClass} disabled={busy} onClick={() => void settle("waived")}>I'm volunteering</Button>

  if (!ticket) {
    return (
      <main className={main}>
        <div><p className="text-base text-muted-foreground">{event}</p><h1 className={heading}>Choose your ticket</h1></div>
        <div className="flex flex-col gap-3">
          {tickets.map((option) => (
            <button key={option.id} type="button" disabled={busy} className="flex min-h-16 items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3 text-left text-lg transition-colors hover:bg-muted disabled:opacity-50" onClick={() => choose(option)}>
              <span className="min-w-0"><span className="block font-medium">{option.name}</span>{option.days > 1 && <span className="block text-sm text-muted-foreground">{option.days} days</span>}</span>
              <span className="font-semibold tabular-nums">{formatAmount(option.amount)}</span>
            </button>
          ))}
          {volunteer}
        </div>
        {alert}
      </main>
    )
  }

  const price = formatAmount(ticket.amount)

  if (method === "card") {
    return (
      <main className={main}>
        <div>
          <h1 className={heading}>Almost there, {attendee.name.split(/\s+/)[0]}!</h1>
          <p className="mt-2 text-lg text-muted-foreground">Find your name on the phone to pay {price}.</p>
        </div>
        <div className="flex flex-col gap-3">
          <Button variant="outline" className={largeButtonClass} onClick={() => void backFromCard()}>Pay another way</Button>
          <TimedButton onClick={onLeave}>Check in another person</TimedButton>
        </div>
      </main>
    )
  }

  if (method === "cash") {
    return (
      <main className={main}>
        <h1 className={heading}>Please give {price} to the volunteer at the door</h1>
        <div className="flex flex-col gap-3">
          <Button className={largeButtonClass} disabled={busy} onClick={() => void settle("cash", ticket.id)}>I've paid</Button>
          <Button variant="outline" className={largeButtonClass} disabled={busy} onClick={() => setMethod(null)}>Back</Button>
        </div>
        {alert}
      </main>
    )
  }

  return (
    <main className={main}>
      <div><p className="text-base text-muted-foreground">{event}{tickets.length > 1 && ` · ${ticket.name}`}</p><h1 className={heading}>Pay {price}</h1></div>
      <div className="flex flex-col gap-3">
        <Button className={largeButtonClass} disabled={busy} onClick={() => void payOnPhone(ticket)}>Card or phone</Button>
        <Button variant="outline" className={largeButtonClass} disabled={busy} onClick={() => setMethod("cash")}>Cash</Button>
        {tickets.length > 1
          ? <Button variant="ghost" className={largeButtonClass} disabled={busy} onClick={() => { settleId.current = crypto.randomUUID(); setTicket(null) }}>Choose a different ticket</Button>
          : volunteer}
      </div>
      {alert}
    </main>
  )
}

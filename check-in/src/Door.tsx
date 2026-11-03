import { useEffect, useRef, useState } from "react"

import { formatAmount } from "@/Payment"

const POLL_MS = 2000
// How long a tab returning from Square waits to hear from the open list before becoming the list itself.
const ANSWER_MS = 400

type QueuedCharge = { id: string; label: string; ticketName: string; amount: number; createdAt: string; verifying: boolean }
type Queue = { applicationId: string; charges: QueuedCharge[]; justPaid: string[] }

const channel = new BroadcastChannel("door-queue")

const squareUrl = (applicationId: string, charge: QueuedCharge) =>
  `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify({
    amount_money: { amount: charge.amount, currency_code: "USD" },
    callback_url: `${window.location.origin}/check-in/door/`,
    client_id: applicationId,
    version: "1.3",
    notes: `door:${charge.id} ${charge.label} ${charge.ticketName}`,
    state: charge.id,
    options: { supported_tender_types: ["CREDIT_CARD"], auto_return: true, skip_receipt: true },
  }))}`

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })

// Locks the name until Square answers. keepalive lets it finish as Safari switches to Square.
const tap = (id: string) => void fetch(`/check-in/api/door/charges/${id}/tap`, { method: "POST", keepalive: true }).catch(console.error)


// The list on the door iPhone of people who checked in on the laptop and owe a card payment.
export default function Door() {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [closing, setClosing] = useState(() => new URLSearchParams(window.location.search).has("data"))
  const [error, setError] = useState(false)
  const returning = useRef(new URLSearchParams(window.location.search).get("data"))

  // Square returns by opening a new Safari tab. That tab reports back, tells the open list to update and
  // closes itself right away, so one tab stays open however many people pay. Confirming a payment can take
  // a few seconds, so only a cancellation, which unlocks the name, is waited for.
  useEffect(() => {
    const listen = ({ data }: MessageEvent) => {
      if (data !== "returned") return
      channel.postMessage("here")
      void refresh()
    }
    const data = returning.current
    if (!data) {
      channel.onmessage = listen
      void refresh()
      return
    }
    returning.current = null
    void (async () => {
      const { state, status } = JSON.parse(data) as { state?: string; status?: string }
      if (state) {
        const report = fetch(`/check-in/api/door/charges/${state}/return`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: status === "ok" }) }).catch(console.error)
        if (status !== "ok") await report
      }
      channel.onmessage = ({ data: message }) => { if (message === "here") window.close() }
      channel.postMessage("returned")
      window.setTimeout(() => {
        // The list is gone, so this tab becomes it.
        window.history.replaceState(null, "", "/check-in/door/")
        channel.onmessage = listen
        void refresh()
        setClosing(false)
      }, ANSWER_MS)
    })()
  }, [])

  async function refresh() {
    try {
      const response = await fetch("/check-in/api/door/queue", { headers: { Accept: "application/json" } })
      if (!response.ok) throw new Error(`Queue failed with ${response.status}`)
      setQueue((await response.json()) as Queue)
      setError(false)
    } catch (failure) {
      console.error(failure)
      setError(true)
    }
  }

  // Safari pauses a page while Square's app is open, so it also updates as soon as it's back on screen.
  useEffect(() => {
    if (closing) return
    const interval = window.setInterval(() => void refresh(), POLL_MS)
    const wake = () => { if (document.visibilityState === "visible") void refresh() }
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("pageshow", wake)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("pageshow", wake)
    }
  }, [closing])

  if (closing) return <main className="flex min-h-svh items-center justify-center p-5 text-lg" role="status">Returning to the list…</main>

  return (
    <main className="mx-auto min-h-svh w-full max-w-[620px] px-5 py-5">
      {queue?.justPaid.map((name) => <p key={name} className="mb-4 rounded-lg bg-muted px-3 py-3 text-lg font-semibold" role="status">Checked in, {name}!</p>)}
      <h1 className="mb-4 text-[length:var(--title-font-size)] leading-tight font-semibold">Ready to pay</h1>
      {error && <p className="mb-4 text-base text-destructive" role="alert">Can't reach the site. Check the connection.</p>}
      {queue?.charges.length === 0 && <p className="py-8 text-center text-base text-muted-foreground">Nobody is waiting.</p>}
      <ul className="space-y-2">
        {queue?.charges.map((charge) => (
          <li key={charge.id}>
            {charge.verifying
              ? <div className="flex min-h-16 items-center justify-between gap-3 rounded-lg border px-4 text-lg">
                  <span className="min-w-0 truncate font-medium">{charge.label}</span>
                  <span className="text-sm whitespace-nowrap text-muted-foreground" role="status">Confirming…</span>
                </div>
              : <a className="flex min-h-16 items-center justify-between gap-3 rounded-lg border px-4 text-lg no-underline transition-colors hover:bg-muted" href={squareUrl(queue.applicationId, charge)} onClick={() => tap(charge.id)}>
                  <span className="min-w-0"><span className="block truncate font-medium">{charge.label}</span>{queue.charges.some((other) => other !== charge && other.label === charge.label) && <span className="block text-sm text-muted-foreground">Checked in at {time(charge.createdAt)}</span>}</span>
                  <span className="font-semibold tabular-nums">{formatAmount(charge.amount)}</span>
                </a>}
          </li>
        ))}
      </ul>
    </main>
  )
}

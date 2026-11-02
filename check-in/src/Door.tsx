import { useEffect, useRef, useState } from "react"

import { formatAmount } from "@/Payment"

const POLL_MS = 3000
const RESULT_MS = 6000
// How long a tab returning from Square waits to hear from the open queue tab.
const PONG_MS = 500
const CLOSE_AFTER_MS = 800

type QueuedCharge = { id: string; label: string; ticketName: string; amount: number; verifying: boolean }
type Queue = { applicationId: string; charges: QueuedCharge[] }
type Result = { paid: boolean; name: string | null }

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

// Locks the name until Square answers. keepalive lets it finish as Safari switches to Square.
const tap = (id: string) => void fetch(`/check-in/api/door/charges/${id}/tap`, { method: "POST", keepalive: true }).catch(console.error)


// Square returns by opening a new Safari tab. That tab reports the payment, hands the result to the
// queue tab and closes itself, so one tab stays open however many people pay.
async function handleReturn(data: string): Promise<Result | null> {
  const { state, status } = JSON.parse(data) as { state?: string; status?: string }
  if (!state) return null
  const response = await fetch(`/check-in/api/door/charges/${state}/return`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: status === "ok" }),
  })
  const { status: charge, name } = (await response.json()) as { status: string; name: string | null }
  return { paid: charge === "paid", name: status === "ok" ? name : null }
}

// The list on the door iPhone of people who checked in on the laptop and owe a card payment.
export default function Door() {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [closing, setClosing] = useState(() => new URLSearchParams(window.location.search).has("data"))
  const [error, setError] = useState(false)
  const returning = useRef(new URLSearchParams(window.location.search).get("data"))

  useEffect(() => {
    const data = returning.current
    if (data) {
      returning.current = null
      void (async () => {
        const returned = await handleReturn(data).catch((failure: unknown) => { console.error(failure); return null })
        let answered = false
        channel.onmessage = ({ data: message }) => { if (message === "here") answered = true }
        channel.postMessage({ result: returned })
        window.setTimeout(() => {
          if (answered) {
            setClosing(true)
            window.setTimeout(() => window.close(), CLOSE_AFTER_MS)
            return
          }
          // The queue tab is gone, so this one becomes it.
          window.history.replaceState(null, "", "/check-in/door/")
          channel.onmessage = listen
          setResult(returned)
          void refresh()
          setClosing(false)
        }, PONG_MS)
      })()
      return
    }
    channel.onmessage = listen
    void refresh()
  }, [])

  const listen = ({ data }: MessageEvent<{ result: Result | null }>) => {
    if (!data?.result && data?.result !== null) return
    channel.postMessage("here")
    setResult(data.result)
    void refresh()
  }

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

  useEffect(() => {
    if (closing) return
    const interval = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(interval)
  }, [closing])

  useEffect(() => {
    if (!result) return
    const timeout = window.setTimeout(() => setResult(null), RESULT_MS)
    return () => window.clearTimeout(timeout)
  }, [result])

  if (closing) return <main className="flex min-h-svh items-center justify-center p-5 text-lg" role="status">Returning to the list…</main>

  return (
    <main className="mx-auto min-h-svh w-full max-w-[540px] px-4 py-5">
      {result?.paid && <p className="mb-4 rounded-lg bg-muted px-3 py-3 text-lg font-semibold" role="status">{result.name ? `Checked in, ${result.name}!` : "Checked in!"}</p>}
      <h1 className="mb-4 text-xl font-semibold">Ready to pay</h1>
      {error && <p className="mb-4 text-base text-destructive" role="alert">Can't reach the site. Check the connection.</p>}
      {queue?.charges.length === 0 && <p className="py-8 text-center text-base text-muted-foreground">Nobody is waiting.</p>}
      <ul className="space-y-2">
        {queue?.charges.map((charge) => (
          <li key={charge.id}>
            {charge.verifying
              ? <div className="flex min-h-16 items-center justify-between gap-3 rounded-lg border px-4 text-lg">
                  <span className="min-w-0 truncate font-medium">{charge.label}</span>
                  <span className="text-sm whitespace-nowrap text-muted-foreground" role="status">Confirming… <a className="text-primary" href={squareUrl(queue.applicationId, charge)} onClick={() => tap(charge.id)}>Charge again</a></span>
                </div>
              : <a className="flex min-h-16 items-center justify-between gap-3 rounded-lg border px-4 text-lg no-underline" href={squareUrl(queue.applicationId, charge)} onClick={() => tap(charge.id)}>
                  <span className="min-w-0 truncate font-medium">{charge.label}</span>
                  <span className="font-semibold">{formatAmount(charge.amount)}</span>
                </a>}
          </li>
        ))}
      </ul>
    </main>
  )
}

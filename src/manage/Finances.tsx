import { useEffect, useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import type { SquareFeed } from "../events/finance"
import { api, errorMessage } from "./api"

const when = (paidAt: string) => new Date(paidAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

// Club money taken in Square. Once an officer connects the club's Square account, the site files its
// payments on the Balance Sheet by itself; this tab shows the connection and recent payments.
export function Finances() {
  const [data, setData] = useState<SquareFeed | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void api<SquareFeed>("/square", { signal: controller.signal }, "Square payments could not be loaded.").then(setData).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [])

  async function disconnect() {
    setError("")
    try {
      await api("/square", { method: "DELETE" })
      setData(current => current && { ...current, square: null })
    } catch (err) { setError(errorMessage(err)) }
  }

  if (error) return <p role="alert" className="event-error manage-notice">{error}</p>
  if (!data) return <p role="status" className="event-muted manage-notice">Loading Square payments…</p>
  if (!data.square) return <section className="manage-group" aria-labelledby="square-connect-title">
    <h2 id="square-connect-title">Square</h2>
    <p>Connect the club's Square account. Payments taken during an event go to the Balance Sheet as that event's Square and cash profits, after Square's fees.</p>
    <Button asChild><a href="/manage/square/connect">Connect Square</a></Button>
  </section>
  return <>
    <p className="event-muted">Connected to {data.square}. <Button variant="link" size="sm" onClick={() => { void disconnect() }}>Disconnect</Button></p>
    <section className="manage-group" aria-labelledby="square-payments-title">
      <h2 id="square-payments-title">Square payments</h2>
      {data.payments.length ? <ul className="guest-list">{data.payments.map(payment => <li key={payment.id} className="guest-row">
        <span><strong>{payment.event ?? "No event"}</strong><span className="event-muted"> · {[payment.cash ? "Cash" : "Card", payment.note].filter(Boolean).join(" · ")}</span></span>
        <time className="event-muted">{when(payment.paidAt)}</time>
        <span className="guest-count">${(payment.amount / 100).toFixed(2)}</span>
      </li>)}</ul> : <p className="event-muted">No payments yet.</p>}
    </section>
  </>
}

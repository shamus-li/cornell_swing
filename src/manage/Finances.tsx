import { useEffect, useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import type { SquareFeed } from "../events/finance"
import { api, errorMessage } from "./api"

const when = (paidAt: string) => new Date(paidAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

// Club money taken in Square. Once an officer connects the club's Square account, the site files its
// payments on the Balance Sheet by itself; this shows the connection and recent payments.
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
  const doorPage = <a href="/check-in/door/" target="_blank" rel="noreferrer">Open the door payment page</a>
  if (!data.square) return <section className="finance finance-square" aria-labelledby="square-connect-title">
    <div className="finance-heading"><h2 id="square-connect-title">Square payments</h2>{doorPage}</div>
    <p>Connect the club's Square account. Payments taken during an event go to the Balance Sheet as that event's Square and cash profits, after Square's fees.</p>
    <div><Button asChild><a href="/manage/square/connect">Connect Square</a></Button></div>
  </section>
  return <section className="finance" aria-labelledby="square-payments-title">
    <div>
      <div className="finance-heading"><h2 id="square-payments-title">Square payments</h2>{doorPage}</div>
      {data.payments.length ? <div className="finance-card"><table className="finance-table" aria-labelledby="square-payments-title">
        <thead><tr><th scope="col">Paid</th><th scope="col">Event</th><th scope="col">Type</th><th scope="col" className="number">Amount</th></tr></thead>
        <tbody>{data.payments.map(payment => <tr key={payment.id}>
          <td>{when(payment.paidAt)}</td>
          <th scope="row">{payment.event ?? "No event"}{payment.note && <small>{payment.note}</small>}</th>
          <td>{payment.cash ? "Cash" : "Card"}</td>
          <td className="number">${(payment.amount / 100).toFixed(2)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="event-muted">No payments yet.</p>}
      <p className="event-muted">Connected to {data.square}. <Button variant="link" size="sm" onClick={() => { void disconnect() }}>Disconnect</Button></p>
    </div>
  </section>
}

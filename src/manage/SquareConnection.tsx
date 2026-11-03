import { useEffect, useState } from "react"
import { Button } from "../components/ui/button"
import type { SquareFeed } from "../events/finance"
import { api, errorMessage } from "./api"
import { ConfirmButton } from "./ConfirmButton"

// The club's Square account, which the site reads payments from.
export function SquareConnection() {
  const [data, setData] = useState<SquareFeed | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void api<SquareFeed>("/square", { signal: controller.signal }, "Square could not be loaded.").then(setData).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [])

  async function disconnect() {
    setError("")
    try {
      await api("/square", { method: "DELETE" })
      setData({ square: null })
    } catch (err) { setError(errorMessage(err)) }
  }

  return <section className="sheet-connection" aria-labelledby="square-title">
    <h2 id="square-title">Square</h2>
    {error && <p role="alert" className="event-error">{error}</p>}
    {!data && !error && <p role="status" className="event-muted">Loading Square…</p>}
    {data && <>
      <p className="event-note">{data.square ? `Connected to ${data.square}` : "Not connected"}</p>
      <div className="finance-actions">{data.square
        ? <ConfirmButton confirmLabel="Confirm disconnect" busyLabel="Disconnecting…" onConfirm={disconnect}>Disconnect</ConfirmButton>
        : <Button asChild><a href="/manage/square/connect">Connect Square</a></Button>}</div>
    </>}
  </section>
}

import { useEffect, useState, type FormEvent } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { api, errorMessage } from "./api"
import { ConfirmButton } from "./ConfirmButton"
import { Input } from "../../check-in/src/components/ui/input"

type SheetStatus = {
  connection: { url: string; error: string | null } | null
  serviceAccountEmail: string | null
}

export function SheetConnection({ onSync }: { onSync?: () => Promise<void> }) {
  const [status, setStatus] = useState<SheetStatus | null>(null)
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const path = "/rsvp-sheet"

  useEffect(() => {
    const controller = new AbortController()
    setStatus(null); setError("")
    void api<SheetStatus>(path, { signal: controller.signal }, "The sheet connection could not be loaded.").then(setStatus).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [path])

  async function update(method: "PUT" | "DELETE" | "POST") {
    setBusy(true); setError("")
    try {
      setStatus(await api<SheetStatus>(`${path}${method === "POST" ? "/sync" : ""}`, {
        method,
        ...(method === "PUT" ? { body: JSON.stringify({ url: url.trim() }) } : {}),
      }, "The sheet connection could not be updated. Please try again."))
      if (method === "DELETE") setUrl("")
      if (method === "POST") await onSync?.()
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  function link(e: FormEvent) { e.preventDefault(); void update("PUT") }
  const connection = status?.connection
  return <section className="sheet-connection" aria-labelledby="rsvp-sheet-title">
    <h2 id="rsvp-sheet-title">RSVP Google Sheet</h2>
    {error && <p role="alert" className="event-error">{error}</p>}
    {!status && !error && <p role="status" className="event-muted">Loading sheet connection…</p>}
    {status && (connection ? <>
      <div className="sheet-connection-actions"><Button asChild variant="outline"><a href={connection.url} target="_blank" rel="noreferrer">Open sheet ↗</a></Button><Button type="button" variant="outline" disabled={busy} onClick={() => void update("POST")}>{busy ? "Syncing…" : "Sync now"}</Button><ConfirmButton confirmLabel="Confirm" busyLabel="Disconnecting…" disabled={busy} onConfirm={() => update("DELETE")}>Disconnect</ConfirmButton></div>

      {connection.error && <p role="alert" className="event-error">{connection.error}</p>}
    </> : status.serviceAccountEmail ? <form className="sheet-connection-form" onSubmit={link}>
      <p className="event-note">Share your Google Sheet with <strong>{status.serviceAccountEmail}</strong> as an Editor, then paste its link below. Use a tab with Event, Name, and Email columns.</p>
      <label>Google Sheet URL<Input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" disabled={busy} /></label>
      <Button type="submit" variant="outline" disabled={busy}>{busy ? "Linking…" : "Link sheet"}</Button>
    </form> : <p className="event-note">Google Sheets syncing has not been configured yet.</p>)}
  </section>
}

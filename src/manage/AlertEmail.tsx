import { useEffect, useState, type FormEvent } from "react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { api, errorMessage } from "./api"

type Status = { email: string; verified: boolean }

export function AlertEmail() {
  const [status, setStatus] = useState<Status | null>(null)
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void api<Status>("/alert-email", { signal: controller.signal }, "The alert email could not be loaded.").then(loaded => { setStatus(loaded); setEmail(loaded.email) }).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      const saved = await api<Status>("/alert-email", { method: "PUT", body: JSON.stringify({ email }) }, "The alert email could not be saved. Please try again.")
      setStatus(saved); setEmail(saved.email)
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }

  return <section className="sheet-connection" aria-labelledby="alert-email-title">
    <h2 id="alert-email-title">Alert email</h2>
    {error && <p role="alert" className="event-error">{error}</p>}
    {!status && !error && <p role="status" className="event-muted">Loading alert email…</p>}
    {status && <form className="sheet-connection-form" onSubmit={save}>
      <label><Input type="email" required aria-labelledby="alert-email-title" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
      <Button type="submit" variant="outline" disabled={busy || email.trim().toLowerCase() === status.email}>{busy ? "Saving…" : "Save"}</Button>
      <p className="event-note">{status.verified ? `${status.email} is verified.` : `${status.email} is pending. Click the link in the confirmation email from Cloudflare.`}</p>
    </form>}
  </section>
}

import { useEffect, useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../check-in/src/components/ui/select"
import { ConfirmButton } from "../manage/ConfirmButton"
import { SiteBrand } from "../site/components/SiteBrand"
import { canonicalSource, parseRedirect, parseRedirects, type Redirect } from "./redirect"

type Draft = { source: string; destination: string; code: string }
// `original` is the source being edited, or null for a new redirect.
type Editing = { original: string | null; draft: Draft }

const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again."

async function request(init?: RequestInit): Promise<unknown> {
  const response = await fetch("/redirects/api", { ...init, headers: { "Content-Type": "application/json" } })
  if (response.redirected || response.headers.get("content-type")?.includes("text/html")) throw new Error("Your session has expired. Reload this page to sign in again.")
  const data = await response.json() as { error?: string }
  if (!response.ok) throw new Error(data.error || "Changes could not be saved. Please try again.")
  return data
}

export default function Redirects() {
  const [redirects, setRedirects] = useState<Redirect[] | null>(null)
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)

  useEffect(() => { void request().then(body => setRedirects(parseRedirects(body))).catch(err => setLoadError(message(err))) }, [])

  // Sends one change, then reloads so edits made elsewhere also show up.
  async function mutate(method: "POST" | "PUT" | "DELETE", body: unknown) {
    setSaving(true); setError("")
    try {
      await request({ method, body: JSON.stringify(body) })
      setRedirects(parseRedirects(await request()))
      return true
    } catch (err) { setError(message(err)); return false }
    finally { setSaving(false) }
  }

  async function save() {
    if (!editing || !redirects) return
    const { original, draft } = editing
    let redirect: Redirect
    try { redirect = parseRedirect({ source: canonicalSource(draft.source), destination: draft.destination, code: Number(draft.code) }) }
    catch (err) { setError(message(err)); return }
    if (redirect.source !== original && redirects.some(rule => rule.source === redirect.source)) { setError(`A redirect for ${redirect.source} already exists`); return }
    if (await mutate(original === null ? "POST" : "PUT", original === null ? redirect : { source: original, redirect })) setEditing(null)
  }

  const editRow = editing && <EditRow key={editing.original ?? "new"} draft={editing.draft} saving={saving} onChange={draft => setEditing({ ...editing, draft })} onSave={() => void save()} onCancel={() => { setEditing(null); setError("") }} />

  return <>
    <header className="site-header manage-header"><SiteBrand /></header>
    <main className="manage-main">
      <div className="manage-title">
        <h1>Redirects</h1>
        <Button disabled={!redirects || editing !== null || saving} onClick={() => setEditing({ original: null, draft: { source: "", destination: "", code: "302" } })}>New redirect</Button>
      </div>
      {error && <p role="alert" className="event-error manage-notice">{error}</p>}
      {loadError ? <p role="alert" className="event-error manage-notice">{loadError} <Button variant="link" size="sm" onClick={() => window.location.reload()}>Reload</Button></p>
        : redirects === null ? <p role="status" className="event-muted manage-notice">Loading redirects…</p>
        : <div className="manage-list">
          {editing?.original === null && editRow}
          {redirects.map(rule => editing?.original === rule.source ? editRow : <div key={rule.source} className="redirect-row">
            <div className="redirect-row-text">
              <strong>{rule.source}</strong>
              <a href={rule.destination} target="_blank" rel="noreferrer">{rule.destination}</a>
            </div>
            <div className="redirect-row-actions">
              <span className="status-badge" title={rule.code === 301 ? "Permanent" : "Temporary"}>{rule.code}</span>
              <Button size="sm" variant="ghost" aria-label={`Edit ${rule.source}`} disabled={saving || editing !== null} onClick={() => { setError(""); setEditing({ original: rule.source, draft: { source: rule.source, destination: rule.destination, code: String(rule.code) } }) }}>Edit</Button>
              <ConfirmButton size="sm" aria-label={`Remove ${rule.source}`} confirmLabel="Confirm" busyLabel="Removing…" disabled={saving || editing !== null} onConfirm={async () => { await mutate("DELETE", { source: rule.source }) }}>Remove</ConfirmButton>
            </div>
          </div>)}
          {!redirects.length && !editing && <p className="event-muted manage-notice">No redirects yet.</p>}
        </div>}
    </main>
  </>
}

function EditRow({ draft, saving, onChange, onSave, onCancel }: { draft: Draft; saving: boolean; onChange: (draft: Draft) => void; onSave: () => void; onCancel: () => void }) {
  return <form className="redirect-edit" onSubmit={event => { event.preventDefault(); onSave() }} onKeyDown={event => { if (event.key === "Escape") onCancel() }}>
    <div className="redirect-fields">
      <Input aria-label="Source" autoFocus disabled={saving} placeholder="/new-link" value={draft.source} onChange={event => onChange({ ...draft, source: event.target.value })} />
      <Input aria-label="Destination" disabled={saving} placeholder="https://example.com" value={draft.destination} onChange={event => onChange({ ...draft, destination: event.target.value })} />
      <Select disabled={saving} value={draft.code} onValueChange={code => onChange({ ...draft, code })}>
        <SelectTrigger aria-label="Code" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="302">302 Temporary</SelectItem>
          <SelectItem value="301">301 Permanent</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="normal-event-actions">
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
    </div>
  </form>
}

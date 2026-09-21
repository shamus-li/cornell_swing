import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { formatEventLocation, formatEventDate, todayInNewYork, type EventRecord, type ManagedEvent, type RSVP } from "../events/model"
import { Input } from "../../check-in/src/components/ui/input"
import { EventTimePicker } from "./EventTimePicker"
import { LocationPicker } from "./LocationPicker"
import { EventDatePicker } from "./EventDatePicker"
import { NormalEventRow, type NormalEventHandle } from "./NormalEventRow"
import { DiscardChangesButton } from "./DiscardChangesButton"
import { DeleteEventButton } from "./DeleteEventButton"
import { SheetConnection } from "./SheetConnection"
import { api } from "./api"
import { MarkdownEditor } from "./MarkdownEditor"
import { SiteBrand } from "../site/components/SiteBrand"

const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again."
const newEvent = (kind: EventRecord["kind"]): EventRecord => ({ id: "", kind, title: "", date: todayInNewYork(), startTime: kind === "normal" ? "20:00" : "", endTime: kind === "normal" ? "22:00" : "", location: "", description: "", updatedAt: "" })

export default function Manage({ initialEvents }: { initialEvents?: ManagedEvent[] }) {
  const [events, setEvents] = useState<ManagedEvent[]>(() => [...(initialEvents ?? [])].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.startTime.localeCompare(b.startTime)))
  const [loading, setLoading] = useState(initialEvents === undefined)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [editingId, setEditingId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("event"))
  const editing = editingId === "new" ? newEvent("special") : events.find(event => event.id === editingId) ?? null
  const [activeNormal, setActiveNormal] = useState<string | null>(null)
  const normalEditor = useRef<NormalEventHandle>(null)
  const switching = useRef(false)
  useEffect(() => {
    const navigate = () => setEditingId(new URLSearchParams(window.location.search).get("event"))
    window.addEventListener("popstate", navigate)
    return () => window.removeEventListener("popstate", navigate)
  }, [])
  function openSpecial(event: EventRecord) {
    const url = new URL(window.location.href)
    url.searchParams.set("event", event.id || "new")
    window.history.pushState({ eventEditor: true }, "", url)
    setEditingId(event.id || "new")
  }
  function closeSpecial() {
    if (window.history.state?.eventEditor) window.history.back()
    else {
      const url = new URL(window.location.href)
      url.searchParams.delete("event")
      window.history.replaceState(null, "", url)
    }
    setEditingId(null)
  }
  async function load() {
    const data = await api<{ events: ManagedEvent[] }>("/events")
    setEvents(data.events.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.startTime.localeCompare(b.startTime)))
  }
  useEffect(() => { if (initialEvents === undefined) void load().catch(err => setError(message(err))).finally(() => setLoading(false)) }, [])
  function acceptDeletedEvent(id: string) {
    setEvents(current => current.filter(event => event.id !== id))
    setActiveNormal(null)
    if (editingId) closeSpecial()
    setNotice("Event deleted."); setError("")
  }
  function removeRsvpCount(id: string) {
    setEvents(current => current.map(event => event.id === id ? { ...event, rsvpCount: Math.max(0, event.rsvpCount - 1) } : event))
  }
  async function openEvent(action: () => void) {
    if (switching.current) return
    switching.current = true
    try {
      if (normalEditor.current && !await normalEditor.current.save()) return
      setActiveNormal(null); setNotice(""); action()
    } finally { switching.current = false }
  }
  function acceptSavedEvent(event: EventRecord) {
    setEvents(current => [...current.filter(item => item.id !== event.id), { ...event, rsvpCount: current.find(item => item.id === event.id)?.rsvpCount ?? 0 }].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.startTime.localeCompare(b.startTime)))
    setNotice(""); setError("")
  }
  async function saveNormal(draft: EventRecord) {
    const { event } = await api<{ event: EventRecord }>(`/events${draft.id ? `/${draft.id}` : ""}`, { method: draft.id ? "PUT" : "POST", body: JSON.stringify(draft) })
    acceptSavedEvent(event)
  }
  return <>
    <header className="site-header manage-header"><SiteBrand /></header>
    <main className="manage-main">
      {editing ? <EventEditor key={editing.id || `new-${editing.kind}`} event={editing} onCancel={closeSpecial} onRsvpChange={() => removeRsvpCount(editing.id)} onSave={event => { acceptSavedEvent(event); closeSpecial() }} onDelete={() => acceptDeletedEvent(editing.id)} /> : <>
        <h1>Manage events</h1>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert" className="event-error">{error} <Button variant="ghost" size="default" className="event-text-button" onClick={() => window.location.reload()}>Reload</Button></p>}
        {loading ? <p role="status">Loading events…</p> : (["normal", "special"] as const).map(kind => <section className="manage-section" key={kind}>
          <div className="manage-section-heading"><div><h2>{kind === "normal" ? "Normal events" : "Special events"}</h2></div><Button variant="outline" size="default" onClick={() => { if (kind === "normal" && activeNormal === "") return; void openEvent(() => kind === "normal" ? setActiveNormal("") : openSpecial(newEvent(kind))) }}>Add event</Button></div>
          <div className="manage-list">{kind === "normal" && activeNormal === "" && <NormalEventRow ref={normalEditor} editing onEdit={() => {}} event={{ ...newEvent("normal"), title: "Monday swing" }} onSave={saveNormal} onCancel={() => setActiveNormal(null)} />}
          {events.filter(event => event.kind === kind).map(event => kind === "normal" ? <NormalEventRow key={`${event.id}-${event.updatedAt}-${activeNormal === event.id}`} ref={activeNormal === event.id ? normalEditor : undefined} editing={activeNormal === event.id} onEdit={() => { void openEvent(() => setActiveNormal(event.id)) }} event={event} onSave={saveNormal} onCancel={() => setActiveNormal(null)} onDelete={async () => { await api(`/events/${event.id}`, { method: "DELETE" }); acceptDeletedEvent(event.id) }} /> : <div className={`manage-row${event.date && event.date < todayInNewYork() ? " is-past" : ""}`} key={event.id}>
            <Button variant="ghost" className="event-title-button" aria-label={`Manage ${event.title} on ${event.date}`} onClick={() => { void openEvent(() => openSpecial(event)) }}><time dateTime={event.date}>{formatEventDate(event.date)}</time><span><strong>{event.title}</strong><span className="event-muted event-row-location">{formatEventLocation(event)}</span></span><span className="guest-count event-muted">{event.rsvpCount} RSVP{event.rsvpCount === 1 ? "" : "s"}</span></Button>
          </div>)}</div>
          {!events.some(event => event.kind === kind) && <p className="event-muted">No events yet.</p>}
        </section>)}
      </>}
      <div hidden={!!editing}><SheetConnection onSync={load} /></div>
    </main>
  </>
}

function EventEditor({ event, onSave, onDelete, onCancel, onRsvpChange }: { event: EventRecord; onRsvpChange: () => void; onSave: (event: EventRecord) => void; onDelete: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(event)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [editorError, setEditorError] = useState("")
  const dirty = (["title", "date", "startTime", "endTime", "location", "locationUrl", "room", "description"] as const).some(key => draft[key] !== event[key])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const change = (key: keyof EventRecord, value: string) => setDraft(current => ({ ...current, [key]: value }))
  async function save(e: FormEvent) {
    e.preventDefault(); if (editorError) return; setBusy(true); setError("")
    try { const { event: saved } = await api<{ event: EventRecord }>(`/events${event.id ? `/${event.id}` : ""}`, { method: event.id ? "PUT" : "POST", body: JSON.stringify({ ...draft, title: draft.kind === "normal" ? "Monday swing" : draft.title }) }); onSave(saved) }
    catch (err) { setError(message(err)); setBusy(false) }
  }
  async function remove() {
    await api(`/events/${event.id}`, { method: "DELETE" })
    await onDelete()
  }
  return <div className="event-editor-shell">
    <DiscardChangesButton variant="ghost" size="default" className="back-button -ml-2.5" dirty={dirty} onDiscard={onCancel} disabled={busy}>← All events</DiscardChangesButton>
    <form className="event-form event-editor" aria-label={event.id ? "Edit event" : "New event"} onSubmit={save}>
      <Input className="event-name-input h-auto" aria-label="Event name" required maxLength={160} value={draft.title} onChange={e => change("title", e.target.value)} placeholder="Event name" />
      <div className="editor-time-card">
        <div className="editor-time-fields">
          <div className="event-field"><span>Date</span><EventDatePicker allowTba value={draft.date} onChange={value => change("date", value)} /></div>
          <label>Start<EventTimePicker label="Start time" value={draft.startTime} onChange={value => change("startTime", value)} /></label>
          <label>End<EventTimePicker label="End time" value={draft.endTime} onChange={value => change("endTime", value)} /></label>
        </div>
      </div>
      <LocationPicker value={draft.location} url={draft.locationUrl} room={draft.room} onRoomChange={room => change("room", room)} onChange={(location, locationUrl) => setDraft(current => ({ ...current, location, locationUrl }))} disabled={busy} />
      <MarkdownEditor markdown={event.description} label="Description" onChange={value => change("description", value)} onError={setEditorError} />
      {editorError && <p role="alert" className="event-error">{editorError}</p>}
      {error && <p role="alert" className="event-error">{error}</p>}
      <div className="editor-actions"><Button size="lg" className="editor-save" disabled={busy || !!editorError}>{busy ? "Saving…" : "Save event"}</Button></div>
    </form>
    {event.id && <><GuestList event={event} onChange={onRsvpChange} /><div className="manage-section"><DeleteEventButton onDelete={remove} disabled={busy} onBusyChange={setBusy} includesRsvps /></div></>}
  </div>
}

function GuestList({ event, onChange }: { event: EventRecord; onChange: () => void }) {
  const [rsvps, setRsvps] = useState<RSVP[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { void api<{ rsvps: RSVP[] }>(`/events/${event.id}/rsvps`).then(data => setRsvps(data.rsvps)).catch(err => setError(message(err))) }, [event.id])
  return <section className="manage-section" aria-labelledby="guest-list-title"><div className="manage-section-heading"><h2 id="guest-list-title">RSVPs</h2>{rsvps && <span className="event-muted">{rsvps.length} guest{rsvps.length === 1 ? "" : "s"}</span>}</div>
    {error && <p role="alert" className="event-error">{error}</p>}
    {rsvps === null && !error ? <p role="status">Loading RSVPs…</p> : rsvps && <><div className="guest-list">{rsvps.map(rsvp => <div className="guest-row" key={rsvp.email}><strong>{rsvp.name}</strong><span>{rsvp.email}</span><DeleteEventButton kind="rsvp" onDelete={async () => { await api(`/events/${event.id}/rsvps`, { method: "DELETE", body: JSON.stringify({ email: rsvp.email }) }); setRsvps(current => current!.filter(guest => guest.email !== rsvp.email)); onChange() }} /></div>)}</div>{!rsvps.length && <p>No RSVPs yet.</p>}</>}
  </section>
}

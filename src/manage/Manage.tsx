import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { CalendarIcon, Check, Copy, MapPinIcon, TicketIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { isValidPrice, todayInNewYork, type EventRecord, type ManagedEvent, type RSVP } from "../events/model"
import { EventTimePicker } from "./EventTimePicker"
import { LocationPicker } from "./LocationPicker"
import { EventDatePicker } from "./EventDatePicker"
import { NormalEventRow, type NormalEventHandle } from "./NormalEventRow"
import { DiscardChangesButton, DiscardChangesDialog } from "./DiscardChangesButton"
import { DeleteEventButton } from "./DeleteEventButton"
import { ConfirmButton } from "./ConfirmButton"
import { SheetConnection } from "./SheetConnection"
import { CampusGroupsUpload } from "./CampusGroupsUpload"
import { api, ApiError, errorMessage } from "./api"
import { MarkdownEditor } from "./MarkdownEditor"
import { SiteBrand } from "../site/components/SiteBrand"
import { DraftBadge, eventSummary } from "./EventDate"
import { DateTile } from "../events/DateTile"
import { Tabs } from "./Tabs"
import { Person } from "../../check-in/src/components/ui/person"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../check-in/src/components/ui/input-group"

type View = "special" | "lessons" | "settings"
const views: { value: View; label: string }[] = [{ value: "special", label: "Special events" }, { value: "lessons", label: "Lessons" }, { value: "settings", label: "Settings" }]
const byDate = (a: EventRecord, b: EventRecord) => (a.date || "9999").localeCompare(b.date || "9999") || a.startTime.localeCompare(b.startTime)
const newEvent = (kind: EventRecord["kind"]): EventRecord => ({ id: "", kind, title: kind === "normal" ? "Monday swing" : "", date: todayInNewYork(), startTime: kind === "normal" ? "20:00" : "", endTime: kind === "normal" ? "22:00" : "", location: "", locationUrl: "", room: "", studentPrice: "", generalPrice: "", description: "", published: false, updatedAt: "" })
const searchParam = (name: string) => new URLSearchParams(window.location.search).get(name)

export default function Manage({ initialEvents }: { initialEvents?: ManagedEvent[] }) {
  const [events, setEvents] = useState<ManagedEvent[]>(() => [...(initialEvents ?? [])].sort(byDate))
  const [loading, setLoading] = useState(initialEvents === undefined)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [view, setView] = useState<View>(() => views.find(item => item.value === searchParam("view"))?.value ?? "special")
  const [editingId, setEditingId] = useState<string | null>(() => searchParam("event"))
  const editing = editingId === "new" ? { ...newEvent("special"), rsvpCount: 0 } : events.find(event => event.id === editingId) ?? null
  const [activeNormal, setActiveNormal] = useState<string | null>(null)
  const normalEditor = useRef<NormalEventHandle>(null)
  const switching = useRef(false)
  // Set by the event editor while it has unsaved edits; Back and Forward then ask before leaving.
  const leaveGuard = useRef<(() => void) | null>(null)
  useEffect(() => {
    const navigate = () => leaveGuard.current ? leaveGuard.current() : setEditingId(searchParam("event"))
    window.addEventListener("popstate", navigate)
    return () => window.removeEventListener("popstate", navigate)
  }, [])
  function changeView(next: View) {
    void openEvent(() => {
      const url = new URL(window.location.href)
      url.searchParams.set("view", next)
      window.history.replaceState(window.history.state, "", url)
      setView(next)
    })
  }
  function openSpecial(event: EventRecord) {
    const url = new URL(window.location.href)
    url.searchParams.set("event", event.id || "new")
    window.history.pushState({ eventEditor: true }, "", url)
    setEditingId(event.id || "new")
  }
  function closeSpecial() {
    leaveGuard.current = null
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
    setEvents(data.events.sort(byDate))
  }
  useEffect(() => { if (initialEvents === undefined) void load().catch(err => setError(errorMessage(err))).finally(() => setLoading(false)) }, [])
  function acceptDeletedEvent(id: string) {
    const lesson = events.find(event => event.id === id)?.kind === "normal"
    setEvents(current => current.filter(event => event.id !== id))
    setActiveNormal(null)
    if (editingId) closeSpecial()
    setNotice(lesson ? "Lesson deleted." : "Event deleted."); setError("")
  }
  function removeRsvpCount(id: string) {
    setEvents(current => current.map(event => event.id === id ? { ...event, rsvpCount: Math.max(0, event.rsvpCount - 1) } : event))
  }
  // Saves the open lesson before switching, so leaving a row never loses edits.
  async function openEvent(action: () => void) {
    if (switching.current) return
    switching.current = true
    try {
      if (normalEditor.current && !await normalEditor.current.save()) return
      setActiveNormal(null); setNotice(""); action()
    } finally { switching.current = false }
  }
  function acceptSavedEvent(event: EventRecord) {
    setEvents(current => [...current.filter(item => item.id !== event.id), { ...event, rsvpCount: current.find(item => item.id === event.id)?.rsvpCount ?? 0 }].sort(byDate))
    setNotice(""); setError("")
  }
  async function saveNormal(draft: EventRecord) {
    const { event } = await api<{ event: EventRecord }>(`/events${draft.id ? `/${draft.id}` : ""}`, { method: draft.id ? "PUT" : "POST", body: JSON.stringify(draft) })
    acceptSavedEvent(event)
  }
  const lessonRow = (event: EventRecord) => <NormalEventRow key={`${event.id}-${event.updatedAt}-${activeNormal === event.id}`} ref={activeNormal === event.id ? normalEditor : undefined} editing={activeNormal === event.id} onEdit={() => { void openEvent(() => setActiveNormal(event.id)) }} event={event} onSave={saveNormal} onCancel={() => setActiveNormal(null)} onDelete={async () => { await api(`/events/${event.id}`, { method: "DELETE" }); acceptDeletedEvent(event.id) }} />
  const specialRow = (event: ManagedEvent) => <Button key={event.id} variant="ghost" className="event-row-button" onClick={() => { void openEvent(() => openSpecial(event)) }}>
    <DateTile date={event.date} />
    <span className="event-row-text"><span className="event-row-title"><strong>{event.title}</strong>{!event.published && <DraftBadge />}</span><span className="event-muted">{eventSummary(event)}</span></span>
    <span className="guest-count event-muted">{event.rsvpCount} RSVP{event.rsvpCount === 1 ? "" : "s"}</span>
  </Button>

  return <>
    <header className="site-header manage-header"><SiteBrand /></header>
    <main className="manage-main">
      {editing ? <EventEditor key={`${editing.id || "new"}-${editing.updatedAt}`} event={editing} leaveGuard={leaveGuard} onReplace={acceptSavedEvent} onCancel={closeSpecial} onRsvpChange={() => removeRsvpCount(editing.id)} onSave={event => { acceptSavedEvent(event); closeSpecial() }} onDelete={() => acceptDeletedEvent(editing.id)} /> : <>
        <div className="manage-title">
          <h1>Events</h1>
          {view === "special" && <Button onClick={() => { void openEvent(() => openSpecial(newEvent("special"))) }}>New event</Button>}
          {view === "lessons" && <Button onClick={() => { if (activeNormal !== "") void openEvent(() => setActiveNormal("")) }}>Add lesson</Button>}
        </div>
        <Tabs label="Event views" tabs={views} value={view} onChange={changeView} />
        {notice && <p role="status" className="manage-notice">{notice}</p>}
        {error && <p role="alert" className="event-error manage-notice">{error} <Button variant="link" size="sm" onClick={() => window.location.reload()}>Reload</Button></p>}
        <div role="tabpanel" className="manage-panel" aria-label={views.find(item => item.value === view)!.label}>
          {view === "settings" ? <><SheetConnection onSync={load} /><CampusGroupsUpload /></> : loading ? <p role="status" className="event-muted manage-notice">Loading events…</p> : view === "special"
            ? <EventGroups events={events.filter(event => event.kind === "special")} render={specialRow} empty="No special events yet." />
            : <EventGroups events={events.filter(event => event.kind === "normal")} render={lessonRow} empty="No weekly lessons yet." first={activeNormal === "" && <NormalEventRow ref={normalEditor} editing onEdit={() => {}} event={newEvent("normal")} onSave={saveNormal} onCancel={() => setActiveNormal(null)} />} />}
        </div>
      </>}
    </main>
  </>
}

// Upcoming events first, then past ones, which stay visible but muted.
function EventGroups<T extends EventRecord>({ events, render, empty, first }: { events: T[]; render: (event: T) => ReactNode; empty: string; first?: ReactNode }) {
  const today = todayInNewYork()
  const upcoming = events.filter(event => !event.date || event.date >= today)
  const past = events.filter(event => event.date && event.date < today)
  if (!events.length && !first) return <p className="event-muted manage-notice">{empty}</p>
  return <>
    <section className="manage-group" aria-label="Upcoming"><h2>Upcoming</h2><div className="manage-list">{first}{upcoming.map(render)}</div>{!upcoming.length && !first && <p className="event-muted">Nothing scheduled yet.</p>}</section>
    {past.length > 0 && <section className="manage-group is-past" aria-label="Past"><h2>Past</h2><div className="manage-list">{[...past].reverse().map(render)}</div></section>}
  </>
}

function EventEditor({ event, leaveGuard, onSave, onReplace, onDelete, onCancel, onRsvpChange }: { event: ManagedEvent; leaveGuard: RefObject<(() => void) | null>; onRsvpChange: () => void; onSave: (event: EventRecord) => void; onReplace: (event: EventRecord) => void; onDelete: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<EventRecord>(event)
  const [tab, setTab] = useState<"details" | "guests">("details")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [editorError, setEditorError] = useState("")
  // Set when someone else saved the event after it was opened; the manager then keeps their own version or loads that one.
  const [conflict, setConflict] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const dirty = (["title", "date", "startTime", "endTime", "location", "locationUrl", "room", "studentPrice", "generalPrice", "description"] as const).some(key => draft[key] !== event[key])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    // Back or Forward put the editor's history entry back and ask before discarding.
    leaveGuard.current = () => {
      const url = new URL(window.location.href)
      url.searchParams.set("event", event.id || "new")
      window.history.pushState({ eventEditor: true }, "", url)
      setLeaving(true)
    }
    return () => { window.removeEventListener("beforeunload", warn); leaveGuard.current = null }
  }, [dirty])
  const change = (key: keyof EventRecord, value: string) => setDraft(current => ({ ...current, [key]: value }))
  // A description that failed to load is never changed, so saving keeps its stored text.
  async function save(published: boolean, base: EventRecord = draft) {
    setBusy(true); setError(""); setConflict(false)
    try { const { event: saved } = await api<{ event: EventRecord }>(`/events${event.id ? `/${event.id}` : ""}`, { method: event.id ? "PUT" : "POST", body: JSON.stringify({ ...base, published }) }); onSave(saved) }
    catch (err) { setError(errorMessage(err)); setConflict(err instanceof ApiError && err.code === "stale"); setBusy(false) }
  }
  async function latest(): Promise<EventRecord | null> {
    setBusy(true); setError("")
    try {
      const { events } = await api<{ events: ManagedEvent[] }>("/events")
      const found = events.find(item => item.id === event.id)
      if (!found) setError("This event was deleted.")
      return found ?? null
    } catch (err) { setError(errorMessage(err)); return null }
    finally { setBusy(false) }
  }
  async function keepMine() {
    const current = await latest()
    if (current) await save(event.published, { ...draft, updatedAt: current.updatedAt })
  }
  async function loadTheirs() {
    const current = await latest()
    if (current) onReplace(current)
  }
  async function remove() {
    await api(`/events/${event.id}`, { method: "DELETE" })
    await onDelete()
  }
  return <div className="event-editor-shell">
    <DiscardChangesDialog open={leaving} onOpenChange={setLeaving} onDiscard={onCancel} />
    <DiscardChangesButton variant="ghost" size="sm" className="back-button" dirty={dirty} onDiscard={onCancel} disabled={busy}>← Events</DiscardChangesButton>
    {event.id && <Tabs label="Event sections" tabs={[{ value: "details", label: "Details" }, { value: "guests", label: <>Guests <span className="tab-count">{event.rsvpCount}</span></> }]} value={tab} onChange={setTab} />}
    {tab === "guests" ? <div role="tabpanel" className="guest-panel" aria-label="Guests"><GuestList event={event} onChange={onRsvpChange} /></div> :
    <form role={event.id ? "tabpanel" : undefined} className="event-editor" aria-label={event.id ? "Edit event" : "New event"} onSubmit={e => { e.preventDefault(); if (e.currentTarget.reportValidity()) void save(event.published) }}>
      <div className="editor-title">
        <DateTile date={draft.date} />
        <TitleInput value={draft.title} disabled={busy} onChange={value => change("title", value)} />
      </div>
      <div className="editor-card">
        <div className="editor-field"><CalendarIcon aria-hidden="true" /><div className="editor-when">
          <EventDatePicker allowTba icon={false} disabled={busy} value={draft.date} onChange={value => change("date", value)} />
          <EventTimePicker label="Start time" disabled={busy} value={draft.startTime} onChange={value => change("startTime", value)} /><span aria-hidden="true">–</span><EventTimePicker label="End time" disabled={busy} value={draft.endTime} onChange={value => change("endTime", value)} />
        </div></div>
        <div className="editor-field"><MapPinIcon aria-hidden="true" /><LocationPicker icon={false} value={draft.location} url={draft.locationUrl} room={draft.room} onRoomChange={room => change("room", room)} onChange={(location, locationUrl) => setDraft(current => ({ ...current, location, locationUrl }))} disabled={busy} /></div>
        <div className="editor-field"><TicketIcon aria-hidden="true" /><div className="editor-prices">
          <PriceInput label="Students" disabled={busy} value={draft.studentPrice} onChange={value => change("studentPrice", value)} />
          <PriceInput label="General" disabled={busy} value={draft.generalPrice} onChange={value => change("generalPrice", value)} />
        </div></div>
      </div>
      <MarkdownEditor markdown={draft.description} label="Description" onChange={value => change("description", value)} onError={setEditorError} readOnly={busy} />
      {editorError && <p role="alert" className="event-error">{editorError}</p>}
      <div className="editor-actions">
        {error ? <p role="alert" className="event-error">{error}{conflict && <> <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void keepMine()}>Save my version</Button><Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void loadTheirs()}>Load theirs</Button></>}</p> : <p className="event-muted" aria-live="polite">{dirty ? "Unsaved changes" : event.published ? "Published" : "Draft"}</p>}
        <Button type="button" variant="outline" disabled={busy} onClick={e => { if (e.currentTarget.form!.reportValidity()) void save(!event.published) }}>{event.published ? "Unpublish" : "Publish"}</Button>
        <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      {event.id && <div className="editor-delete"><DeleteEventButton onDelete={remove} disabled={busy} onBusyChange={setBusy} includesRsvps /></div>}
    </form>}
  </div>
}

// Grows with the name so long names wrap instead of scrolling out of view. Enter saves, as in a one-line field.
function TitleInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = field.current!
    const fit = () => { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px` }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [value])
  return <textarea ref={field} className="event-name-input" rows={1} disabled={disabled} aria-label="Event name" required maxLength={160} placeholder="Event name" value={value}
    onChange={e => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form!.requestSubmit() } }} />
}

// Keystrokes that would make an invalid price are ignored. Leaving the field writes cents in full, "12.5" as "12.50".
function PriceInput({ label, value = "", disabled, onChange }: { label: string; value?: string; disabled: boolean; onChange: (value: string) => void }) {
  return <InputGroup>
    <InputGroupAddon>{label}</InputGroupAddon>
    <InputGroupAddon>$</InputGroupAddon>
    <InputGroupInput disabled={disabled} aria-label={`${label} ticket price`} inputMode="decimal" style={{ width: `calc(${Math.max(value.length, 1)}ch + 11px)` }} value={value}
      onChange={e => { if (isValidPrice(e.target.value.replace(/\.$/, ""))) onChange(e.target.value) }}
      onBlur={() => onChange(value.replace(/\.$/, "").replace(/\.(\d)$/, (_, digit) => `.${digit}0`))} />
  </InputGroup>
}

// Tab-separated rows paste into Google Sheets as Name and Email columns.
function CopyGuestsButton({ rsvps }: { rsvps: RSVP[] }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(rsvps.map(rsvp => `${rsvp.name}\t${rsvp.email}`).join("\n"))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return <Button variant="outline" size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}Copy names and emails<span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span></Button>
}

const rsvpDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })

function GuestList({ event, onChange }: { event: EventRecord; onChange: () => void }) {
  const [rsvps, setRsvps] = useState<RSVP[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => { void api<{ rsvps: RSVP[] }>(`/events/${event.id}/rsvps`).then(data => setRsvps(data.rsvps)).catch(err => setError(errorMessage(err))) }, [event.id])
  async function remove(email: string) {
    setError("")
    try {
      await api(`/events/${event.id}/rsvps`, { method: "DELETE", body: JSON.stringify({ email }) })
      setRsvps(current => current!.filter(guest => guest.email !== email)); onChange()
    } catch (err) { setError(errorMessage(err)) }
  }
  return <>
    {error && <p role="alert" className="event-error manage-notice">{error}</p>}
    {rsvps === null ? !error && <p role="status" className="event-muted manage-notice">Loading guests…</p> : rsvps.length ? <>
      <div className="guest-summary"><span className="event-muted">{rsvps.length} guest{rsvps.length === 1 ? "" : "s"}</span><CopyGuestsButton rsvps={rsvps} /></div>
      <ul className="guest-list">
      {rsvps.map(rsvp => <li className="guest-row" key={rsvp.email}>
        <Person name={rsvp.name} detail={rsvp.email} />
        <time dateTime={rsvp.createdAt} title="RSVP date">{rsvpDate.format(new Date(rsvp.createdAt))}</time>
        <ConfirmButton size="sm" aria-label={`Remove ${rsvp.name}`} confirmLabel="Confirm" busyLabel="Removing…" onConfirm={() => remove(rsvp.email)}>Remove</ConfirmButton>
      </li>)}
    </ul></> : <p className="event-muted manage-notice">No RSVPs yet. Guests appear here when they RSVP on the website.</p>}
  </>
}

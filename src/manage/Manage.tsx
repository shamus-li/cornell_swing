import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns"
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { ArrowLeftIcon, CalendarIcon, MapPinIcon, MusicIcon, TicketIcon, XIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs"
import { ToggleChoice, ToggleGroupItem } from "../components/ui/toggle-group"
import { Input } from "../../check-in/src/components/ui/input"
import { StylePicker } from "../events/StylePicker"
import { isUpcoming, isValidPrice, todayInNewYork, type EventDay, type EventRecord, type EventTicket, type ManagedEvent } from "../events/model"
import { EventTimePicker } from "./EventTimePicker"
import { LocationPicker } from "./LocationPicker"
import { EventDatePicker } from "./EventDatePicker"
import { NormalEventRow, type NormalEventHandle } from "./NormalEventRow"
import { DiscardChangesButton, DiscardChangesDialog } from "./DiscardChangesButton"
import { DeleteEventButton } from "./DeleteEventButton"
import { CopyButton } from "./CopyButton"
import { EventGuests, EventOverview, useEventRecords } from "./EventOverview"
import { SheetConnection } from "./SheetConnection"
import { CampusGroupsUpload } from "./CampusGroupsUpload"
import { api, ApiError, errorMessage } from "./api"
import { MarkdownEditor } from "./MarkdownEditor"
import { SiteBrand } from "../site/components/SiteBrand"
import { DraftBadge, eventSummary } from "./EventDate"
import { DateTile } from "../events/DateTile"
import { Newsletter } from "./Newsletter"
import { AlertEmail } from "./AlertEmail"
import { DanceFeeds } from "./DanceFeeds"
import { FinanceOverview } from "./FinanceOverview"
import { SquareConnection } from "./SquareConnection"
import { blankOutsideEvent, OutsideEventForm, outsideSummary } from "./OutsideEventForm"
import type { OutsideEvent } from "../events/outside"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../check-in/src/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../check-in/src/components/ui/select"

type ManagerTab = "special" | "lessons" | "newsletter" | "finances" | "settings"
const managerTabs: { value: ManagerTab; label: string }[] = [{ value: "special", label: "Special events" }, { value: "lessons", label: "Lessons" }, { value: "newsletter", label: "Newsletter" }, { value: "finances", label: "Finances" }, { value: "settings", label: "Settings" }]
const groupFilters = [{ value: "all", label: "All" }, { value: "ours", label: "Swing Syndicate" }, { value: "theirs", label: "Other groups" }] as const
const byDate = (a: { date: string; startTime: string }, b: { date: string; startTime: string }) => (a.date || "9999").localeCompare(b.date || "9999") || a.startTime.localeCompare(b.startTime)
const newEvent = (kind: EventRecord["kind"]): EventRecord => ({ id: "", kind, title: kind === "normal" ? "Monday Night Swing" : "", date: kind === "normal" ? todayInNewYork() : "", moreDays: [], startTime: kind === "normal" ? "20:00" : "", endTime: kind === "normal" ? "22:00" : "", lessonEndTime: kind === "normal" ? "21:00" : "", socialStartTime: kind === "normal" ? "21:00" : "", location: "", city: "Ithaca", styles: ["Swing"], locationUrl: "", room: "", tickets: kind === "special" ? [{ id: "student", name: "Student", price: "", days: 1 }, { id: "general", name: "General", price: "", days: 1 }] : [], description: "", published: false, updatedAt: "" })
const searchParam = (name: string) => new URLSearchParams(window.location.search).get(name)

export default function Manage({ initialEvents }: { initialEvents?: ManagedEvent[] }) {
  const [events, setEvents] = useState<ManagedEvent[]>(() => [...(initialEvents ?? [])].sort(byDate))
  const [loading, setLoading] = useState(initialEvents === undefined)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  // The Newsletter tab puts its copy buttons here, beside the title.
  const [titleActions, setTitleActions] = useState<HTMLDivElement | null>(null)
  const [tab, setTab] = useState<ManagerTab>(() => managerTabs.find(item => item.value === searchParam("tab"))?.value ?? "special")
  const [editingId, setEditingId] = useState<string | null>(() => searchParam("event"))
  const editing = editingId === "new" ? { ...newEvent("special"), rsvpCount: 0 } : events.find(event => event.id === editingId) ?? null
  const [activeNormal, setActiveNormal] = useState<string | null>(null)
  // Other groups' dances, listed with the special events. `editingOutside` is the open one's id, "" for a new one.
  const [outside, setOutside] = useState<OutsideEvent[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [editingOutside, setEditingOutside] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<"all" | "ours" | "theirs">("ours")
  const normalEditor = useRef<NormalEventHandle>(null)
  const switching = useRef(false)
  // Set by the event editor while it has unsaved edits; Back and Forward then ask before leaving.
  const leaveGuard = useRef<(() => void) | null>(null)
  useEffect(() => {
    const navigate = () => leaveGuard.current ? leaveGuard.current() : setEditingId(searchParam("event"))
    window.addEventListener("popstate", navigate)
    return () => window.removeEventListener("popstate", navigate)
  }, [])
  function changeTab(next: ManagerTab) {
    void openEvent(() => {
      const url = new URL(window.location.href)
      url.searchParams.set("tab", next)
      window.history.replaceState(window.history.state, "", url)
      setTab(next)
      setEditingOutside(null)
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
  useEffect(() => {
    void api<{ events: OutsideEvent[]; groups: string[] }>("/outside-events", {}, "Other groups' events could not be loaded.").then(data => { setOutside(data.events); setGroups(data.groups) }).catch(err => setError(errorMessage(err)))
  }, [])
  function acceptOutside(saved: OutsideEvent) {
    setOutside(current => [...current.filter(event => event.id !== saved.id), saved].sort(byDate))
    setGroups(current => current.some(name => name.toLowerCase() === saved.groupName.toLowerCase()) ? current : [...current, saved.groupName].sort())
    setEditingOutside(null)
  }
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
  const specialRow = (event: ManagedEvent) => <Button key={event.id} variant="ghost" className="event-row-button" disabled={editingOutside !== null} onClick={() => { void openEvent(() => openSpecial(event)) }}>
    <DateTile date={event.date} />
    <span className="event-row-text"><span className="event-row-title"><strong>{event.title}</strong>{!event.published && <DraftBadge />}</span><span className="event-muted">{eventSummary(event)}</span></span>
    <span className="guest-count event-muted">{event.rsvpCount} RSVP{event.rsvpCount === 1 ? "" : "s"}</span>
  </Button>
  // Upcoming requested or imported events, which an organizer publishes or deletes.
  const waiting = outside.filter(event => event.needsReview && event.date >= todayInNewYork())
  const shownOutside = groupFilter === "ours" ? [] : outside
  const review = groupFilter === "ours" ? [] : waiting
  const outsideRow = (event: OutsideEvent) => editingOutside === event.id
    ? <OutsideEventForm key={event.id} event={event} groups={groups} onSave={acceptOutside} onCancel={() => setEditingOutside(null)} onDelete={() => { setOutside(current => current.filter(item => item.id !== event.id)); setEditingOutside(null) }} />
    : <Button key={event.id} variant="ghost" className="event-row-button" disabled={editingOutside !== null} onClick={() => setEditingOutside(event.id)}>
      <DateTile date={event.date} />
      <span className="event-row-text"><span className="event-row-title"><strong>{event.title}</strong>{!event.published && !event.needsReview && <DraftBadge />}</span><span className="event-muted">{outsideSummary(event)}</span></span>
    </Button>

  const tabLabel = managerTabs.find(item => item.value === tab)!.label

  return <>
    <header className="site-header manage-header"><SiteBrand /></header>
    <main className="manage-main">
      {editing ? <EventEditor key={`${editing.id || "new"}-${editing.updatedAt}`} event={editing} leaveGuard={leaveGuard} onReplace={acceptSavedEvent} onCancel={closeSpecial} onRsvpChange={() => removeRsvpCount(editing.id)} onSave={event => { acceptSavedEvent(event); closeSpecial() }} onDelete={() => acceptDeletedEvent(editing.id)} /> : <>
        <div className="manage-title">
          <h1>{tabLabel}</h1>
          {tab === "special" && <div className="manage-title-actions">
            <Button variant="outline" disabled={editingOutside !== null} onClick={() => { setEditingOutside(""); if (groupFilter === "ours") setGroupFilter("all") }}>Add another group's event</Button>
            <Button disabled={editingOutside !== null} onClick={() => { void openEvent(() => openSpecial(newEvent("special"))) }}>New event</Button>
          </div>}
          {tab === "lessons" && <Button onClick={() => { if (activeNormal !== "") void openEvent(() => setActiveNormal("")) }}>Add lesson</Button>}
          {tab === "newsletter" && <div ref={setTitleActions} className="manage-title-actions" />}
        </div>
        <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label="Manager sections">{managerTabs.map(({ value, label }) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
        {tab === "special" && <ToggleChoice variant="chips" className="manage-filter" aria-label="Groups" value={groupFilter} onValueChange={setGroupFilter}>
          {groupFilters.map(({ value, label }) => <ToggleGroupItem key={value} value={value}>{label}{value === "theirs" && waiting.length > 0 && ` (${waiting.length} to review)`}</ToggleGroupItem>)}
        </ToggleChoice>}
        {notice && <p role="status" className="manage-notice">{notice}</p>}
        {error && <p role="alert" className="event-error manage-notice">{error} <Button variant="link" size="sm" onClick={() => window.location.reload()}>Reload</Button></p>}
        <TabsContent value={tab} className="manage-panel">
          {tab === "settings" ? <><SheetConnection onSync={load} /><SquareConnection /><CampusGroupsUpload /><DanceFeeds /><AlertEmail /></> : tab === "finances" ? <FinanceOverview /> : loading ? <p role="status" className="event-muted manage-notice">Loading events…</p> : tab === "newsletter" ? <Newsletter outside={outside} events={events} actions={titleActions} /> : tab === "special"
            ? <>{review.length > 0 && <section className="manage-group" aria-label="Waiting for review"><h2>Waiting for review</h2><div className="manage-list">{review.map(outsideRow)}</div></section>}<EventGroups<ManagedEvent | OutsideEvent> events={[...events.filter(event => event.kind === "special" && groupFilter !== "theirs"), ...shownOutside.filter(event => !review.includes(event))].sort(byDate)} render={item => item.kind === "outside" ? outsideRow(item) : specialRow(item)} empty="No special events yet." first={editingOutside === "" && <OutsideEventForm event={blankOutsideEvent()} groups={groups} onSave={acceptOutside} onCancel={() => setEditingOutside(null)} />} /></>
            : <EventGroups events={events.filter(event => event.kind === "normal")} render={lessonRow} empty="No weekly lessons yet." first={activeNormal === "" && <NormalEventRow ref={normalEditor} editing onEdit={() => {}} event={newEvent("normal")} onSave={saveNormal} onCancel={() => setActiveNormal(null)} />} />}
        </TabsContent>
        </Tabs>
      </>}
    </main>
  </>
}

// Upcoming events first, then past ones, which stay visible but muted.
function EventGroups<T extends { date: string }>({ events, render, empty, first }: { events: T[]; render: (event: T) => ReactNode; empty: string; first?: ReactNode }) {
  const today = todayInNewYork()
  const upcoming = events.filter(event => isUpcoming(event, today))
  const past = events.filter(event => !isUpcoming(event, today))
  if (!events.length && !first) return <p className="event-muted manage-notice">{empty}</p>
  return <>
    <section className="manage-group" aria-label="Upcoming"><h2>Upcoming</h2><div className="manage-list">{first}{upcoming.map(render)}</div>{!upcoming.length && !first && <p className="event-muted">Nothing scheduled yet.</p>}</section>
    {past.length > 0 && <section className="manage-group is-past" aria-label="Past"><h2>Past</h2><div className="manage-list">{[...past].reverse().map(render)}</div></section>}
  </>
}

function EventEditor({ event, leaveGuard, onSave, onReplace, onDelete, onCancel, onRsvpChange }: { event: ManagedEvent; leaveGuard: RefObject<(() => void) | null>; onRsvpChange: () => void; onSave: (event: EventRecord) => void; onReplace: (event: EventRecord) => void; onDelete: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<EventRecord>(event)
  const [tab, setTab] = useState<"overview" | "guests" | "details">(event.id ? "overview" : "details")
  const records = useEventRecords(event.id, onRsvpChange)
  // RSVPs before the event, and who came once it has started.
  const guestCount = !event.date || event.date > todayInNewYork() ? event.rsvpCount : records.attended
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [editorError, setEditorError] = useState("")
  // Set when someone else saved the event after it was opened; the manager then keeps their own version or loads that one.
  const [conflict, setConflict] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const formId = useId()
  const dirty = (["title", "date", "startTime", "endTime", "location", "city", "locationUrl", "room", "description"] as const).some(key => draft[key] !== event[key]) || JSON.stringify([draft.tickets, draft.moreDays, draft.styles]) !== JSON.stringify([event.tickets, event.moreDays, event.styles])
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
  const form = <form id={formId} className="event-editor" aria-label={event.id ? "Edit event" : "New event"} onSubmit={e => { e.preventDefault(); if (e.currentTarget.reportValidity()) void save(event.published) }}>
      {event.published && event.slug && <div className="editor-share"><a href={`/events/${event.slug}`} target="_blank" rel="noreferrer">swingsyndicate.club/events/{event.slug}</a><CopyButton text={`${window.location.origin}/events/${event.slug}`} label="Copy link" /></div>}
      <div className="editor-card editor-card-sections">
        <div className="editor-field"><CalendarIcon aria-hidden="true" /><EventDays event={draft} disabled={busy} onChange={(days, tickets) => setDraft(current => ({ ...current, ...days, tickets }))} /></div>
        <div className="editor-field"><MapPinIcon aria-hidden="true" /><div className="grid gap-2"><LocationPicker icon={false} value={draft.location} url={draft.locationUrl} room={draft.room} onRoomChange={room => change("room", room)} onChange={(location, locationUrl) => setDraft(current => ({ ...current, location, locationUrl }))} disabled={busy} /><Input aria-label="City" placeholder="City" maxLength={80} value={draft.city} onChange={e => change("city", e.target.value)} disabled={busy} /></div></div>
        <div className="editor-field"><MusicIcon aria-hidden="true" /><StylePicker value={draft.styles} onChange={styles => setDraft(current => ({ ...current, styles }))} disabled={busy} /></div>
        <div className="editor-field"><TicketIcon aria-hidden="true" /><TicketTypes tickets={draft.tickets ?? []} eventDays={(draft.moreDays?.length ?? 0) + 1} disabled={busy} onChange={tickets => setDraft(current => ({ ...current, tickets }))} /></div>
      </div>
      <MarkdownEditor markdown={draft.description} label="Description" onChange={value => change("description", value)} onError={setEditorError} readOnly={busy} />
      {editorError && <p role="alert" className="event-error">{editorError}</p>}
      <div className="editor-actions">
        {error ? <p role="alert" className="event-error">{error}{conflict && <> <Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void keepMine()}>Save my version</Button><Button type="button" variant="link" size="sm" disabled={busy} onClick={() => void loadTheirs()}>Load theirs</Button></>}</p> : <p className="event-muted" aria-live="polite">{dirty ? "Unsaved changes" : event.published ? "Published" : "Draft"}</p>}
        <Button type="button" variant="outline" disabled={busy} onClick={e => { if (e.currentTarget.form!.reportValidity()) void save(!event.published) }}>{event.published ? "Unpublish" : "Publish"}</Button>
        <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      {event.id && <div className="editor-delete"><DeleteEventButton onDelete={remove} disabled={busy} onBusyChange={setBusy} includesRsvps /></div>}
    </form>
  return <div className="event-editor-shell">
    <DiscardChangesDialog open={leaving} onOpenChange={setLeaving} onDiscard={onCancel} />
    <DiscardChangesButton variant="ghost" className="back-button" dirty={dirty} onDiscard={onCancel} disabled={busy}><ArrowLeftIcon aria-hidden="true" />Events</DiscardChangesButton>
    <div className="event-page-title">
      <DateTile date={tab === "details" ? draft.date : event.date} />
      {tab === "details" ? <TitleInput form={formId} value={draft.title} disabled={busy} onChange={value => change("title", value)} /> : <h1>{event.title}</h1>}
    </div>
    <Tabs value={tab} onValueChange={setTab}>
    {event.id && <TabsList aria-label="Event sections">
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="guests">Guests{guestCount !== null && guestCount !== undefined && <> <span className="tab-count">{guestCount}</span></>}</TabsTrigger>
      <TabsTrigger value="details">Details</TabsTrigger>
    </TabsList>}
    {tab !== "details" ? <TabsContent value={tab} className="guest-panel">{tab === "overview" ? <EventOverview records={records} rsvpCount={event.rsvpCount} /> : <EventGuests records={records} />}</TabsContent> : event.id ? <TabsContent value="details" render={form} /> : form}
    </Tabs>
  </div>
}

// Grows with the name so long names wrap instead of scrolling out of view. Enter saves, as in a one-line field.
function TitleInput({ form, value, disabled, onChange }: { form: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = field.current!
    const fit = () => { element.style.height = "auto"; element.style.height = `${element.scrollHeight}px` }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [value])
  return <textarea ref={field} form={form} className="event-name-input" rows={1} disabled={disabled} aria-label="Event name" required maxLength={160} placeholder="Event name" value={value}
    onChange={e => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form!.requestSubmit() } }} />
}

const shiftDate = (date: string, days: number) => format(addDays(parseISO(date), days), "yyyy-MM-dd")

// The event's schedule: one date, start and end, with more rows only for an event running several days. A row
// comes after the one above it, so moving a date moves the days below it by the same amount. Removing days
// shortens any ticket that covered them.
function EventDays({ event, disabled, onChange }: { event: EventRecord; disabled: boolean; onChange: (days: Pick<EventRecord, "date" | "startTime" | "endTime" | "moreDays">, tickets: EventTicket[]) => void }) {
  const rows = useRef<HTMLDivElement>(null)
  const days: EventDay[] = [{ date: event.date, startTime: event.startTime, endTime: event.endTime }, ...(event.moreDays ?? [])]
  const several = days.length > 1
  function set([first, ...rest]: EventDay[]) {
    onChange({ ...first, moreDays: rest }, (event.tickets ?? []).map(ticket => ({ ...ticket, days: Math.min(ticket.days, rest.length + 1) })))
  }
  function moveDate(index: number, date: string) {
    const previous = days[index].date
    const moved = previous && date ? differenceInCalendarDays(parseISO(date), parseISO(previous)) : 0
    set(days.map((day, at) => at === index ? { ...day, date } : at > index && moved ? { ...day, date: shiftDate(day.date, moved) } : day))
  }
  // Adding or removing a day swaps out the control that had focus, so focus moves to the last row's date.
  function setAndFocus(next: EventDay[]) {
    set(next)
    requestAnimationFrame(() => [...(rows.current?.querySelectorAll<HTMLButtonElement>(".event-date-picker > button:first-child") ?? [])].at(-1)?.focus())
  }
  const update = (index: number, change: Partial<EventDay>) => set(days.map((day, at) => at === index ? { ...day, ...change } : day))
  return <div className="editor-days" ref={rows}>
    {days.map((day, index) => <div className={several ? "editor-day editor-day-removable" : "editor-day"} key={index}>
      <EventDatePicker clearable={!several} icon={false} placeholder="Date TBA" label={several ? `Day ${index + 1} date` : "Date"} after={days[index - 1]?.date} disabled={disabled} value={day.date} onChange={date => moveDate(index, date)} />
      <EventTimePicker label={several ? `Day ${index + 1} start time` : "Start time"} placeholder="Start" disabled={disabled} value={day.startTime} onChange={startTime => update(index, { startTime })} />
      <span aria-hidden="true">–</span>
      <EventTimePicker label={several ? `Day ${index + 1} end time` : "End time"} placeholder="End" disabled={disabled} value={day.endTime} onChange={endTime => update(index, { endTime })} />
      {several && <Button type="button" variant="ghost" size="icon" className="editor-day-remove" disabled={disabled} aria-label={`Remove day ${index + 1}`} onClick={() => setAndFocus(days.filter((_, at) => at !== index))}><XIcon /></Button>}
    </div>)}
    {event.date && days.length < 14 && <Button type="button" variant="link" size="sm" className="editor-link" disabled={disabled} onClick={() => { const last = days.at(-1)!; setAndFocus([...days, { ...last, date: shiftDate(last.date, 1) }]) }}>Add another day</Button>}
  </div>
}

// Keystrokes that would make an invalid price are ignored. Leaving the field writes cents in full, "12.5" as "12.50".
function PriceInput({ label, value = "", disabled, onChange }: { label: string; value?: string; disabled: boolean; onChange: (value: string) => void }) {
  return <InputGroup>
    <InputGroupAddon>$</InputGroupAddon>
    <InputGroupInput disabled={disabled} aria-label={`${label} ticket price`} placeholder="TBA" inputMode="decimal" value={value}
      onChange={e => { if (isValidPrice(e.target.value.replace(/\.$/, ""))) onChange(e.target.value) }}
      onBlur={() => onChange(value.replace(/\.$/, "").replace(/\.(\d)$/, (_, digit) => `.${digit}0`))} />
  </InputGroup>
}

// The ticket types people choose from at check-in. Days only matters for an event with a last day.
function TicketTypes({ tickets, eventDays, disabled, onChange }: { tickets: EventTicket[]; eventDays: number; disabled: boolean; onChange: (tickets: EventTicket[]) => void }) {
  const addTicket = useRef<HTMLButtonElement>(null)
  const update = (index: number, change: Partial<EventTicket>) => onChange(tickets.map((ticket, at) => at === index ? { ...ticket, ...change } : ticket))
  return <div className="editor-tickets">
    {tickets.map((ticket, index) => <div className={eventDays > 1 ? "editor-ticket editor-ticket-days" : "editor-ticket"} key={ticket.id}>
      <InputGroup className="editor-ticket-name"><InputGroupInput disabled={disabled} aria-label="Ticket name" placeholder="Ticket name" maxLength={60} value={ticket.name} onChange={e => update(index, { name: e.target.value })} /></InputGroup>
      <PriceInput label={ticket.name || "This"} disabled={disabled} value={ticket.price} onChange={price => update(index, { price })} />
      {eventDays > 1 && <Select value={String(ticket.days)} disabled={disabled} onValueChange={days => update(index, { days: Number(days) })}>
        <SelectTrigger className="editor-ticket-select" aria-label={`Days ${ticket.name || "this ticket"} covers`}><SelectValue /></SelectTrigger>
        <SelectContent>{Array.from({ length: eventDays }, (_, day) => <SelectItem key={day} value={String(day + 1)}>{day + 1} {day ? "days" : "day"}</SelectItem>)}</SelectContent>
      </Select>}
      <Button type="button" variant="ghost" size="icon" className="editor-ticket-remove" disabled={disabled} aria-label={`Remove ${ticket.name || "ticket"}`} onClick={() => { onChange(tickets.filter((_, at) => at !== index)); addTicket.current?.focus() }}><XIcon /></Button>
    </div>)}
    <Button ref={addTicket} type="button" variant="link" size="sm" className="editor-link" disabled={disabled} onClick={() => onChange([...tickets, { id: crypto.randomUUID(), name: "", price: "", days: 1 }])}>Add ticket type</Button>
  </div>
}

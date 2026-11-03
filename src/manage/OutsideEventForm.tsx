import { useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { formatEventDate, formatEventTime, todayInNewYork } from "../events/model"
import { type OutsideEvent } from "../events/outside"
import { StylePicker } from "../events/StylePicker"
import { EventDatePicker } from "./EventDatePicker"
import { EventTimePicker } from "./EventTimePicker"
import { DeleteEventButton } from "./DeleteEventButton"
import { api, errorMessage } from "./api"

export const blankOutsideEvent = (): OutsideEvent => ({ id: "", kind: "outside", groupName: "", title: "", date: todayInNewYork(), lastDate: "", startTime: "", endTime: "", location: "", city: "Ithaca", styles: [], price: "", url: "", published: false, needsReview: false, updatedAt: "", fromFeed: false, sourceNote: "" })
export const outsideSummary = (event: OutsideEvent) => [event.groupName, event.styles.join(", "), formatEventDate(event.date, { weekday: "short" }), event.startTime && formatEventTime(event), event.location, event.city !== "Ithaca" && event.city].filter(Boolean).join(" · ")

// Another group's dance, edited in place in the Special events list. Published ones show on /events.
export function OutsideEventForm({ event, groups, onSave, onCancel, onDelete }: { event: OutsideEvent; groups: string[]; onSave: (event: OutsideEvent) => void; onCancel: () => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState(event)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const change = (key: keyof OutsideEvent, value: string) => setDraft(current => ({ ...current, [key]: value }))
  async function save(published = draft.published) {
    setBusy(true); setError("")
    try {
      const { event: saved } = await api<{ event: OutsideEvent }>(`/outside-events${event.id ? `/${event.id}` : ""}`, { method: event.id ? "PUT" : "POST", body: JSON.stringify({ ...draft, published }) })
      onSave(saved)
    } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }
  async function remove() {
    await api(`/outside-events/${event.id}`, { method: "DELETE" })
    onDelete?.()
  }
  return <form className="normal-event-edit" aria-label={event.id ? "Edit event" : "New event"} onSubmit={e => { e.preventDefault(); void save() }}>
    <div className="normal-event-fields">
      <label className="editor-row"><span>Event</span><Input required maxLength={160} value={draft.title} onChange={e => change("title", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Group</span><Input required maxLength={120} list="dance-groups" value={draft.groupName} onChange={e => change("groupName", e.target.value)} disabled={busy} /></label>
      <datalist id="dance-groups">{groups.map(name => <option key={name} value={name} />)}</datalist>
      <div className="editor-row"><span>Styles</span><StylePicker value={draft.styles} onChange={styles => setDraft(current => ({ ...current, styles }))} disabled={busy} /></div>
      <div className="editor-row"><span>When</span><div className="editor-when">
        <EventDatePicker icon={false} disabled={busy} value={draft.date} onChange={value => change("date", value)} />
        {!draft.lastDate && <><EventTimePicker label="Start time" disabled={busy} value={draft.startTime} onChange={value => change("startTime", value)} /><span aria-hidden="true">–</span><EventTimePicker label="End time" disabled={busy} value={draft.endTime} onChange={value => change("endTime", value)} /></>}
      </div></div>
      <div className="editor-row"><span>Last day</span><EventDatePicker icon={false} clearable placeholder="One day" label="Last day" after={draft.date} disabled={busy} value={draft.lastDate} onChange={value => change("lastDate", value)} /></div>
      <label className="editor-row"><span>Place</span><Input maxLength={300} placeholder="Memorial Room, Willard Straight Hall" value={draft.location} onChange={e => change("location", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>City</span><Input maxLength={80} value={draft.city} onChange={e => change("city", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Price</span><Input maxLength={100} placeholder="Students free · $15" value={draft.price} onChange={e => change("price", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Link</span><Input type="url" maxLength={2000} placeholder="https://" value={draft.url} onChange={e => change("url", e.target.value)} disabled={busy} /></label>
    </div>
    {event.sourceNote && <p className="event-note">{event.sourceNote}</p>}
    {event.fromFeed && <p className="event-note">From {event.groupName}'s calendar feed, which may replace edits to the event's name, time, place or link.</p>}
    {error && <p role="alert" className="event-error">{error}</p>}
    <div className="normal-event-actions">
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={e => { if (e.currentTarget.form!.reportValidity()) void save(!event.published) }}>{event.published ? "Unpublish" : "Publish"}</Button>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      {event.id && !event.fromFeed && <span className="ml-auto"><DeleteEventButton onDelete={remove} disabled={busy} onBusyChange={setBusy} /></span>}
    </div>
  </form>
}

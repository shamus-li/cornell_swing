import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { Textarea } from "../components/ui/textarea"
import { EventDatePicker } from "./EventDatePicker"
import { LocationPicker } from "./LocationPicker"
import { DeleteEventButton } from "./DeleteEventButton"
import { Markdown } from "../events/Markdown"
import { EventLocation } from "../events/EventLocation"
import { formatEventDate, type EventRecord } from "../events/model"

type Programs = { beginner: string; advanced: string; notes: string }

export function parsePrograms(description: string): Programs {
  const programs: Programs = { beginner: "", advanced: "", notes: "" }
  const notes: string[] = []
  const seen = new Set<string>()
  for (const paragraph of description.split(/\n\s*\n/)) {
    const match = paragraph.match(/^\*\*(Beginner|Advanced)(?::\*\*|\*\*:)\s*([^\n]*)$/)
    const key = match?.[1].toLowerCase() as "beginner" | "advanced" | undefined
    if (match && key && !seen.has(key)) {
      programs[key] = match[2]
      seen.add(key)
    } else {
      notes.push(paragraph)
    }
  }
  programs.notes = notes.join("\n\n")
  return programs
}

export function serializePrograms(programs: Programs): string {
  return [
    programs.beginner.trim() && `**Beginner:** ${programs.beginner.trim()}`,
    programs.advanced.trim() && `**Advanced:** ${programs.advanced.trim()}`,
    programs.notes.trim(),
  ].filter(Boolean).join("\n\n")
}

export type NormalEventHandle = { save: () => Promise<boolean> }

export function NormalEventRow({ event, editing, onEdit, onSave, onDelete, onCancel, ref }: {
  editing: boolean
  onEdit: () => void
  ref?: Ref<NormalEventHandle>
  event: EventRecord
  onSave: (draft: EventRecord) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel?: () => void
}) {
  const saving = useRef(false)
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location)
  const [locationUrl, setLocationUrl] = useState(event.locationUrl)
  const [room, setRoom] = useState(event.room || "")
  const [programs, setPrograms] = useState(() => parsePrograms(event.description))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const originalPrograms = useMemo(() => parsePrograms(event.description), [event.description])
  const descriptionChanged = JSON.stringify(programs) !== JSON.stringify(originalPrograms)
  const dirty = editing && (date !== event.date || location !== event.location || locationUrl !== event.locationUrl || room !== (event.room || "") || descriptionChanged)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  async function save(): Promise<boolean> {
    if (saving.current) return false
    if (event.id && !dirty) { onCancel?.(); return true }
    saving.current = true; setBusy(true); setError("")
    try {
      await onSave({ ...event, date, location, room, ...(locationUrl !== undefined && { locationUrl }), description: descriptionChanged ? serializePrograms(programs) : event.description })
      onCancel?.()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "This event could not be saved. Please try again.")
      return false
    } finally { saving.current = false; setBusy(false) }
  }
  useImperativeHandle(ref, () => ({ save }))
  const change = (key: keyof Programs, value: string) => setPrograms(current => ({ ...current, [key]: value }))
  return <article className="normal-event-row">
    {editing ? <form className="normal-event-edit event-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="normal-event-fields">
        <div className="event-field"><span>Date</span><EventDatePicker value={date} onChange={setDate} disabled={busy} /></div>
        <div className="event-field"><span>Location</span><LocationPicker value={location} url={locationUrl} room={room} onRoomChange={setRoom} onChange={(name, url) => { setLocation(name); setLocationUrl(url) }} disabled={busy} /></div>
        <label>Beginner<Input value={programs.beginner} onChange={e => change("beginner", e.target.value)} disabled={busy} /></label>
        <label>Advanced<Input value={programs.advanced} onChange={e => change("advanced", e.target.value)} disabled={busy} /></label>
        <label className="full-width">Notes (optional)<Textarea rows={3} value={programs.notes} onChange={e => change("notes", e.target.value)} disabled={busy} /></label>
      </div>
      {error && <p role="alert" className="event-error">{error}</p>}
      <div className="normal-event-actions"><Button size="default" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button size="default" type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>{event.id && onDelete && <DeleteEventButton onDelete={onDelete} disabled={busy} onBusyChange={value => { saving.current = value; setBusy(value) }} />}</div>
    </form> : <Button asChild variant="ghost" className="normal-event-summary"><div role="button" tabIndex={0} aria-label={`Edit event on ${event.date}`} onClick={e => { e.preventDefault(); onEdit() }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onEdit() } }}>
      <time dateTime={event.date}>{formatEventDate(event.date)}</time>
      <div><EventLocation event={event} /></div>
      <div className="normal-event-program">{event.description ? <Markdown>{event.description}</Markdown> : <p>TBA</p>}</div>
    </div></Button>}
  </article>
}

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { Textarea } from "../components/ui/textarea"
import { EventDatePicker } from "./EventDatePicker"
import { LocationPicker } from "./LocationPicker"
import { DeleteEventButton } from "./DeleteEventButton"
import { Markdown } from "../events/Markdown"
import { formatEventLocation, type EventRecord } from "../events/model"
import { DraftBadge } from "./EventDate"
import { DateTile } from "../events/DateTile"
import { errorMessage } from "./api"

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
  async function save(published = event.published): Promise<boolean> {
    if (saving.current) return false
    if (event.id && !dirty && published === event.published) { onCancel?.(); return true }
    saving.current = true; setBusy(true); setError("")
    try {
      await onSave({ ...event, published, date, location, room, ...(locationUrl !== undefined && { locationUrl }), description: descriptionChanged ? serializePrograms(programs) : event.description })
      onCancel?.()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally { saving.current = false; setBusy(false) }
  }
  useImperativeHandle(ref, () => ({ save: () => save() }))
  const change = (key: keyof Programs, value: string) => setPrograms(current => ({ ...current, [key]: value }))
  return <article className="normal-event-row">
    {editing ? <form className="normal-event-edit" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="normal-event-fields">
        <div className="editor-row"><span>Date</span><EventDatePicker value={date} onChange={setDate} disabled={busy} /></div>
        <div className="editor-row editor-row-top"><span>Location</span><LocationPicker value={location} url={locationUrl} room={room} onRoomChange={setRoom} onChange={(name, url) => { setLocation(name); setLocationUrl(url) }} disabled={busy} /></div>
        <label className="editor-row"><span>Beginner</span><Input value={programs.beginner} onChange={e => change("beginner", e.target.value)} disabled={busy} /></label>
        <label className="editor-row"><span>Advanced</span><Input value={programs.advanced} onChange={e => change("advanced", e.target.value)} disabled={busy} /></label>
        <label className="editor-row editor-row-top"><span>Notes</span><Textarea rows={2} placeholder="Optional" value={programs.notes} onChange={e => change("notes", e.target.value)} disabled={busy} /></label>
      </div>
      {error && <p role="alert" className="event-error">{error}</p>}
      <div className="normal-event-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button type="button" variant="outline" onClick={() => void save(!event.published)} disabled={busy}>{event.published ? "Unpublish" : "Publish"}</Button><Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>{event.id && onDelete && <span className="ml-auto"><DeleteEventButton onDelete={onDelete} disabled={busy} onBusyChange={value => { saving.current = value; setBusy(value) }} /></span>}</div>
    </form> : <Button asChild variant="ghost" className="normal-event-summary"><div role="button" tabIndex={0} onClick={e => { e.preventDefault(); onEdit() }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onEdit() } }}>
      <DateTile date={event.date} />
      <div className="event-row-text">
        <span className="event-row-title"><strong>{formatEventLocation(event)}</strong>{!event.published && <DraftBadge />}</span>
        <div className="normal-event-program event-muted">{event.description ? <Markdown>{event.description}</Markdown> : <p>Lesson to be announced</p>}</div>
      </div>
    </div></Button>}
  </article>
}

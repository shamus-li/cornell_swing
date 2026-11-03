import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { ToggleChoice, ToggleGroupItem } from "../components/ui/toggle-group"
import { Textarea } from "../components/ui/textarea"
import { EventDatePicker } from "./EventDatePicker"
import { LocationPicker } from "./LocationPicker"
import { EventTimePicker } from "./EventTimePicker"
import { DeleteEventButton } from "./DeleteEventButton"
import { LessonTimes } from "../events/LessonTimes"
import { Markdown } from "../events/Markdown"
import { formatEventLocation, validateEvent, type EventRecord } from "../events/model"
import { DraftBadge } from "./EventDate"
import { DateTile } from "../events/DateTile"
import { errorMessage } from "./api"

type Programs = { lesson: string; beginner: string; advanced: string; notes: string }
// A night has no lesson, one lesson for everyone, or a beginner and an advanced lesson.
type LessonMode = "none" | "one" | "two"
const lessonModes: { value: LessonMode; label: string }[] = [{ value: "none", label: "None" }, { value: "one", label: "One" }, { value: "two", label: "Two levels" }]

export function parsePrograms(description: string): Programs {
  const programs: Programs = { lesson: "", beginner: "", advanced: "", notes: "" }
  const notes: string[] = []
  const seen = new Set<string>()
  for (const paragraph of description.split(/\n\s*\n/)) {
    const match = paragraph.match(/^\*\*(Lesson|Beginner|Advanced)(?::\*\*|\*\*:)\s*([^\n]*)$/)
    const key = match?.[1].toLowerCase() as "lesson" | "beginner" | "advanced" | undefined
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
    programs.lesson.trim() && `**Lesson:** ${programs.lesson.trim()}`,
    programs.beginner.trim() && `**Beginner:** ${programs.beginner.trim()}`,
    programs.advanced.trim() && `**Advanced:** ${programs.advanced.trim()}`,
    programs.notes.trim(),
  ].filter(Boolean).join("\n\n")
}

// "20:00" plus 60 minutes is "21:00".
function addMinutes(time: string, minutes: number) {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
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
  const form = useRef<HTMLFormElement>(null)
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location)
  const [locationUrl, setLocationUrl] = useState(event.locationUrl)
  const [room, setRoom] = useState(event.room || "")
  const [programs, setPrograms] = useState(() => parsePrograms(event.description))
  const [mode, setMode] = useState<LessonMode>(() => !event.lessonEndTime ? "none" : parsePrograms(event.description).lesson ? "one" : "two")
  const [lessonStart, setLessonStart] = useState(event.lessonEndTime ? event.startTime : "")
  const [endTime, setEndTime] = useState(event.endTime)
  const [lessonEnd, setLessonEnd] = useState(event.lessonEndTime || "")
  const [socialStart, setSocialStart] = useState(event.lessonEndTime ? event.socialStartTime || "" : event.startTime)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const originalDescription = useMemo(() => serializePrograms(parsePrograms(event.description)), [event.description])
  // Topics for lessons the night no longer has are left out.
  const description = serializePrograms({ ...programs, ...(mode !== "one" && { lesson: "" }), ...(mode !== "two" && { beginner: "", advanced: "" }) })
  const descriptionChanged = description !== originalDescription
  const lessonEndTime = mode === "none" ? "" : lessonEnd
  const socialStartTime = mode === "none" ? "" : socialStart
  const startTime = mode === "none" ? socialStart : lessonStart
  const dirty = editing && (date !== event.date || location !== event.location || locationUrl !== event.locationUrl || room !== (event.room || "") || startTime !== event.startTime || endTime !== event.endTime || lessonEndTime !== (event.lessonEndTime || "") || socialStartTime !== (event.socialStartTime || "") || descriptionChanged)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  async function save(published = event.published): Promise<boolean> {
    if (saving.current) return false
    if (event.id && !dirty && published === event.published) { onCancel?.(); return true }
    if (!form.current?.reportValidity()) return false
    if (mode !== "none" && !lessonEnd) { setError("Enter when the lesson ends."); return false }
    saving.current = true; setBusy(true); setError("")
    try {
      const draft = { ...event, published, date, startTime, endTime, lessonEndTime, socialStartTime, location, room, ...(locationUrl !== undefined && { locationUrl }), description: descriptionChanged ? description : event.description }
      validateEvent(draft)
      await onSave(draft)
      onCancel?.()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally { saving.current = false; setBusy(false) }
  }
  // Leaving an untouched new lesson discards it instead of creating one.
  useImperativeHandle(ref, () => ({ save: () => event.id || dirty ? save() : (onCancel?.(), Promise.resolve(true)) }))
  const change = (key: keyof Programs, value: string) => setPrograms(current => ({ ...current, [key]: value }))
  // Adding a lesson to a night without one starts it with an hour-long lesson, followed by the social dance.
  function changeMode(next: LessonMode) {
    if (mode === "none" && next !== "none" && !lessonEnd && socialStart) {
      setLessonStart(socialStart)
      setLessonEnd(addMinutes(socialStart, 60))
      setSocialStart(addMinutes(socialStart, 60))
    }
    setMode(next)
  }
  return <article className="normal-event-row">
    {editing ? <form ref={form} className="normal-event-edit" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="normal-event-fields">
        <div className="editor-row"><span>Date</span><EventDatePicker value={date} onChange={setDate} disabled={busy} /></div>
        <div className="editor-row editor-row-top"><span>Location</span><LocationPicker value={location} url={locationUrl} room={room} onRoomChange={setRoom} onChange={(name, url) => { setLocation(name); setLocationUrl(url) }} disabled={busy} /></div>
        <div className="editor-row editor-row-top"><span>Lesson</span><div className="lesson-times">
          <ToggleChoice variant="segmented" aria-label="Lessons" value={mode} disabled={busy} onValueChange={changeMode}>{lessonModes.map(item => <ToggleGroupItem key={item.value} value={item.value}>{item.label}</ToggleGroupItem>)}</ToggleChoice>
          {mode !== "none" && <div className="time-range"><EventTimePicker label="Lesson start" value={lessonStart} onChange={setLessonStart} disabled={busy} required /><span aria-hidden="true">–</span><EventTimePicker label="Lesson end" value={lessonEnd} onChange={setLessonEnd} disabled={busy} required /></div>}
        </div></div>
        {mode === "one" && <label className="editor-row"><span>Topic</span><Input value={programs.lesson} onChange={e => change("lesson", e.target.value)} disabled={busy} /></label>}
        {mode === "two" && <>
          <label className="editor-row"><span>Beginner</span><Input value={programs.beginner} onChange={e => change("beginner", e.target.value)} disabled={busy} /></label>
          <label className="editor-row"><span>Advanced</span><Input value={programs.advanced} onChange={e => change("advanced", e.target.value)} disabled={busy} /></label>
        </>}
        <div className="editor-row"><span>Social</span><div className="time-range"><EventTimePicker label="Social dance start" value={socialStart} onChange={setSocialStart} disabled={busy} required={mode !== "none"} /><span aria-hidden="true">–</span><EventTimePicker label="Social dance end" value={endTime} onChange={setEndTime} disabled={busy} /></div></div>
        <label className="editor-row editor-row-top"><span>Notes</span><Textarea rows={2} placeholder="Optional" value={programs.notes} onChange={e => change("notes", e.target.value)} disabled={busy} /></label>
      </div>
      {error && <p role="alert" className="event-error">{error}</p>}
      <div className="normal-event-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button type="button" variant="outline" onClick={() => void save(!event.published)} disabled={busy}>{event.published ? "Unpublish" : "Publish"}</Button><Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>{event.id && onDelete && <span className="ml-auto"><DeleteEventButton noun="lesson" onDelete={onDelete} disabled={busy} onBusyChange={value => { saving.current = value; setBusy(value) }} /></span>}</div>
    </form> : <Button asChild variant="ghost" className="normal-event-summary"><div role="button" tabIndex={0} onClick={e => { e.preventDefault(); onEdit() }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onEdit() } }}>
      <DateTile date={event.date} />
      <div className="event-row-text">
        <span className="event-row-title"><strong>{formatEventLocation(event)}</strong>{!event.published && <DraftBadge />}</span>
        <LessonTimes event={event} /><div className="schedule-program">{event.description ? <Markdown>{event.description}</Markdown> : event.lessonEndTime && <p>Lesson to be announced</p>}</div>
      </div>
    </div></Button>}
  </article>
}

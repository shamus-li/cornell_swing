import { useEffect, useRef, useState, type FormEvent } from "react"
import { ClockIcon, MapPinIcon, XIcon } from "lucide-react"
import { Input } from "../../../check-in/src/components/ui/input"
import { FloatingField, floatingInputClass } from "../../../check-in/src/components/ui/floating-field"
import { Button } from "../../../check-in/src/components/ui/button"
import { largeButtonClass } from "../../../check-in/src/lib/sizes"
import { formatEventLocation, formatEventDate, formatEventTime, hasEventDetails, scheduleTitle, todayInNewYork, type EventRecord } from "../../events/model"
import { EventLocation } from "../../events/EventLocation"
import { Markdown } from "../../events/Markdown"
import { DateTile } from "../../events/DateTile"

export type EventSnapshot = { events: EventRecord[]; today: string }

function CalendarLinks({ event, scope = "page" }: { event: EventRecord; scope?: "page" | "rsvp" }) {
  if (event.kind !== "special" || !event.date || !event.startTime || !event.endTime) return null
  const stamp = (time: string) => `${event.date.replaceAll("-", "")}T${time.replace(":", "")}00`
  const query = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${stamp(event.startTime)}/${stamp(event.endTime)}`, ctz: "America/New_York", location: formatEventLocation(event), details: event.description })
  const id = `calendar-${scope}-${event.id}`
  return <>
    <Button variant="outline" popoverTarget={id} style={{ anchorName: `--${id}` }}>Add to calendar</Button>
    <div id={id} popover="auto" className="calendar-menu" style={{ positionAnchor: `--${id}` }}>
      <a href={`/api/events/${event.id}/calendar`}>Apple / Outlook (.ics)</a>
      <a href={`https://calendar.google.com/calendar/render?${query}`} target="_blank" rel="noreferrer">Google Calendar ↗</a>
    </div>
  </>
}

function RsvpDialog({ event, onClose }: { event: EventRecord; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<"idle" | "saving" | "done">("idle")
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    // showModal focuses the first control, the close button; start on the name field instead.
    element.querySelector<HTMLInputElement>('input[name="name"]')!.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { element.close(); document.body.style.overflow = previous }
  }, [])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const body = JSON.stringify({ name, email })
    setState("saving"); setError("")
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      let data: { error?: string }
      try {
        response = await fetch(`/api/events/${event.id}/rsvp`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
        data = await response.json()
      } catch (err) {
        if (attempt === 0 && err instanceof TypeError) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          continue
        }
        setError("Check your connection and try again.")
        setState("idle"); return
      }
      if (response.ok) setState("done")
      else { setError(data.error || "Your RSVP could not be saved. Please try again."); setState("idle") }
      return
    }
  }
  return <dialog ref={dialog} className="event-dialog" aria-labelledby="rsvp-title" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    {/* The padding lives on this wrapper so only clicks on the backdrop reach the dialog itself. */}
    <div className="event-dialog-body">
    <Button type="button" variant="ghost" size="icon" className="dialog-close" aria-label="Close RSVP" onClick={onClose}><XIcon /></Button>
    <p className="event-eyebrow">{formatEventDate(event.date, { weekday: "long", month: "long", day: "numeric" })} · {formatEventTime(event)}</p>
    <h2 id="rsvp-title">{state === "done" ? "See you on the dance floor!" : event.title}</h2>
    {state === "done" ? <div className="event-actions"><CalendarLinks event={event} scope="rsvp" /><Button type="button" onClick={onClose}>Done</Button></div> : <>
      <p className="event-muted"><EventLocation event={event} /></p>
      <form onSubmit={submit} className="event-form">
        <FloatingField id="rsvp-name" label="Name" filled={!!name}><Input id="rsvp-name" name="name" className={floatingInputClass} autoComplete="name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></FloatingField>
        <FloatingField id="rsvp-email" label="Email" filled={!!email}><Input id="rsvp-email" name="email" type="email" className={floatingInputClass} autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></FloatingField>
        {error && <p role="alert" className="event-error">{error}</p>}
        <Button type="submit" className={`mt-1 ${largeButtonClass}`} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "RSVP"}</Button>
      </form>
    </>}
    </div>
  </dialog>
}

const nextLesson = ({ events, today }: EventSnapshot) => events.find(event => event.kind === "normal" && event.date >= today)

// The Worker renders this into the hero on each request, like EventSections below it.
export function NextEvent({ events, today }: EventSnapshot) {
  // Special events join once their time and place are announced.
  const event = events.find(event => event.date >= today && (event.kind === "normal" || hasEventDetails(event)))
  if (!event) return null
  return <div className="next-event">
    <p className="next-event-label">Next event</p>
    {event.kind === "special" && <p className="next-event-name">{event.title}</p>}
    <div className="next-event-details is-next">
      <div className="next-event-row">
        <DateTile date={event.date} />
        <div><p className="next-event-title">{formatEventDate(event.date, { weekday: "long", month: "long", day: "numeric" })}</p><p className="event-muted">{formatEventTime(event)}</p></div>
      </div>
      <div className="next-event-row">
        <span className="next-event-icon"><MapPinIcon aria-hidden="true" /></span>
        <p className="next-event-title"><EventLocation event={event} /></p>
      </div>
    </div>
    {event.kind === "normal" && event.description && <div className="next-event-program"><Markdown>{event.description}</Markdown></div>}
  </div>
}

// Luma-style switch between upcoming and past events, shown once any event has passed.
function PastToggle({ showPast, onChange, label }: { showPast: boolean; onChange: (showPast: boolean) => void; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>
    <button type="button" aria-pressed={!showPast} onClick={() => onChange(false)}>Upcoming</button>
    <button type="button" aria-pressed={showPast} onClick={() => onChange(true)}>Past</button>
  </div>
}

export function EventSections(snapshot: EventSnapshot) {
  const { events, today } = snapshot
  const [selected, setSelected] = useState<EventRecord | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [showPastSpecial, setShowPastSpecial] = useState(false)
  const next = nextLesson(snapshot)
  const special = events.filter(event => event.kind === "special")
  // Undated special events count as upcoming; they are listed last.
  const pastSpecial = special.filter(event => event.date && event.date < today)
  const upcomingSpecial = special.filter(event => !event.date || event.date >= today)
  const nextSpecial = upcomingSpecial.find(event => event.date)
  const lessons = events.filter(event => event.kind === "normal")
  const earlier = lessons.filter(event => event.date < today)
  const upcoming = lessons.filter(event => event.date >= today)
  const lesson = (event: EventRecord) => <article key={event.id} id={`event-${event.id}`} className={`schedule-row${event === next ? " is-next" : ""}`}>
    <DateTile date={event.date} />
    <div className="schedule-content">
      <p className="schedule-location icon-line"><MapPinIcon aria-hidden="true" /><span><EventLocation event={event} /></span></p>
      <div className="schedule-program">{event.description ? <Markdown>{event.description}</Markdown> : <p>Lesson TBA</p>}</div>
    </div>
  </article>
  return <>
    <section id="special-events" className="section" aria-labelledby="special-events-title">
      <div className="section-heading">
        <h2 id="special-events-title">Special events</h2>
        {pastSpecial.length > 0 && <PastToggle showPast={showPastSpecial} onChange={setShowPastSpecial} label="Special events to show" />}
      </div>
      <div className="event-list">{(showPastSpecial ? [...pastSpecial].reverse() : upcomingSpecial).map(event => <article key={event.id} id={`event-${event.id}`} className={`event-row${event === nextSpecial ? " is-next" : ""}`}>
        <DateTile date={event.date} />
        <div className="event-content">
          <h3>{event.title}</h3>
          {(event.location || event.room || event.startTime) && <div className="event-meta"><p className="icon-line"><ClockIcon aria-hidden="true" /><span>{formatEventTime(event)}</span></p><p className="icon-line"><MapPinIcon aria-hidden="true" /><span><EventLocation event={event} /></span></p></div>}
          <Markdown>{event.description}</Markdown>
          <div className="event-actions">{(!event.date || event.date >= today) && hasEventDetails(event) && <Button onClick={() => setSelected(event)}>RSVP</Button>}<CalendarLinks event={event} /></div>
        </div>
      </article>)}</div>
      {!showPastSpecial && upcomingSpecial.length === 0 && <p className="event-muted">Events will be announced here.</p>}
    </section>
    <section id="schedule" className="section" aria-labelledby="normal-events-title">
      <div className="section-heading">
        <h2 id="normal-events-title">{scheduleTitle(events, today)}</h2>
        {earlier.length > 0 && <PastToggle showPast={showPast} onChange={setShowPast} label="Weeks to show" />}
      </div>
      <p className="schedule-times"><span>Lesson 8:00–9:00 PM</span> · <span>Social dance 9:00–10:00 PM</span></p>
      <div className="schedule-list">{(showPast ? [...earlier].reverse() : upcoming).map(lesson)}</div>
      {!showPast && upcoming.length === 0 && <p className="event-muted">Events will be announced here.</p>}
    </section>
    {selected && <RsvpDialog event={selected} onClose={() => setSelected(null)} />}
  </>
}

export function useEvents(initial?: EventSnapshot) {
  const [snapshot, setSnapshot] = useState<EventSnapshot>(initial ?? { events: [], today: todayInNewYork() })
  const [error, setError] = useState("")
  useEffect(() => {
    if (initial) return
    const controller = new AbortController()
    fetch("/api/events", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Events could not be loaded. Please refresh to try again.")
      const data = await response.json() as { events: EventRecord[] }
      setSnapshot({ events: data.events, today: todayInNewYork() })
    }).catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Events could not be loaded.") })
    return () => controller.abort()
  }, [initial])
  return { snapshot, error }
}

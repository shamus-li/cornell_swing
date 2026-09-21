import { useEffect, useRef, useState, type FormEvent } from "react"
import { Input } from "../../../check-in/src/components/ui/input"
import { Button } from "../../../check-in/src/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu"
import { formatEventLocation, formatEventDate, todayInNewYork, type EventRecord } from "../../events/model"
import { EventLocation } from "../../events/EventLocation"
import { Markdown } from "../../events/Markdown"

export type EventSnapshot = { events: EventRecord[]; today: string }
const formatTime = (time: string) => new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
export const eventTime = (event: EventRecord) => event.startTime ? `${formatTime(event.startTime)}${event.endTime ? `–${formatTime(event.endTime)}` : ""}` : "TBA"

export function CalendarLinks({ event, scope = "page" }: { event: EventRecord; scope?: "page" | "rsvp" }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  if (event.kind !== "special" || !event.date || !event.startTime || !event.endTime) return null
  const stamp = (time: string) => `${event.date.replaceAll("-", "")}T${time.replace(":", "")}00`
  const query = new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${stamp(event.startTime)}/${stamp(event.endTime)}`, ctz: "America/New_York", location: formatEventLocation(event), details: event.description })
  const id = `calendar-${scope}-${event.id}`
  return <div ref={setContainer}><DropdownMenu modal={false}>
    <DropdownMenuTrigger id={id} aria-controls={`${id}-menu`} asChild><Button variant="outline">Add to calendar</Button></DropdownMenuTrigger>
    <DropdownMenuContent id={`${id}-menu`} aria-labelledby={id} container={container} className="w-48">
      <DropdownMenuItem asChild><a href={`/api/events/${event.id}/calendar`}>Apple / Outlook (.ics)</a></DropdownMenuItem>
      <DropdownMenuItem asChild><a href={`https://calendar.google.com/calendar/render?${query}`} target="_blank" rel="noreferrer">Google Calendar ↗</a></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></div>
}

function RsvpDialog({ event, onClose }: { event: EventRecord; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<"idle" | "saving" | "done">("idle")
  const [error, setError] = useState("")
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { element.close(); document.body.style.overflow = previous }
  }, [])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = JSON.stringify({ name: form.get("name"), email: form.get("email") })
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
    <Button type="button" variant="ghost" size="icon" className="dialog-close" aria-label="Close RSVP" onClick={onClose}>×</Button>
    <p className="event-eyebrow">{formatEventDate(event.date)} · {eventTime(event)}</p>
    <h2 id="rsvp-title">{state === "done" ? "See you on the dance floor!" : event.title}</h2>
    {state === "done" ? <div className="event-actions"><CalendarLinks event={event} scope="rsvp" /><Button type="button" onClick={onClose}>Done</Button></div> : <>
      <p className="event-muted"><EventLocation event={event} /></p>
      <form onSubmit={submit} className="event-form">
        <label>Name<Input name="name" autoComplete="name" required maxLength={120} autoFocus /></label>
        <label>Email<Input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        {error && <p role="alert" className="event-error">{error}</p>}
        <Button type="submit" size="lg" className="mt-1" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "RSVP"}</Button>
      </form>
    </>}
  </dialog>
}

export function EventSections({ events, today }: EventSnapshot) {
  const [selected, setSelected] = useState<EventRecord | null>(null)
  return <>
    {(["normal", "special"] as const).map(kind => <section id={kind === "normal" ? "schedule" : "special-events"} className="section" key={kind} aria-labelledby={`${kind}-events-title`}>
      <h2 id={`${kind}-events-title`}>{kind === "normal" ? "Fall 2026 schedule" : "Special events"}</h2>
      {kind === "normal" && <>
        <p className="schedule-times">Lesson 8:00–9:00 PM · Social dance 9:00–10:00 PM</p>
        <div className="schedule-header" aria-hidden="true"><span>Date</span><span>Location</span><span>Lesson program</span></div>
      </>}
      <div className={kind === "normal" ? "schedule-list" : "event-list"}>{events.filter(event => event.kind === kind).map(event => kind === "normal" ? <article key={event.id} id={`event-${event.id}`} className={`schedule-row${event.date && event.date < today ? " is-past" : ""}`}>
        <time dateTime={event.date} className="schedule-date">{formatEventDate(event.date)}</time>
        <div className="schedule-location"><EventLocation event={event} /></div>
        <div className="schedule-program">{event.description ? <Markdown>{event.description}</Markdown> : <p>TBA</p>}</div>
      </article> : <article key={event.id} id={`event-${event.id}`} className={`event-row${event.date && event.date < today ? " is-past" : ""}`}>
        <time dateTime={event.date} className="event-date">{formatEventDate(event.date)}</time>
        <div className="event-content">
          <h3>{event.title}</h3>
          <p className="event-meta">{!event.location && !event.room && !event.startTime ? "TBA" : <><EventLocation event={event} /><br />{eventTime(event)}</>}</p>
          <Markdown>{event.description}</Markdown>
          <div className="event-actions">{(!event.date || event.date >= today) && <Button onClick={() => setSelected(event)}>RSVP</Button>}<CalendarLinks event={event} /></div>
        </div>
      </article>)}</div>
      {!events.some(event => event.kind === kind) && <p className="event-muted">Events will be announced here.</p>}
    </section>)}
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

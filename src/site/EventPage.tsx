import { EventSchedule } from "../events/EventSchedule"
import { useState } from "react"
import { ClockIcon, MapPinIcon, TicketIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { formatEventDate, formatEventDayRange, formatEventPrices, formatEventTime, hasEventDetails, isUpcoming, type EventRecord } from "../events/model"
import { LessonTimes } from "../events/LessonTimes"
import { EventLocation } from "../events/EventLocation"
import { Markdown } from "../events/Markdown"
import { DateTile } from "../events/DateTile"
import { CalendarLinks, RsvpDialog } from "./components/Events"

export type EventPageData = { event: EventRecord; today: string }

// Phones get the system share sheet; other browsers copy the link.
function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)
  async function share() {
    if (navigator.share) { await navigator.share({ title, url: location.href }).catch(() => {}); return }
    await navigator.clipboard.writeText(location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return <Button type="button" variant="outline" onClick={() => void share()}>{copied ? "Link copied" : "Share"}</Button>
}

export function EventPage({ event, today }: EventPageData) {
  const [rsvping, setRsvping] = useState(false)
  const prices = formatEventPrices(event)
  const upcoming = isUpcoming(event, today)
  return <>
    <article className="event-row event-page-event">
      <DateTile date={event.date} />
      <div className="event-content">
        <h1>{event.title}</h1>
        <div className="event-meta">
          {event.moreDays?.length
            ? <p className="icon-line"><ClockIcon aria-hidden="true" /><span>{formatEventDayRange(event)}</span></p>
            : <p className="icon-line"><ClockIcon aria-hidden="true" /><span>{event.date && formatEventDate(event.date, { weekday: "long", month: "long", day: "numeric" })}{event.kind !== "normal" && `${event.date ? " · " : ""}${formatEventTime(event)}`}</span></p>}
          {event.kind === "normal" && <LessonTimes event={event} />}
          {(event.location || event.room) && <p className="icon-line"><MapPinIcon aria-hidden="true" /><span><EventLocation event={event} /></span></p>}
          {prices.length > 0 && <p className="icon-line"><TicketIcon aria-hidden="true" /><span>{prices.join(" · ")}</span></p>}
        </div>
        <EventSchedule event={event} />
        <Markdown>{event.description}</Markdown>
        {!upcoming && <p className="event-muted">This event has passed.</p>}
        <div className="event-actions">
          {upcoming && event.kind === "special" && hasEventDetails(event) && <Button onClick={() => setRsvping(true)}>RSVP</Button>}
          {upcoming && <CalendarLinks event={event} />}
          <ShareButton title={event.title} />
        </div>
      </div>
    </article>
    {rsvping && <RsvpDialog event={event} onClose={() => setRsvping(false)} />}
  </>
}

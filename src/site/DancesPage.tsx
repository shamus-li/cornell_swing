import { useState } from "react"
import { ClockIcon, MapPinIcon, TicketIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { formatEventDate, formatEventLocation, formatEventPrices, formatEventTime, hasEventDetails, nightSpan, type EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { LessonTimes } from "../events/LessonTimes"
import { DateTile } from "../events/DateTile"
import { RequestEvent } from "./RequestEvent"

// `unavailable` is set when the server could not read the events, so the page says so instead of "no dances".
export type DanceSnapshot = { events: EventRecord[]; outside: OutsideEvent[]; today: string; unavailable?: boolean }

type Listing = { key: string; date: string; startTime: string; title: string; group: string; styles: string[]; time: string; lesson?: EventRecord; venue: string; price: string; href: string; action: string; ours: boolean }

function listings({ events, outside, today }: DanceSnapshot): Listing[] {
  const ours = events.filter(event => event.date >= today).map((event): Listing => ({
    key: event.id, date: event.date, startTime: nightSpan(event).startTime, title: event.title, group: "Swing Syndicate", styles: ["Swing"],
    time: formatEventTime(event), ...(event.kind === "normal" && { lesson: event }), venue: formatEventLocation(event), price: formatEventPrices(event).join(" · "),
    href: `/#event-${event.id}`, action: event.kind === "special" && hasEventDetails(event) ? "RSVP" : "Details", ours: true,
  }))
  const theirs = outside.filter(event => event.date >= today).map((event): Listing => ({
    key: event.id, date: event.date, startTime: event.startTime, title: event.title, group: event.groupName, styles: event.styles,
    time: formatEventTime(event), venue: event.venue, price: event.price, href: event.url, action: "Details ↗", ours: false,
  }))
  return [...ours, ...theirs].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title))
}

export function DancesPage(snapshot: DanceSnapshot) {
  // Nothing chosen shows every dance; an event with several styles shows when any of them is chosen.
  const [chosen, setChosen] = useState<string[]>([])
  const all = listings(snapshot)
  const styles = [...new Set(all.flatMap(listing => listing.styles))]
  const shown = all.filter(listing => !chosen.length || listing.styles.some(style => chosen.includes(style)))
  const months = new Map<string, Listing[]>()
  for (const listing of shown) {
    const month = formatEventDate(listing.date, { month: "long", year: "numeric" })
    months.set(month, [...months.get(month) ?? [], listing])
  }
  return <>
    <div className="dances-heading">
      <h1>Community Dance Events</h1>
      <div className="dances-toolbar">
        {!snapshot.unavailable && styles.length > 1 && <div className="filter-chips" role="group" aria-label="Dance styles">
        <button type="button" aria-pressed={!chosen.length} onClick={() => setChosen([])}>All</button>
        {styles.map(name => <button key={name} type="button" aria-pressed={chosen.includes(name)} onClick={() => setChosen(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])}>{name}</button>)}
        </div>}
        <RequestEvent />
      </div>
    </div>
    {snapshot.unavailable ? <p className="event-muted" role="status">Events couldn't be loaded. Refresh the page to try again.</p> : <>
      {[...months].map(([month, items]) => <section key={month} aria-label={month}>
        <h2 className="dances-month">{month}</h2>
        {items.map(listing => <article key={listing.key} className={`event-row dance-row${listing.ours ? " is-ours" : ""}`}>
          <DateTile date={listing.date} />
          <div className="event-content">
            <h3>{listing.title}</h3>
            <p className="dance-group">{listing.group} · {listing.styles.join(", ")}</p>
            <div className="event-meta">
              {listing.lesson ? <LessonTimes event={listing.lesson} /> : <p className="icon-line"><ClockIcon aria-hidden="true" /><span>{formatEventDate(listing.date, { weekday: "long" })} · {listing.time}</span></p>}
              {listing.venue && listing.venue !== "TBA" && <p className="icon-line"><MapPinIcon aria-hidden="true" /><span>{listing.venue}</span></p>}
              {listing.price && <p className="icon-line"><TicketIcon aria-hidden="true" /><span>{listing.price}</span></p>}
            </div>
            {listing.href && <div className="event-actions"><Button asChild variant={listing.ours ? "default" : "outline"}><a href={listing.href} {...!listing.ours && { target: "_blank", rel: "noreferrer" }}>{listing.action}</a></Button></div>}
          </div>
        </article>)}
      </section>)}
      {!shown.length && <p className="event-muted">No upcoming dances are listed{chosen.length ? " for these styles" : ""}.</p>}
    </>}
  </>
}

import { useState } from "react"
import { ClockIcon, EyeOffIcon, MapPinIcon, TicketIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { formatEventDate, formatEventLocation, formatEventPrices, formatEventTime, formatLessonSchedule, hasEventDetails, type EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { DateTile } from "../events/DateTile"
import { RequestEvent } from "./RequestEvent"

// `unavailable` is set when the server could not read the events, so the page says so instead of "no dances".
export type DanceSnapshot = { events: EventRecord[]; outside: OutsideEvent[]; today: string; unavailable?: boolean }

type Listing = { key: string; date: string; startTime: string; title: string; group: string; styles: string[]; time: string; venue: string; price: string; href: string; action: string; ours: boolean }

function listings({ events, outside, today }: DanceSnapshot): Listing[] {
  const ours = events.filter(event => event.date >= today).map((event): Listing => ({
    key: event.id, date: event.date, startTime: event.startTime, title: event.title, group: "Swing Syndicate", styles: ["Swing"],
    time: event.kind === "normal" ? formatLessonSchedule(event).join(" · ") : formatEventTime(event), venue: formatEventLocation(event), price: formatEventPrices(event).join(" · "),
    href: `/#event-${event.id}`, action: event.kind === "special" && hasEventDetails(event) ? "RSVP" : "Details", ours: true,
  }))
  const theirs = outside.filter(event => event.date >= today).map((event): Listing => ({
    key: event.id, date: event.date, startTime: event.startTime, title: event.title, group: event.groupName, styles: event.styles,
    time: formatEventTime(event), venue: event.venue, price: event.price, href: event.url, action: "Details ↗", ours: false,
  }))
  return [...ours, ...theirs].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title))
}

export function DancesPage(snapshot: DanceSnapshot) {
  // Clicking a style shows only the chosen styles, clicking it again hides that style, and a third click clears it.
  const [filters, setFilters] = useState<Record<string, "only" | "hide">>({})
  const all = listings(snapshot)
  const styles = [...new Set(all.flatMap(listing => listing.styles))]
  const only = styles.filter(name => filters[name] === "only")
  // An event with several styles shows while any of them is chosen, or not hidden when nothing is chosen.
  const shown = all.filter(listing => listing.styles.some(style => filters[style] !== "hide" && (!only.length || only.includes(style))))
  const cycle = (name: string) => setFilters(({ [name]: current, ...rest }) => current === "hide" ? rest : { ...rest, [name]: current === "only" ? "hide" : "only" })
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
        <button type="button" aria-pressed={!Object.keys(filters).length} onClick={() => setFilters({})}>All</button>
        {styles.map(name => <button key={name} type="button" aria-pressed={filters[name] === "only"} data-hidden={filters[name] === "hide" || undefined} aria-label={filters[name] === "hide" ? `${name}, hidden` : undefined} onClick={() => cycle(name)}>{filters[name] === "hide" && <EyeOffIcon aria-hidden="true" />}{name}</button>)}
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
              <p className="icon-line"><ClockIcon aria-hidden="true" /><span>{formatEventDate(listing.date, { weekday: "long" })} · {listing.time}</span></p>
              {listing.venue && listing.venue !== "TBA" && <p className="icon-line"><MapPinIcon aria-hidden="true" /><span>{listing.venue}</span></p>}
              {listing.price && <p className="icon-line"><TicketIcon aria-hidden="true" /><span>{listing.price}</span></p>}
            </div>
            {listing.href && <div className="event-actions"><Button asChild variant={listing.ours ? "default" : "outline"}><a href={listing.href} {...!listing.ours && { target: "_blank", rel: "noreferrer" }}>{listing.action}</a></Button></div>}
          </div>
        </article>)}
      </section>)}
      {!shown.length && <p className="event-muted">No upcoming dances are listed{Object.keys(filters).length ? " for these styles" : ""}.</p>}
    </>}
  </>
}

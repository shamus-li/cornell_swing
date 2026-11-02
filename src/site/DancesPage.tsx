import { Fragment, useState, type ReactNode } from "react"
import { ClockIcon, MapPinIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { formatEventDate, formatEventLocation, formatEventPrices, formatEventTime, hasEventDetails, mapsSearchUrl, nightSpan, type EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { LessonTimes } from "../events/LessonTimes"
import { DateTile } from "../events/DateTile"
import { EventLocation } from "../events/EventLocation"
import { Markdown } from "../events/Markdown"
import { RequestEvent } from "./RequestEvent"

// `unavailable` is set when the server could not read the events, so the page says so instead of "no dances".
export type DanceSnapshot = { events: EventRecord[]; outside: OutsideEvent[]; today: string; unavailable?: boolean }

type Listing = { key: string; date: string; startTime: string; title: string; group: string; styles: string[]; time: string; lesson?: EventRecord; place: ReactNode; hasPlace: boolean; price: string; href: string; rsvp: boolean; nearby: boolean; ours: boolean }

// Places close enough to count as Ithaca rather than a trip.
const ithacaArea = ["Ithaca", "Newfield", "Enfield", "Danby", "Caroline", "Dryden", "Freeville", "Lansing", "Groton", "Trumansburg", "Ulysses"]

function OutsidePlace({ event }: { event: OutsideEvent }) {
  const named = event.venue.includes(event.city)
  const place = [event.venue, event.city !== "Ithaca" && !named && event.city].filter(Boolean).join(", ") || event.city
  return <a href={mapsSearchUrl(named ? event.venue : `${event.venue ? `${event.venue}, ` : ""}${event.city}`)} target="_blank" rel="noreferrer">{place}</a>
}

function listings({ events, outside, today }: DanceSnapshot): Listing[] {
  const ours = events.filter(event => event.date >= today).map((event): Listing => ({
    key: event.id, date: event.date, startTime: nightSpan(event).startTime, title: event.title, group: "Swing Syndicate", styles: ["Swing"],
    time: formatEventTime(event), ...(event.kind === "normal" && { lesson: event }), place: <EventLocation event={event} />, hasPlace: formatEventLocation(event) !== "TBA", price: formatEventPrices(event).join(" · "),
    href: `/events/${event.slug}`, rsvp: event.kind === "special" && hasEventDetails(event), nearby: true, ours: true,
  }))
  const theirs = outside.filter(event => event.date >= today).map((event): Listing => ({
    key: event.id, date: event.date, startTime: event.startTime, title: event.title, group: event.groupName, styles: event.styles,
    time: formatEventTime(event), place: <OutsidePlace event={event} />, hasPlace: true, price: event.price, href: event.url, rsvp: false, nearby: ithacaArea.includes(event.city), ours: false,
  }))
  return [...ours, ...theirs].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title))
}

export function DancesPage(snapshot: DanceSnapshot) {
  const [nearby, setNearby] = useState(true)
  // Nothing chosen shows every dance; an event with several styles shows when any of them is chosen.
  const [chosen, setChosen] = useState<string[]>([])
  const changeArea = (next: boolean) => { setNearby(next); setChosen([]) }
  const all = listings(snapshot).filter(listing => !nearby || listing.nearby)
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
        {!snapshot.unavailable && <div className="segmented" role="group" aria-label="Area">
          <button type="button" aria-pressed={nearby} onClick={() => changeArea(true)}>Ithaca</button>
          <button type="button" aria-pressed={!nearby} onClick={() => changeArea(false)}>Upstate</button>
        </div>}
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
          <DateTile date={listing.date} top="weekday" />
          <div className="event-content">
            <p className="dance-styles">{listing.styles.map((style, index) => <Fragment key={style}>{index > 0 && " · "}<span className="nowrap">{style}</span></Fragment>)}</p>
            <h3>{listing.href ? <a href={listing.href} {...!listing.ours && { target: "_blank", rel: "noreferrer" }}>{listing.title}{!listing.ours && <span className="dance-external" aria-label=", opens the group's site"> ↗</span>}</a> : listing.title}</h3>
            <div className="event-meta">
              {listing.lesson ? <LessonTimes event={listing.lesson} /> : <p className="icon-line"><ClockIcon aria-hidden="true" /><span>{listing.time}</span></p>}
              {listing.hasPlace && <p className="icon-line"><MapPinIcon aria-hidden="true" /><span>{listing.place}</span></p>}
            </div>
            <p className="dance-facts">{listing.group}{listing.price && ` · ${listing.price}`}</p>
            {listing.lesson && (listing.lesson.description || listing.lesson.lessonEndTime) && <div className="dance-program">{listing.lesson.description ? <Markdown>{listing.lesson.description}</Markdown> : <p>Lesson TBA</p>}</div>}
            {listing.rsvp && <div className="event-actions"><Button asChild><a href={listing.href}>RSVP</a></Button></div>}
          </div>
        </article>)}
      </section>)}
      {!shown.length && <p className="event-muted">No upcoming dances are listed{chosen.length ? " for these styles" : ""}.</p>}
    </>}
  </>
}

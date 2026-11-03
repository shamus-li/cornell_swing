import { Fragment, useState } from "react"
import { ClockIcon, MapPinIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { ToggleChoice, ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"
import { danceStyles, isUpcoming, formatEventDate, formatEventDayRange, formatEventLocation, formatEventPrices, formatEventTime, hasEventDetails, ithacaArea, nightSpan, type EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { LessonTimes } from "../events/LessonTimes"
import { DateTile } from "../events/DateTile"
import { EventLocation } from "../events/EventLocation"
import { Markdown } from "../events/Markdown"
import { RequestEvent } from "./RequestEvent"

// `unavailable` is set when the server could not read the events, so the page says so instead of "no dances".
export type DanceSnapshot = { events: EventRecord[]; outside: OutsideEvent[]; today: string; unavailable?: boolean }

function listing(event: EventRecord | OutsideEvent) {
  const ours = event.kind !== "outside"
  return {
    key: event.id, date: event.date, startTime: nightSpan(event).startTime, title: event.title, group: ours ? "Swing Syndicate" : event.groupName, styles: event.styles,
    time: event.lastDate ? formatEventDayRange(event) : formatEventTime(event), lesson: event.kind === "normal" ? event : undefined, place: <EventLocation event={event} />, hasPlace: formatEventLocation(event) !== "TBA", price: ours ? formatEventPrices(event).join(" · ") : event.price,
    href: ours ? `/events/${event.slug}` : event.url, rsvp: event.kind === "special" && hasEventDetails(event), nearby: ithacaArea.includes(event.city), ours,
  }
}
type Listing = ReturnType<typeof listing>

const listings = ({ events, outside, today }: DanceSnapshot) => [...events, ...outside].filter(event => event.date && isUpcoming(event, today)).map(listing)
  .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title))

// Lit when no style is chosen; choosing it clears the others.
const allStyles = "all"

export function DancesPage(snapshot: DanceSnapshot) {
  const [nearby, setNearby] = useState(true)
  // Nothing chosen shows every dance; an event with several styles shows when any of them is chosen.
  const [chosen, setChosen] = useState<string[]>([])
  const everywhere = listings(snapshot)
  const all = everywhere.filter(listing => !nearby || listing.nearby)
  // The buttons stay the same in both areas so nothing moves; styles with nothing in this area are grayed out.
  const styles = danceStyles.filter(style => everywhere.some(listing => listing.styles.includes(style)))
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
        {!snapshot.unavailable && <ToggleChoice variant="segmented" aria-label="Area" value={nearby ? "ithaca" : "upstate"} onValueChange={area => setNearby(area === "ithaca")}>
          <ToggleGroupItem value="ithaca">Ithaca</ToggleGroupItem>
          <ToggleGroupItem value="upstate">All upstate</ToggleGroupItem>
        </ToggleChoice>}
        {!snapshot.unavailable && styles.length > 1 && <ToggleGroup variant="chips" multiple aria-label="Dance styles" value={chosen.length ? chosen : [allStyles]} onValueChange={next => setChosen(next.includes(allStyles) && chosen.length ? [] : next.filter(item => item !== allStyles))}>
        <ToggleGroupItem value={allStyles}>All</ToggleGroupItem>
        {styles.map(name => <ToggleGroupItem key={name} value={name} disabled={!chosen.includes(name) && !all.some(listing => listing.styles.includes(name))}>{name}</ToggleGroupItem>)}
        </ToggleGroup>}
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

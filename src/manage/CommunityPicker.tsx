import { useState } from "react"
import { Input } from "../components/ui/input"
import { ToggleChoice, ToggleGroupItem } from "../components/ui/toggle-group"
import { formatEventDate, formatEventDayRange, ithacaArea } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { StyleFilter } from "../events/StylePicker"
import { ToggleRow } from "./ToggleRow"

const nearIthaca = (event: OutsideEvent) => ithacaArea.includes(event.city)
const when = (event: OutsideEvent) => event.lastDate ? formatEventDayRange(event) : formatEventDate(event.date, { weekday: "short", month: "short", day: "numeric" })

// Events already in the email stay listed whatever the filters say, so they can always be taken back out. They move
// to the top when a filter or search changes, never on the click itself, so a row doesn't jump out from under the pointer.
export function CommunityPicker({ events, chosen, onChange }: { events: OutsideEvent[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  const [nearby, setNearby] = useState(true)
  const [styles, setStyles] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [first, setFirst] = useState(chosen)
  const inArea = events.filter(event => !nearby || nearIthaca(event))
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (event: OutsideEvent) => inArea.includes(event)
    && (!styles.length || event.styles.some(style => styles.includes(style)))
    && words.every(word => [event.title, event.groupName, event.location, event.city].join(" ").toLowerCase().includes(word))
  const shown = events.filter(event => first.includes(event.id) || chosen.includes(event.id) || matches(event))
  const ordered = [...shown.filter(event => first.includes(event.id)), ...shown.filter(event => !first.includes(event.id))]

  return <fieldset className="newsletter-field"><legend>Community events</legend>
    <div className="community-filters">
      <Input type="search" aria-label="Search community events" placeholder="Search community events" value={search} onChange={e => { setSearch(e.target.value); setFirst(chosen) }} />
      <ToggleChoice variant="segmented" aria-label="Area" value={nearby ? "ithaca" : "upstate"} onValueChange={area => { setNearby(area === "ithaca"); setFirst(chosen) }}>
        <ToggleGroupItem value="ithaca">Ithaca</ToggleGroupItem>
        <ToggleGroupItem value="upstate">All upstate</ToggleGroupItem>
      </ToggleChoice>
      <StyleFilter events={events} available={inArea} chosen={styles} onChange={next => { setStyles(next); setFirst(chosen) }} />
    </div>
    {ordered.length > 0 && <ul className="newsletter-rows">{ordered.map(event => <li key={event.id}>
      <ToggleRow on={chosen.includes(event.id)} onChange={on => onChange(on ? [...chosen, event.id] : chosen.filter(id => id !== event.id))}>
        <span>{event.title}</span><span className="event-muted">{when(event)} · {event.groupName}{nearIthaca(event) ? "" : ` · ${event.city}`}</span>
      </ToggleRow>
    </li>)}</ul>}
    {!events.some(matches) && <p className="event-muted community-none">No matching events.</p>}
  </fieldset>
}

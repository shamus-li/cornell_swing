import { useState } from "react"
import { ToggleChoice, ToggleGroupItem } from "../components/ui/toggle-group"
import { formatEventDate, formatEventDayRange, ithacaArea } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { StyleFilter } from "../events/StylePicker"
import { ToggleRow } from "./ToggleRow"

const nearIthaca = (event: OutsideEvent) => ithacaArea.includes(event.city)
const when = (event: OutsideEvent) => event.lastDate ? formatEventDayRange(event) : formatEventDate(event.date, { weekday: "short", month: "short", day: "numeric" })

// Events already in the email stay listed whatever the filters say, so they can always be taken back out.
export function CommunityPicker({ events, chosen, onChange }: { events: OutsideEvent[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  const [nearby, setNearby] = useState(true)
  const [styles, setStyles] = useState<string[]>([])
  const inArea = events.filter(event => !nearby || nearIthaca(event))
  const shown = events.filter(event => chosen.includes(event.id) || (inArea.includes(event) && (!styles.length || event.styles.some(style => styles.includes(style)))))

  return <fieldset className="newsletter-field"><legend>Community events</legend>
    <div className="community-filters">
      <ToggleChoice variant="segmented" aria-label="Area" value={nearby ? "ithaca" : "upstate"} onValueChange={area => setNearby(area === "ithaca")}>
        <ToggleGroupItem value="ithaca">Ithaca</ToggleGroupItem>
        <ToggleGroupItem value="upstate">All upstate</ToggleGroupItem>
      </ToggleChoice>
      <StyleFilter events={events} available={inArea} chosen={styles} onChange={setStyles} />
    </div>
    {shown.length ? <ul className="newsletter-rows">{shown.map(event => <li key={event.id}>
      <ToggleRow on={chosen.includes(event.id)} onChange={on => onChange(on ? [...chosen, event.id] : chosen.filter(id => id !== event.id))}>
        <span>{event.title}</span><span className="event-muted">{when(event)} · {event.groupName}{nearIthaca(event) ? "" : ` · ${event.city}`}</span>
      </ToggleRow>
    </li>)}</ul> : <p className="event-muted community-none">No matching events.</p>}
  </fieldset>
}

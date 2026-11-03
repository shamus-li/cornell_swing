import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"
import { danceStyles } from "./model"

// One toggle per dance style; an event can have several, kept in the list's order.
export function StylePicker({ value, onChange, disabled }: { value: string[]; onChange: (styles: string[]) => void; disabled?: boolean }) {
  return <ToggleGroup variant="chips" multiple aria-label="Dance styles" disabled={disabled} value={value} onValueChange={next => onChange(danceStyles.filter(style => next.includes(style)))}>
    {danceStyles.map(style => <ToggleGroupItem key={style} value={style}>{style}</ToggleGroupItem>)}
  </ToggleGroup>
}

type Styled = { styles: string[] }

// Lit when no style is chosen; choosing it clears the others.
const allStyles = "all"

// Filters a list by style; nothing chosen shows everything. The buttons come from `events`, so they stay put when another
// filter narrows the list to `available`, and styles with nothing left in it are grayed out.
export function StyleFilter({ events, available, chosen, onChange }: { events: Styled[]; available: Styled[]; chosen: string[]; onChange: (styles: string[]) => void }) {
  const styles = danceStyles.filter(style => events.some(event => event.styles.includes(style)))
  if (styles.length < 2) return null
  return <ToggleGroup variant="chips" multiple aria-label="Dance styles" value={chosen.length ? chosen : [allStyles]} onValueChange={next => onChange(next.includes(allStyles) && chosen.length ? [] : next.filter(item => item !== allStyles))}>
    <ToggleGroupItem value={allStyles}>All</ToggleGroupItem>
    {styles.map(name => <ToggleGroupItem key={name} value={name} disabled={!chosen.includes(name) && !available.some(event => event.styles.includes(name))}>{name}</ToggleGroupItem>)}
  </ToggleGroup>
}

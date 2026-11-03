import { danceStyles } from "./model"

// One toggle per dance style; an event can have several, kept in the list's order.
export function StylePicker({ value, onChange, disabled }: { value: string[]; onChange: (styles: string[]) => void; disabled?: boolean }) {
  return <div className="filter-chips" role="group" aria-label="Dance styles">
    {danceStyles.map(style => <button key={style} type="button" disabled={disabled} aria-pressed={value.includes(style)} onClick={() => onChange(danceStyles.filter(item => item === style ? !value.includes(style) : value.includes(item)))}>{style}</button>)}
  </div>
}

type Styled = { styles: string[] }

// Filters a list by style; nothing chosen shows everything. The buttons come from `events`, so they stay put when another
// filter narrows the list to `available`, and styles with nothing left in it are grayed out.
export function StyleFilter({ events, available, chosen, onChange }: { events: Styled[]; available: Styled[]; chosen: string[]; onChange: (styles: string[]) => void }) {
  const styles = danceStyles.filter(style => events.some(event => event.styles.includes(style)))
  if (styles.length < 2) return null
  return <div className="filter-chips" role="group" aria-label="Dance styles">
    <button type="button" aria-pressed={!chosen.length} onClick={() => onChange([])}>All</button>
    {styles.map(name => <button key={name} type="button" aria-pressed={chosen.includes(name)} disabled={!chosen.includes(name) && !available.some(event => event.styles.includes(name))} onClick={() => onChange(chosen.includes(name) ? chosen.filter(item => item !== name) : [...chosen, name])}>{name}</button>)}
  </div>
}

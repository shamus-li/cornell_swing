import { danceStyles } from "./outside"

// One toggle per dance style; an event can have several, kept in the list's order.
export function StylePicker({ value, onChange, disabled }: { value: string[]; onChange: (styles: string[]) => void; disabled?: boolean }) {
  return <div className="filter-chips" role="group" aria-label="Dance styles">
    {danceStyles.map(style => <button key={style} type="button" disabled={disabled} aria-pressed={value.includes(style)} onClick={() => onChange(danceStyles.filter(item => item === style ? !value.includes(style) : value.includes(item)))}>{style}</button>)}
  </div>
}

import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"
import { danceStyles } from "./model"

// One toggle per dance style; an event can have several, kept in the list's order.
export function StylePicker({ value, onChange, disabled }: { value: string[]; onChange: (styles: string[]) => void; disabled?: boolean }) {
  return <ToggleGroup variant="chips" multiple aria-label="Dance styles" disabled={disabled} value={value} onValueChange={next => onChange(danceStyles.filter(style => next.includes(style)))}>
    {danceStyles.map(style => <ToggleGroupItem key={style} value={style}>{style}</ToggleGroupItem>)}
  </ToggleGroup>
}

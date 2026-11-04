import type { ReactNode } from "react"
import { Check, Plus } from "lucide-react"

// A list row that turns on and off when clicked anywhere on it.
export const ToggleRow = ({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) =>
  <button type="button" className="toggle-row" aria-pressed={on} onClick={() => onChange(!on)}>{on ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}<span className="event-row-text">{children}</span></button>

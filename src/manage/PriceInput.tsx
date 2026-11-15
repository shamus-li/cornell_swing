import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group"
import { isValidPrice } from "../events/model"

// Dollars and cents, tidied to two decimals when the field is left.
export function PriceInput({ label, placeholder, value = "", disabled, onChange }: { label: string; placeholder?: string; value?: string; disabled: boolean; onChange: (value: string) => void }) {
  return <InputGroup>
    <InputGroupAddon>$</InputGroupAddon>
    <InputGroupInput disabled={disabled} aria-label={label} placeholder={placeholder} inputMode="decimal" value={value}
      onChange={e => { if (isValidPrice(e.target.value.replace(/\.$/, ""))) onChange(e.target.value) }}
      onBlur={() => onChange(value.replace(/\.$/, "").replace(/\.(\d)$/, (_, digit) => `.${digit}0`))} />
  </InputGroup>
}

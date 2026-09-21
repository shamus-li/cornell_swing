import { useEffect, useRef, useState } from "react"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "../../check-in/src/components/ui/combobox"

const timeSlots = ["tba", ...Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String(index % 4 * 15).padStart(2, "0")}`)]

function timeLabel(value: string) {
  if (!value || value === "tba") return "TBA"
  const [hour, minute] = value.split(":")
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? "AM" : "PM"}`
}

function parseTime(text: string): string | null {
  if (!text.trim() || /^tba$/i.test(text.trim())) return ""
  const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || "0")
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null
  if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0)
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function EventTimePicker({ value, onChange, label, disabled }: {
  value: string
  onChange: (value: string) => void
  label: string
  disabled?: boolean
}) {
  const [text, setText] = useState(value ? timeLabel(value) : "")
  const input = useRef<HTMLInputElement>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) {
      setText(value ? timeLabel(value) : "")
      input.current?.setCustomValidity("")
    }
  }, [value])

  function edit(next: string) {
    setText(next)
    const parsed = parseTime(next)
    input.current?.setCustomValidity(parsed === null ? "Enter a time such as 8:07 PM or 20:07, or clear it for TBA." : "")
    if (parsed !== null) onChange(parsed)
  }

  const query = text.trim().toLowerCase()
  const suggestions = !query || text === timeLabel(value) ? timeSlots : timeSlots.filter(time => timeLabel(time).toLowerCase().includes(query) || time.includes(query))
  return <Combobox<string> items={timeSlots} filteredItems={suggestions} value={value || "tba"} inputValue={text} disabled={disabled}
    itemToStringLabel={timeLabel}
    onInputValueChange={(next, details) => { if (details.reason === "input-change" || details.reason === "clear-press") edit(next) }}
    onValueChange={next => { if (next !== null) edit(next === "tba" ? "" : timeLabel(next)) }}>
    <ComboboxInput ref={input} aria-label={label} placeholder="TBA" className="w-full" showClear
      onFocus={() => { focused.current = true }}
      onBlur={() => {
        focused.current = false
        const parsed = parseTime(text)
        if (parsed !== null) { onChange(parsed); setText(parsed ? timeLabel(parsed) : "") }
      }} />
    <ComboboxContent><ComboboxEmpty>Type a custom time.</ComboboxEmpty><ComboboxList>
      {(time: string) => <ComboboxItem key={time} value={time}>{timeLabel(time)}</ComboboxItem>}
    </ComboboxList></ComboboxContent>
  </Combobox>
}

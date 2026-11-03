import { useState } from "react"
import { addDays, format, parseISO } from "date-fns"
import { CalendarIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button"
import { Calendar } from "../components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover"

// shadcn/ui Date Picker composition, bound to the event's local YYYY-MM-DD value. `after` limits the
// calendar to later days, and `clearable` adds an X that empties the value.
export function EventDatePicker({ value, onChange, disabled, clearable = false, icon = true, placeholder = "TBA", label = "Date", after }: { value: string; onChange: (value: string) => void; disabled?: boolean; clearable?: boolean; icon?: boolean; placeholder?: string; label?: string; after?: string }) {
  const [open, setOpen] = useState(false)
  const date = value ? parseISO(value) : undefined
  const first = after ? addDays(parseISO(after), 1) : undefined
  return <Popover open={open} onOpenChange={setOpen}>
    <div className="event-date-picker">
      <PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} className={`w-full justify-start border-input px-2.5 text-left text-base font-[450] ${clearable ? "pr-8" : ""} ${date ? "text-foreground" : "text-muted-foreground"}`}>{icon && <CalendarIcon className="text-muted-foreground" />}<span className="sr-only">{label}: </span>{date ? format(date, "EEE, MMM d, yyyy") : placeholder}</Button></PopoverTrigger>
      {clearable && value && <Button type="button" variant="ghost" size="icon-xs" className="event-date-clear" disabled={disabled} aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange("")}><XIcon /></Button>}
    </div>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={date} defaultMonth={date ?? first} disabled={first && { before: first }} onSelect={selected => { if (selected) { onChange(format(selected, "yyyy-MM-dd")); setOpen(false) } }} autoFocus />
    </PopoverContent>
  </Popover>
}

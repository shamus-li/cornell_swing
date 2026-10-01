import { useState } from "react"
import { format, parseISO } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { Calendar } from "../components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover"

// shadcn/ui Date Picker composition, bound to the event's local YYYY-MM-DD value.
export function EventDatePicker({ value, onChange, disabled, allowTba = false }: { value: string; onChange: (value: string) => void; disabled?: boolean; allowTba?: boolean }) {
  const [open, setOpen] = useState(false)
  const date = value ? parseISO(value) : undefined
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} className="w-full justify-start border-input px-3 text-left text-[length:var(--input-font-size)] font-normal text-foreground"><CalendarIcon className="text-muted-foreground" /><span className="sr-only">Date: </span>{date ? format(date, "EEE, MMM d, yyyy") : "TBA"}</Button></PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      {allowTba && <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { onChange(""); setOpen(false) }}>TBA</Button>}
      <Calendar mode="single" selected={date} defaultMonth={date} onSelect={selected => { if (selected) { onChange(format(selected, "yyyy-MM-dd")); setOpen(false) } }} autoFocus />
    </PopoverContent>
  </Popover>
}

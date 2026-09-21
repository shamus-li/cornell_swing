import { useEffect, useRef, useState } from "react"
import { MapPin } from "lucide-react"
import { InputGroupAddon } from "../../check-in/src/components/ui/input-group"
import { Input } from "../../check-in/src/components/ui/input"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "../../check-in/src/components/ui/combobox"
import type { PlaceResult } from "../events/locations"
import { api } from "./api"

const normalizedQuery = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase()

export function LocationPicker({ value, url, room = "", onChange, onRoomChange, disabled = false }: {
  value: string
  url?: string
  room?: string
  onChange: (location: string, locationUrl: string) => void
  onRoomChange: (room: string) => void
  disabled?: boolean
}) {
  const [places, setPlaces] = useState<PlaceResult[]>([])
  const [selected, setSelected] = useState<PlaceResult | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    if (disabled || !query || query.length < 3) return
    const current = new AbortController()
    controller.current = current
    const timer = window.setTimeout(async () => {
      setBusy(true)
      try {
        const data = await api<{ places: PlaceResult[] }>(`/locations?${new URLSearchParams({ q: query })}`, { signal: current.signal }, "Place search is unavailable.")
        if (current.signal.aborted) return
        setPlaces(data.places); setSearched(true); setOpen(data.places.length > 0)
      } catch (err) { if (!current.signal.aborted) setError(err instanceof Error ? err.message : "Place search is unavailable.") }
      finally { if (!current.signal.aborted) setBusy(false) }
    }, 150)
    return () => { window.clearTimeout(timer); current.abort() }
  }, [query, disabled])

  return <div className="grid gap-2">
    <div className="flex items-start gap-2">
      <Combobox<PlaceResult> items={places} filteredItems={places} value={selected} inputValue={value} open={open} disabled={disabled}
        onOpenChange={next => setOpen(next && places.length > 0)}
        onInputValueChange={(text, details) => {
          if (details.reason !== "input-change") return
          const next = normalizedQuery(text)
          if (next !== query) controller.current?.abort()
          setSelected(null); setError("")
          if (next.length < 3) { setBusy(false); setOpen(false); setPlaces([]); setSearched(false) }
          else if (next !== query) setBusy(true)
          setQuery(next)
          onChange(text, "")
        }}
        onValueChange={place => { if (place) { controller.current?.abort(); setQuery(null); setBusy(false); setSelected(place); onChange(place.label, place.url); setOpen(false) } }}
        itemToStringLabel={place => place.label} itemToStringValue={place => place.url} isItemEqualToValue={(place, other) => place.url === other.url} autoHighlight>
        <ComboboxInput aria-label="Location" aria-busy={busy} placeholder="Location" maxLength={300} className="w-full flex-1" showTrigger={false}>
          <InputGroupAddon align="inline-start"><MapPin aria-hidden="true" /></InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent><ComboboxList>{(place: PlaceResult) => <ComboboxItem key={place.url} value={place}><span><span className="block">{place.label}</span><span className="block text-xs text-muted-foreground">{place.address}</span></span></ComboboxItem>}</ComboboxList><p translate="no" className="m-0 px-3 py-2 text-xs font-normal text-[#5e5e5e] whitespace-nowrap">Google Maps</p></ComboboxContent>
      </Combobox>
    </div>
    <Input aria-label="Room / details (optional)" placeholder="Room / details (optional)" value={room} onChange={event => onRoomChange(event.target.value)} maxLength={300} disabled={disabled} />
    {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">View on Google Maps ↗</a>}
    {searched && !places.length && <p role="status" className="text-sm text-muted-foreground">No places found. Your custom location will be saved.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}

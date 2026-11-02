import { formatEventLocation, mapsSearchUrl, type EventRecord } from "./model"

// Events without a saved map link get a search for their place, which is in Ithaca unless the place says otherwise.
export function EventLocation({ event }: { event: Pick<EventRecord, "location" | "locationUrl" | "room"> }) {
  const place = formatEventLocation(event)
  if (place === "TBA") return <>{place}</>
  return <a href={event.locationUrl || mapsSearchUrl(`${place}, Ithaca`)} target="_blank" rel="noreferrer">{place}</a>
}

import { formatEventLocation, mapsSearchUrl, type EventRecord } from "./model"

// Events without a saved map link get a search for their place in their city.
export function EventLocation({ event }: { event: Pick<EventRecord, "location" | "locationUrl" | "room" | "city"> }) {
  const place = formatEventLocation(event)
  if (place === "TBA") return <>{place}</>
  return <a href={event.locationUrl || mapsSearchUrl(place.includes(event.city) ? place : `${place}, ${event.city}`)} target="_blank" rel="noreferrer">{place}</a>
}

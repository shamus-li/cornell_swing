import { formatEventLocation, type EventRecord } from "./model"

export function EventLocation({ event }: { event: Pick<EventRecord, "location" | "locationUrl" | "room"> }) {
  return event.locationUrl ? <a href={event.locationUrl} target="_blank" rel="noreferrer">{formatEventLocation(event)}</a> : <>{formatEventLocation(event)}</>
}

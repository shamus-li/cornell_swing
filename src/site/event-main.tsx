import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"

import { EventPage, type EventPageData } from "./EventPage"

// The Worker renders the page and fills in the event on each request.
const data = JSON.parse(document.getElementById("event-data")!.textContent!) as EventPageData

hydrateRoot(document.getElementById("root")!, <StrictMode><EventPage {...data} /></StrictMode>)

import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"

import { DancesPage, type DanceSnapshot } from "./DancesPage"

// The Worker renders the page and fills in these listings on each request.
const snapshot = JSON.parse(document.getElementById("dances-data")!.textContent!) as DanceSnapshot

hydrateRoot(document.getElementById("root")!, <StrictMode><DancesPage {...snapshot} /></StrictMode>)

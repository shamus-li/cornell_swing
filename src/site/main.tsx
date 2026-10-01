import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"

import App from "./App"
import type { EventSnapshot } from "./components/Events"

const root = document.getElementById("root")!
const initialSchedule: EventSnapshot | undefined = import.meta.env.PROD
  ? JSON.parse(document.getElementById("schedule-data")!.textContent!)
  : undefined
const app = (
  <StrictMode>
    <App initialSchedule={initialSchedule} />
  </StrictMode>
)

if (import.meta.env.PROD) {
  hydrateRoot(root, app)
} else {
  createRoot(root).render(app)
}

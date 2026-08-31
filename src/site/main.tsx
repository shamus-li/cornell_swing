import { StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"

import App from "./App"
import type { ScheduleSnapshot } from "./components/Schedule"
import { siteContent } from "./content"

document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href =
  siteContent.brand.faviconUrl

const root = document.getElementById("root")!
const initialSchedule: ScheduleSnapshot | undefined = import.meta.env.PROD
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

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Manage from "./Manage"
import type { ManagedEvent } from "../events/model"
import "../../styles.css"
import "../events/events.css"

const initialData = JSON.parse(document.getElementById("manage-data")!.textContent!) as { events: ManagedEvent[] } | null

createRoot(document.getElementById("root")!).render(<StrictMode><Manage initialEvents={initialData?.events} /></StrictMode>)

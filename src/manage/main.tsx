import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Manage from "./Manage"
import type { ManagedEvent } from "../events/model"
import "./manage.css"

// Square's sign-in redirect leaves this on the URL, and the browser keeps it through the callback's redirect.
if (window.location.hash === "#_=_") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)

const initialData = JSON.parse(document.getElementById("manage-data")!.textContent!) as { events: ManagedEvent[] } | null

createRoot(document.getElementById("root")!).render(<StrictMode><Manage initialEvents={initialData?.events} /></StrictMode>)

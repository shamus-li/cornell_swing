import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Manage from "./Manage"
import type { ManagedEvent } from "../events/model"
import "./manage.css"

const initialData = JSON.parse(document.getElementById("manage-data")!.textContent!) as { events: ManagedEvent[] } | null

// /manage/?mock shows sample events during development.
const mock = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock") ? import("./mock") : null

void Promise.resolve(mock).then(sample =>
  createRoot(document.getElementById("root")!).render(<StrictMode><Manage initialEvents={sample?.events ?? initialData?.events} /></StrictMode>)
)

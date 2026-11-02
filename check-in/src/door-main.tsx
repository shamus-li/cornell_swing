import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import Door from "./Door"
import "./index.css"

// /check-in/door/?mock swaps the API for sample data during development.
const mock = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock") ? import("./mock") : null

void Promise.resolve(mock).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Door />
    </StrictMode>
  )
)

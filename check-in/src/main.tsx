import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import "./index.css"

// /check-in/?mock swaps the API for sample data during development.
const mock = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock") ? import("./mock") : null

void Promise.resolve(mock).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)

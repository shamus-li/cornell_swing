import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import faviconUrl from "../../assets/favicon.png"

import App from "./App"
import "./index.css"

document.querySelector<HTMLLinkElement>("#app-icon")!.href = faviconUrl

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

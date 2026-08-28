import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import { siteContent } from "./content"

document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href =
  siteContent.brand.faviconUrl

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

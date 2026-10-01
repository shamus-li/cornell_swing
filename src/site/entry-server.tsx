import { StrictMode } from "react"
import { renderToStaticMarkup, renderToString } from "react-dom/server"

import App from "./App"
import { todayInNewYork } from "../events/model"
import { siteContent } from "./content"

export async function render() {
  const initialSchedule = { events: [], today: todayInNewYork() }
  const photo = siteContent.hero.slides[0]
  const imageUrl = new URL(photo.src, "https://swingsyndicate.club/").href

  return {
    html: renderToString(<StrictMode><App initialSchedule={initialSchedule} /></StrictMode>),
    // The Worker replaces this empty snapshot and event markup from D1 on each request.
    scheduleData: `<script id="schedule-data" type="application/json">${JSON.stringify(initialSchedule).replace(/</g, "\\u003c")}</script>`,
    socialImage: renderToStaticMarkup(
      <>
        <meta property="og:image" content={imageUrl} />
        <meta property="og:image:alt" content={photo.alt} />
        <meta name="twitter:image" content={imageUrl} />
        <meta name="twitter:image:alt" content={photo.alt} />
      </>,
    ),
  }
}

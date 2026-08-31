import { StrictMode } from "react"
import { renderToStaticMarkup, renderToString } from "react-dom/server"

import App from "./App"
import { fetchEvents, todayInIthaca } from "./components/Schedule"
import { siteContent } from "./content"

export async function render() {
  const [schedule, specialEvents] = await Promise.all([
    fetchEvents(siteContent.schedule.url, AbortSignal.timeout(15_000)),
    fetchEvents(siteContent.specialEvents.url, AbortSignal.timeout(15_000)),
  ])
  const initialSchedule = { schedule, specialEvents, today: todayInIthaca() }
  const photo = siteContent.hero.slides[0]
  const imageUrl = new URL(photo.src, "https://swingsyndicate.club/").href

  return {
    html: renderToString(<StrictMode><App initialSchedule={initialSchedule} /></StrictMode>),
    // Sheet text must not be able to close the JSON script element.
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

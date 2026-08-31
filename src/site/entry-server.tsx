import { StrictMode } from "react"
import { renderToStaticMarkup, renderToString } from "react-dom/server"

import App from "./App"
import { siteContent } from "./content"

export function render() {
  const photo = siteContent.hero.slides[0]
  const imageUrl = new URL(photo.src, "https://swingsyndicate.club/").href

  return {
    html: renderToString(<StrictMode><App /></StrictMode>),
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

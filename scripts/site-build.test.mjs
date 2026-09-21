import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { test } from "node:test"
import { JSDOM } from "jsdom"

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8")
// No script execution: this is what a crawler receives before rendering JS.
const { document } = new JSDOM(html).window
const canonical = "https://swingsyndicate.club/"

test("the build provides replaceable event markup and hydration data for the Worker", () => {
  const data = document.querySelector("#schedule-data")
  assert.ok(data)
  const snapshot = JSON.parse(data.textContent)
  assert.match(snapshot.today, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(snapshot.events, [])
  assert.ok(document.querySelector("#event-sections #schedule"))
  assert.ok(document.querySelector("#event-sections #special-events"))
  assert.ok(!html.includes("docs.google.com/spreadsheets"))
})

test("the initial HTML starts only the visible carousel photo request", () => {
  const photos = Array.from(document.querySelectorAll(".hero-carousel img"))
  assert.ok(photos[0].getAttribute("srcset"))
  assert.equal(photos[0].getAttribute("loading"), "eager")
  assert.equal(photos[0].getAttribute("fetchpriority"), "high")
  for (const photo of photos.slice(1)) {
    assert.equal(photo.getAttribute("src"), null)
    assert.equal(photo.getAttribute("srcset"), null)
  }
  const preloads = document.querySelectorAll('link[rel="preload"][as="image"]')
  assert.equal(preloads.length, 1)
  assert.equal(preloads[0].getAttribute("imagesrcset"), photos[0].getAttribute("srcset"))
  assert.equal(preloads[0].getAttribute("imagesizes"), photos[0].getAttribute("sizes"))
})

test("prerendered photos, social previews, scripts, styles, and fonts all reference deployed assets", async () => {
  const urls = new Set()
  for (const element of document.querySelectorAll("img[src], script[src], link[href]")) {
    urls.add(element.getAttribute("src") || element.getAttribute("href"))
  }
  for (const element of document.querySelectorAll("[srcset], [imagesrcset]")) {
    const srcset = element.getAttribute("srcset") || element.getAttribute("imagesrcset")
    for (const candidate of srcset.split(",")) urls.add(candidate.trim().split(/\s+/)[0])
  }
  urls.add(document.querySelector('meta[property="og:image"]').content)
  urls.add(document.querySelector('meta[name="twitter:image"]').content)

  for (const value of urls) {
    if (value.startsWith("data:")) continue
    const url = new URL(value, canonical)
    assert.equal(url.origin, new URL(canonical).origin)
    if (url.href === canonical) continue
    assert.ok(url.pathname.startsWith("/assets/"), `Non-production asset URL: ${value}`)
    const file = new URL(`../dist${url.pathname}`, import.meta.url)
    assert.ok((await stat(file)).isFile(), `Missing deployed asset: ${value}`)
  }
})

test("search discovery includes only the public homepage and the kiosk is marked noindex", async () => {
  const sitemap = await readFile(new URL("../dist/sitemap.xml", import.meta.url), "utf8")
  const xml = new JSDOM(sitemap, { contentType: "application/xml" }).window.document
  assert.deepEqual(Array.from(xml.querySelectorAll("loc"), (node) => node.textContent), [canonical])
  const robots = await readFile(new URL("../dist/robots.txt", import.meta.url), "utf8")
  assert.match(robots, /^Disallow: \/check-in\s*$/m)
  assert.doesNotMatch(robots, /^Disallow: \/\s*$/m)
  assert.match(robots, /^Sitemap: https:\/\/swingsyndicate\.club\/sitemap\.xml$/m)

  const manager = await readFile(new URL("../dist/manage/index.html", import.meta.url), "utf8")
  assert.match(new JSDOM(manager).window.document.querySelector('meta[name="robots"]').content, /noindex/)
  assert.match(robots, /^Disallow: \/manage\s*$/m)
  const kiosk = await readFile(new URL("../dist/check-in/index.html", import.meta.url), "utf8")
  const kioskDocument = new JSDOM(kiosk).window.document
  assert.match(kioskDocument.querySelector('meta[name="robots"]').content, /noindex/)
})

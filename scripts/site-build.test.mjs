import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { test } from "node:test"
import { JSDOM } from "jsdom"

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8")
// No script execution: this is what a crawler receives before rendering JS.
const { document } = new JSDOM(html).window
const canonical = "https://swingsyndicate.club/"

test("both public Sheet tabs are readable before JavaScript and have matching hydration data", () => {
  const data = document.querySelector("#schedule-data")
  assert.ok(data, "The build must embed the Sheet snapshot for hydration")
  const snapshot = JSON.parse(data.textContent)
  assert.match(snapshot.today, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(document.querySelectorAll(".schedule-status").length, 0)
  assert.equal(document.querySelectorAll(".schedule-row").length, snapshot.schedule.length)
  for (const event of snapshot.schedule) {
    assert.ok(document.querySelector("#schedule").textContent.includes(event.Location || "TBA"))
  }
  for (const event of snapshot.specialEvents) {
    if (event.Activity) assert.ok(document.querySelector("#special-events").textContent.includes(event.Activity))
  }
})

test("the initial HTML starts only the visible carousel photo request", () => {
  const photos = Array.from(document.querySelectorAll(".hero-carousel img"))
  assert.equal(photos.length, 4)
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

test("the build renderer includes fetched event text without allowing Sheet text to inject scripts", async (t) => {
  const maliciousText = '</script><script id="injected">alert(1)</script>'
  const csvTitle = '"' + maliciousText.replaceAll('"', '""') + '"'
  const urls = []
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(new URL(url))
    return new Response(new URL(url).searchParams.get("gid") === "0"
      ? 'Date,Location,Beginner Program\n2099-10-17,Test barn,"Swingouts & turns"'
      : `Date,Title,Time,Activity,Location,URL\n2099-10-17,${csvTitle},7:00 PM,Live jazz,Test hall,`)
  })
  const { render } = await import("../dist-ssr/entry-server.js")
  const result = await render()
  const rendered = new JSDOM(result.html + result.scheduleData).window.document
  assert.match(rendered.querySelector("#schedule").textContent, /Test barn.*Swingouts & turns/)
  assert.equal(rendered.querySelector(".special-event-title").textContent, maliciousText)
  assert.match(rendered.querySelector("#special-events").textContent, /7:00 PM.*Live jazz/)
  assert.equal(rendered.querySelector("#injected"), null)
  assert.equal(JSON.parse(rendered.querySelector("#schedule-data").textContent).specialEvents[0].Title, maliciousText)
  assert.equal(urls.length, 2)
  assert.ok(urls.every((url) => url.origin === "https://docs.google.com" && url.pathname.endsWith("/pub")))
})

test("a failed Sheet fetch stops prerendering instead of publishing an empty schedule", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }))
  const { render } = await import("../dist-ssr/entry-server.js")
  await assert.rejects(render, /Event request failed with 503/)
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

  const kiosk = await readFile(new URL("../dist/check-in/index.html", import.meta.url), "utf8")
  const kioskDocument = new JSDOM(kiosk).window.document
  assert.match(kioskDocument.querySelector('meta[name="robots"]').content, /noindex/)
})

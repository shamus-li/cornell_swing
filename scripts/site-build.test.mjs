import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { test } from "node:test"
import { JSDOM } from "jsdom"

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8")
// No script execution: this is what a crawler receives before rendering JS.
const { document } = new JSDOM(html).window
const canonical = "https://swingsyndicate.club/"

test("the initial HTML contains the existing public copy and working join links without JavaScript", () => {
  assert.equal(document.querySelectorAll("h1").length, 1)
  assert.equal(document.querySelector("h1").textContent, "Criminally Good Dancing.")
  assert.equal(document.querySelector(".hero > p").textContent,
    "Free Lindy Hop every Monday night. No experience or partner required!")
  assert.match(document.querySelector("#about").textContent, /Cornell University/)
  assert.match(document.querySelector("#faq").textContent, /Ithaca community/)
  assert.match(document.querySelector("#faq").textContent, /Lessons and social dancing are free/)
  assert.ok(document.querySelector('a[href="https://lists.cornell.edu/GRAD-SWING-DANCE-L/subscribe"]'))
  assert.ok(document.querySelector('a[href="https://cornell.campusgroups.com/gcss/club_signup"]'))
  assert.ok(document.querySelector("#schedule .schedule-times").textContent.includes("8:00"))
  assert.doesNotMatch(html, /<!--app-html-->|<!--social-image-->/)
})

test("canonical, search metadata, and organization identity describe the same public site", () => {
  assert.equal(document.querySelectorAll('link[rel="canonical"]').length, 1)
  assert.equal(document.querySelector('link[rel="canonical"]').href, canonical)
  assert.equal(document.title, "Swing Syndicate at Cornell")
  assert.equal(document.querySelector('meta[property="og:title"]').content, document.title)
  assert.match(document.querySelector('meta[name="description"]').content, /Ithaca/)
  assert.equal(document.querySelector('meta[property="og:url"]').content, canonical)
  assert.ok(!document.querySelector('meta[name="robots"]')?.content.includes("noindex"))

  const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)
  const organization = schema["@graph"].find((entry) => entry["@type"] === "Organization")
  const website = schema["@graph"].find((entry) => entry["@type"] === "WebSite")
  assert.equal(organization.url, canonical)
  assert.equal(organization.name, document.querySelector(".site-name span").textContent)
  assert.equal(organization.address.addressLocality, "Ithaca")
  assert.equal(website.publisher["@id"], organization["@id"])
  assert.equal(website.url, canonical)
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

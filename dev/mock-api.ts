import type { IncomingMessage, ServerResponse } from "node:http"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { DancesPage } from "../src/site/DancesPage"
import { EventPage } from "../src/site/EventPage"
import { todayInNewYork, validateEvent, type ManagedEvent } from "../src/events/model"
import { baseSlug } from "../src/events/slugs"
import { activity, danceFeeds, eventRsvps, events as sampleEvents, finance, outsideEvents, places, redirects as sampleRedirects, serviceAccountEmail, sheet, square } from "./mock-data"

// Stands in for the Worker under `npm run dev`, so every page has data without signing in.
// Saves run the real event validation and last until this code changes or the dev server restarts.
const withSlug = (event: ManagedEvent) => ({ ...event, slug: baseSlug(event) })
let events = sampleEvents.map(withSlug)
let outside = [...outsideEvents]
let feeds = [...danceFeeds]
let redirects = [...sampleRedirects]
let sheetConnection: typeof sheet | null = sheet
const template: Record<string, string> = {}
const rsvps: Record<string, { name: string; email: string; createdAt: string }[]> = { "mock-special-1": eventRsvps }
// In the Worker's order: by date, undated events last.
const sorted = () => [...events].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.startTime.localeCompare(b.startTime))
const published = () => sorted().filter(event => event.published)

async function body(req: IncomingMessage) {
  let text = ""
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) : null
}

// Lists, adds to, replaces in or deletes from a collection; returns the new contents and the response.
async function crud<T extends { id: string }>(req: IncomingMessage, items: T[], id: string | undefined, key: string): Promise<[T[], object]> {
  if (req.method === "DELETE") return [items.filter(item => item.id !== id), { success: true }]
  const item = { ...await body(req), id: id ?? crypto.randomUUID(), updatedAt: new Date().toISOString() } as T
  return [id ? items.map(current => current.id === id ? item : current) : [...items, item], { [key]: item }]
}

async function saveEvent(req: IncomingMessage, id?: string) {
  const draft = await body(req)
  const saved = withSlug({ ...draft, ...validateEvent(draft), id: id ?? crypto.randomUUID(), rsvpCount: draft.rsvpCount ?? 0, updatedAt: new Date().toISOString() })
  events = id ? events.map(event => event.id === id ? saved : event) : [...events, saved]
  return { event: saved }
}

async function respond(req: IncomingMessage, path: string): Promise<object | null> {
  const method = req.method ?? "GET"
  if (path === "/api/events") return { events: published() }
  const rsvp = path.match(/^\/api\/events\/([^/]+)\/rsvp$/)
  if (rsvp) { (rsvps[rsvp[1]] ??= []).push({ ...await body(req), createdAt: new Date().toISOString() }); return { success: true } }
  if (path === "/api/event-requests") return { success: true }
  if (path === "/redirects/api") {
    if (method === "GET") return redirects
    const change = await body(req)
    if (method === "POST") redirects = [...redirects, change]
    if (method === "PUT") redirects = redirects.map(rule => rule.source === change.source ? change.redirect : rule)
    if (method === "DELETE") redirects = redirects.filter(rule => rule.source !== change.source)
    return { success: true }
  }
  if (!path.startsWith("/manage/api/")) return null
  const route = path.slice("/manage/api".length)
  if (/^\/events\/[^/]+\/activity$/.test(route)) return activity
  const event = route.match(/^\/events\/([^/]+)(\/rsvps)?$/)
  if (event?.[2]) return { rsvps: rsvps[event[1]] ?? [] }
  if (route === "/events") return method === "POST" ? saveEvent(req) : { events: sorted() }
  if (event && method === "DELETE") { events = events.filter(item => item.id !== event[1]); return { success: true } }
  if (event) return saveEvent(req, event[1])
  const other = route.match(/^\/outside-events(?:\/([^/]+))?$/)
  if (other) {
    if (method === "GET") return { events: outside, groups: [...new Set(outside.map(item => item.groupName))] }
    const [next, result] = await crud(req, outside, other[1], "event"); outside = next.map(item => item.published ? { ...item, needsReview: false } : item); return result
  }
  const feed = route.match(/^\/dance-feeds(?:\/([^/]+))?$/)
  if (feed) {
    if (method === "GET") return { feeds }
    const [next, result] = await crud(req, feeds, feed[1], "feed"); feeds = next; return result
  }
  if (route === "/newsletter-template") {
    if (method === "GET") return { parts: template }
    const { part, html } = await body(req)
    if (method === "PUT") template[part] = html; else delete template[part]
    return { success: true }
  }
  if (route.startsWith("/locations")) return { places }
  if (route === "/square") return square
  if (route === "/finance") return finance
  if (route === "/finance/file") return finance
  if (route === "/finance/campusgroups") return { ...finance, campusGroupsUploadedAt: new Date().toISOString() }
  if (route === "/alert-email") return { email: "alerts@example.com", verified: true }
  if (route.startsWith("/rsvp-sheet")) {
    if (method === "PUT") sheetConnection = { ...sheet, url: (await body(req)).url }
    if (method === "DELETE") sheetConnection = null
    return { connection: sheetConnection, serviceAccountEmail }
  }
  if (route === "/campusgroups") return { uploadedAt: null, count: null, members: null, generalRisk: null }
  return { success: true }
}

export async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const path = new URL(req.url!, "http://dev").pathname
  // The Worker serves these addresses from the two pre-rendered event pages.
  if (path === "/events") { req.url = "/events/"; return next() }
  if (/^\/events\/(?!event\/)[^/]+$/.test(path)) {
    if (!events.some(event => event.slug === path.slice("/events/".length))) { res.writeHead(302, { Location: "/events" }).end(); return }
    req.url = "/events/event/"
    return next()
  }
  if (!path.startsWith("/api/") && !path.startsWith("/manage/api/") && path !== "/redirects/api") return next()
  let status = 200, result: object | null
  try { result = await respond(req, path) } catch (error) { status = 400; result = { error: (error as Error).message } }
  res.writeHead(result ? status : 404, { "Content-Type": "application/json" }).end(JSON.stringify(result ?? { error: "Not found." }))
}

// Fills a page the way the Worker does: the rendered page in the root, its data in the script tag.
function fill(html: string, script: string, data: object, page: string) {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c")
  return html.replace(`<script id="${script}" type="application/json">null</script>`, () => `<script id="${script}" type="application/json">${json}</script>`)
    .replace(/(<main id="root"[^>]*>)(<\/main>)/, (_, open, close) => open + page + close)
}

export function renderPage(html: string, originalUrl: string) {
  const today = todayInNewYork()
  if (html.includes('id="dances-data"')) {
    const data = { events: published(), outside: outside.filter(event => event.published && event.date >= today), today }
    return fill(html, "dances-data", data, renderToString(createElement(DancesPage, data)))
  }
  if (html.includes('id="event-data"')) {
    const slug = new URL(originalUrl, "http://dev").pathname.slice("/events/".length)
    const data = { event: events.find(event => event.slug === slug) ?? events[0], today }
    return fill(html, "event-data", data, renderToString(createElement(EventPage, data)))
  }
  return html
}

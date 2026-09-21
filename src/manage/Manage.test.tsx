// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { $getRoot, getNearestEditorFromDOMNode } from "lexical"
import { afterEach, expect, it, vi } from "vitest"
import Manage from "./Manage"
import type { ManagedEvent } from "../events/model"
import { todayInNewYork } from "../events/model"
import { Markdown } from "../events/Markdown"

const base = { date: "2099-10-17", startTime: "18:15", endTime: "22:00", location: "Dance hall", description: "**Live music**", updatedAt: "2026-09-20T12:00:00.000Z", rsvpCount: 0 }
const events: ManagedEvent[] = [{ ...base, id: "normal", kind: "normal", title: "Monday swing" }, { ...base, id: "special", kind: "special", title: "Autumn dance", rsvpCount: 1 }]
let root: Root | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  window.history.replaceState(null, "", "/manage")
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""
})

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.spyOn(window.history, "back").mockImplementation(() => {})
  const eventFetch = fetch
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/manage/api/rsvp-sheet" && (!init?.method || init.method === "GET")) {
      return Promise.resolve(Response.json({ connection: null, serviceAccountEmail: null }))
    }
    return eventFetch(input, init)
  })
  const container = document.createElement("div"); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<Manage />))
  return container
}

function inputByLabel(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLInputElement>("input")].find(input =>
    input.getAttribute("aria-label") === label || [...input.labels ?? []].some(element => element.textContent?.trim() === label)
  )!
}

async function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function submit(container: HTMLElement) {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}

it("edits rendered Markdown in place, preserves headings and lists on save, and updates the list without refetching", async () => {
  const description = "**Live music**\n\n[Details](https://example.com)\n\n## Program\n\n- Jazz and swing"
  let current = events.map(event => ({ ...event, description }))
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (_url.endsWith("/rsvps")) return Response.json({ rsvps: [] })
    if (init?.method === "PUT") {
      const saved = JSON.parse(init.body as string) as ManagedEvent
      current = current.map(event => event.id === saved.id ? saved : event)
      return Response.json({ event: saved })
    }
    return Response.json({ events: current })
  })
  vi.stubGlobal("fetch", fetcher)
  const container = await render()
  const sections = container.querySelectorAll(".manage-section")
  expect(sections[0].textContent).not.toContain("Monday swing")
  expect(sections[0].textContent).not.toContain("Autumn dance")
  expect(sections[1].querySelector(".guest-count")?.textContent).toBe("1 RSVP")
  await act(async () => sections[1].querySelector<HTMLButtonElement>(".event-title-button")!.click())
  await act(async () => { await import("./MarkdownEditorContent") })
  await enter(inputByLabel(container, "Event name"), "Autumn dance updated")
  await enter(inputByLabel(container, "Start time"), "6:07 PM")
  const editor = container.querySelector<HTMLElement>('.inline-editor-content[contenteditable="true"]')!
  expect(editor).not.toBeNull()
  expect(editor.querySelector("h2")?.textContent).toBe("Program")
  expect(editor.querySelector("li")?.textContent).toBe("Jazz and swing")
  await act(async () => {
    // jsdom has no native contenteditable typing; update the real editor state.
    getNearestEditorFromDOMNode(editor)!.update(() => {
      $getRoot().getAllTextNodes()[0].setTextContent("New band")
    })
  })
  expect(editor.querySelector("strong")?.textContent).toBe("New band")
  expect(editor.querySelector("a")?.getAttribute("href")).toBe("https://example.com")
  await submit(container)
  const request = fetcher.mock.calls.find(([, init]) => init?.method === "PUT")!
  expect(request[0]).toBe("/manage/api/events/special")
  const saved = JSON.parse(request[1]!.body as string) as ManagedEvent
  expect(saved).toMatchObject({ title: "Autumn dance updated", kind: "special", startTime: "18:07" })
  const publicDescription = document.createElement("div")
  publicDescription.innerHTML = renderToString(<Markdown>{saved.description}</Markdown>)
  expect(publicDescription.querySelector("strong")?.textContent).toBe("New band")
  expect(publicDescription.querySelector("a")?.getAttribute("href")).toBe("https://example.com")
  expect(publicDescription.querySelector("h2")?.textContent).toBe("Program")
  expect(publicDescription.querySelector("li")?.textContent).toBe("Jazz and swing")
  expect(container.querySelector("form")).toBeNull()
  expect(container.textContent).toContain("Autumn dance updated")
  expect(fetcher.mock.calls.filter(([url]) => url === "/manage/api/events")).toHaveLength(1)
})

it("creates a special event with unconfirmed times and opens its private guest list", async () => {
  let current = events.map(event => ({ ...event }))
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const created = { ...JSON.parse(init.body as string), id: "new-special", rsvpCount: 0 }
      current = [...current, created]
      return Response.json({ event: created })
    }
    if (url.endsWith("/rsvps")) return Response.json({ rsvps: [{ name: "Test Dancer", email: "dancer@example.com", createdAt: base.updatedAt }] })
    return Response.json({ events: current })
  })
  vi.stubGlobal("fetch", fetcher)
  const container = await render()
  await act(async () => container.querySelectorAll<HTMLButtonElement>(".manage-section-heading button")[1].click())
  expect(inputByLabel(container, "Start time").value).toBe("")
  expect(inputByLabel(container, "End time").value).toBe("")
  await enter(inputByLabel(container, "Event name"), "Winter dance")
  await submit(container)
  const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!
  expect(request[0]).toBe("/manage/api/events")
  expect(JSON.parse(request[1]!.body as string)).toMatchObject({ kind: "special", title: "Winter dance", date: todayInNewYork(), startTime: "", endTime: "" })
  expect(container.textContent).toContain("Winter dance")
  await act(async () => container.querySelector<HTMLButtonElement>(".event-title-button")!.click())
  expect(fetcher).toHaveBeenLastCalledWith("/manage/api/events/new-special/rsvps", expect.anything())
  expect(container.querySelector(".guest-list")?.textContent).toContain("Test Dancer")
  expect(container.querySelector(".guest-list")?.textContent).toContain("dancer@example.com")
})

it("lists both event sections earliest first", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ events: [
    ...events.map(event => ({ ...event, id: `${event.id}-later`, date: "2099-12-09" })),
    ...events.map(event => ({ ...event, id: `${event.id}-earlier`, date: "2099-09-01" })),
  ] })))
  const container = await render()
  for (const section of container.querySelectorAll(".manage-section")) {
    expect([...section.querySelectorAll("time")].map(time => time.dateTime)).toEqual(["2099-09-01", "2099-12-09"])
  }
})

it("keeps the active normal draft after a failed switch save and opens only the next row after retry", async () => {
  const normalEvents = [
    { ...events[0], id: "first", date: "2099-10-12", description: "**Beginner:** Basics" },
    { ...events[0], id: "second", date: "2099-10-19", description: "**Beginner:** Charleston" },
  ]
  let attempts = 0
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      attempts++
      if (attempts === 1) return Response.json({ error: "Connection lost" }, { status: 503 })
      return Response.json({ event: { ...JSON.parse(init.body as string), updatedAt: "2026-09-20T12:01:00.000Z" } })
    }
    return Response.json({ events: normalEvents })
  })
  vi.stubGlobal("fetch", fetcher)
  const container = await render()
  await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit event on 2099-10-12"]')!.click())
  await enter(inputByLabel(container, "Beginner"), "New lesson")
  const openNext = async () => { await act(async () => container.querySelector<HTMLElement>('[aria-label="Edit event on 2099-10-19"]')!.click()) }
  await openNext()
  expect(container.querySelectorAll(".normal-event-edit")).toHaveLength(1)
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Connection lost")
  expect(inputByLabel(container, "Beginner").value).toBe("New lesson")
  await openNext()
  expect(container.querySelectorAll(".normal-event-edit")).toHaveLength(1)
  expect(inputByLabel(container, "Beginner").value).toBe("Charleston")
  expect(container.querySelector('[aria-label="Edit event on 2099-10-12"]')?.textContent).toContain("New lesson")
  const requests = fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")
  expect(requests).toHaveLength(2)
  for (const [url, init] of requests) {
    expect(url).toBe("/manage/api/events/first")
    expect(JSON.parse(init!.body as string)).toMatchObject({ id: "first", description: "**Beginner:** New lesson", updatedAt: base.updatedAt })
  }
})

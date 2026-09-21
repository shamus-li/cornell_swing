// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import Manage from "./Manage"
import type { ManagedEvent } from "../events/model"

vi.mock("./MarkdownEditor", () => ({ MarkdownEditor: () => null }))
const event: ManagedEvent = { id: "dance", kind: "special", title: "Autumn dance", date: "2099-10-17", startTime: "18:00", endTime: "22:00", location: "Hall", description: "", updatedAt: "2026-09-21", rsvpCount: 1 }
let root: Root

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""
  window.history.replaceState(null, "", "/manage")
})

async function click(text: string, scope: Document | HTMLElement = document) {
  const button = [...scope.querySelectorAll("button")].find(button => button.textContent === text)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}

it("updates RSVP counts and event deletion locally and retains the sheet status across editor visits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/rsvp-sheet")) return Response.json({ connection: { url: "https://docs.google.com/spreadsheets/d/example", error: null }, serviceAccountEmail: null })
    if (init?.method === "DELETE") return Response.json({ success: true })
    if (url.endsWith("/rsvps")) return Response.json({ rsvps: [{ name: "Dancer", email: "dancer@example.com", createdAt: "2026-09-21" }] })
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal("fetch", fetcher)
  const container = document.createElement("div"); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Manage initialEvents={[event]} />))
  const open = async () => {
    await act(async () => container.querySelector<HTMLButtonElement>(".event-title-button")!.click())
    // Model direct navigation so closing is synchronous in jsdom.
    window.history.replaceState(null, "", window.location.href)
  }
  await open()
  await click("Remove")
  await click("Remove RSVP", document.querySelector<HTMLElement>('[role="alertdialog"]')!)
  expect(container.querySelector(".guest-list")?.textContent).not.toContain("dancer@example.com")
  await click("← All events")
  expect(container.querySelector(".guest-count")?.textContent).toBe("0 RSVPs")
  await open()
  await click("Delete event", container)
  await click("Delete event", document.querySelector<HTMLElement>('[role="alertdialog"]')!)
  expect(container.querySelector(".event-title-button")).toBeNull()
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/rsvp-sheet"))).toHaveLength(1)
  expect(fetcher.mock.calls.some(([url]) => url === "/manage/api/events")).toBe(false)
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2)
})

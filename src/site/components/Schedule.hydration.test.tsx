// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { Schedule, SpecialEvents, useScheduleData, type ScheduleSnapshot } from "./Schedule"

const snapshot: ScheduleSnapshot = {
  today: "2099-10-17",
  schedule: [{ Date: "2099-10-17", Location: "Big Red Barn", "Beginner Program": "Swingouts" }],
  specialEvents: [{ Date: "2099-10-17", Title: "October dance", Location: "Memorial Room", Activity: "Live music" }],
}

function SchedulePage({ initial }: { initial?: ScheduleSnapshot }) {
  const { schedule, specialEvents, today } = useScheduleData("/weekly", "/special", initial)
  return <>
    <Schedule title="Schedule" times="8:00 PM" today={today} {...schedule} />
    <SpecialEvents title="Special events" today={today} {...specialEvents} />
  </>
}

let container: HTMLDivElement
let root: Root | undefined
let requests: Map<string, (response: Response) => void>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2099-10-18T16:00:00Z"))
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  requests = new Map()
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    requests.set(url, resolve)
    options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
  })))
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it("hydrates a previous-day snapshot without replacing it, then refreshes both tabs independently", async () => {
  const page = <StrictMode><SchedulePage initial={snapshot} /></StrictMode>
  container.innerHTML = renderToString(page)
  const originalRow = container.querySelector(".schedule-row")
  expect(container.textContent).toContain("Swingouts")
  expect(container.textContent).toContain("October dance")
  expect(container.querySelector(".is-past")).toBeNull()

  const errors = vi.spyOn(console, "error")
  const recoverableError = vi.fn()
  await act(async () => {
    root = hydrateRoot(container, page, { onRecoverableError: recoverableError })
  })
  expect(container.querySelector(".schedule-row")).toBe(originalRow)
  expect(container.querySelectorAll(".is-past")).toHaveLength(2)
  expect(container.querySelectorAll('[data-status="past"] .past-label')).toHaveLength(2)
  expect(container.textContent).not.toContain("Loading")
  expect([...requests.keys()].sort()).toEqual(["/special", "/weekly"])
  expect(errors).not.toHaveBeenCalled()
  expect(recoverableError).not.toHaveBeenCalled()

  await act(async () => {
    requests.get("/weekly")!(new Response("Date,Location,Beginner Program\n2099-10-19,Physical Sciences Building,Charleston"))
  })
  expect(container.textContent).toContain("Charleston")
  expect(container.textContent).not.toContain("Swingouts")
  expect(container.textContent).toContain("October dance")
  expect(container.querySelector(".schedule-row.is-past")).toBeNull()

  await act(async () => {
    requests.get("/special")!(new Response("Date,Title,Location\n2099-11-13,November dance,Memorial Room"))
  })
  expect(container.textContent).toContain("November dance")
  expect(container.textContent).not.toContain("October dance")
})

it("keeps readable snapshot content on refresh failure and removes cancelled events on a valid empty refresh", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  await act(async () => {
    root = createRoot(container)
    root.render(<SchedulePage initial={snapshot} />)
  })
  await act(async () => {
    requests.get("/weekly")!(new Response("Unavailable", { status: 503 }))
    requests.get("/special")!(new Response("Date,Title,Time,Activity,Location,URL\n"))
  })
  expect(container.textContent).toContain("Swingouts")
  expect(container.textContent).not.toContain("could not be loaded")
  expect(container.querySelectorAll(".special-event-row")).toHaveLength(0)
})

it("shows a load error without a snapshot when a published Sheet returns HTML instead of CSV", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  await act(async () => {
    root = createRoot(container)
    root.render(<SchedulePage />)
  })
  expect(container.textContent).toContain("Loading schedule...")
  await act(async () => {
    requests.get("/weekly")!(new Response("<!doctype html><h1>Sign in</h1>"))
  })
  expect(container.textContent).toContain("The schedule could not be loaded.")
  expect(container.textContent).not.toContain("Sign in")
  expect(container.textContent).toContain("Loading special events...")
})

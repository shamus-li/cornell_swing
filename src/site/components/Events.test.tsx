// @vitest-environment jsdom
import { act, StrictMode } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import { EventSections, useEvents, type EventSnapshot } from "./Events"
import { Markdown } from "../../events/Markdown"

const base = { title: "Swing", date: "2099-10-17", startTime: "18:15", endTime: "22:00", location: "Dance hall", description: "**Live music**", updatedAt: "2026-09-20T12:00:00.000Z" }
const snapshot: EventSnapshot = { today: "2026-09-20", events: [{ ...base, id: "normal", kind: "normal" }, { ...base, id: "special", kind: "special" }] }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = "" })

it("offers RSVP and calendar only for special events and hides past RSVP", () => {
  const container = document.createElement("div")
  container.innerHTML = renderToString(<EventSections {...snapshot} />)
  expect(container.querySelector("#schedule button")).toBeNull()
  expect(container.querySelector('#schedule [aria-haspopup="menu"]')).toBeNull()
  expect(container.querySelector("#special-events button")?.textContent).toBe("RSVP")
  expect(container.querySelector("strong")?.textContent).toBe("Live music")
  container.innerHTML = renderToString(<EventSections {...snapshot} today="2100-01-01" />)
  expect([...container.querySelectorAll("button")].some(button => button.textContent === "RSVP")).toBe(false)
  expect(container.querySelector('[aria-haspopup="menu"]')?.textContent).toContain("Add to calendar")
})

it("removes raw HTML and unsafe Markdown links", () => {
  const html = renderToString(<Markdown>{'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert%281%29)\n\n**Good**'}</Markdown>)
  expect(html).not.toContain("<script")
  expect(html).not.toContain("<img")
  expect(html).not.toContain("javascript:")
  expect(html).toContain("<strong>Good</strong>")
})

it("hydrates separately rendered live event markup without mismatched menu IDs or refetching the server snapshot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ events: snapshot.events })))
  function Page() { const { snapshot: data } = useEvents(snapshot); return <main><h1>Swing Syndicate</h1><div id="event-sections"><EventSections {...data} /></div></main> }
  const page = <StrictMode><Page /></StrictMode>
  const container = document.createElement("div"); document.body.appendChild(container)
  container.innerHTML = renderToString(page)
  // The Worker injects an independently rendered event subtree into the homepage.
  container.querySelector("#event-sections")!.innerHTML = renderToString(<EventSections {...snapshot} />)
  const recoverable = vi.fn()
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  const row = container.querySelector(".event-row")
  let root: ReturnType<typeof hydrateRoot>
  await act(async () => { root = hydrateRoot(container, page, { onRecoverableError: recoverable }) })
  expect(recoverable).not.toHaveBeenCalled()
  expect(consoleError).not.toHaveBeenCalled()
  expect(container.querySelector(".event-row")).toBe(row)
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => root.unmount())
})

async function openRsvp() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  const container = document.createElement("div"); document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<EventSections {...snapshot} />))
  await act(async () => container.querySelector<HTMLButtonElement>("#special-events button")!.click())
  expect(container.querySelector("dialog")?.open).toBe(true)
  const name = container.querySelector<HTMLInputElement>('input[name="name"]')!; name.value = "Test Dancer"
  const email = container.querySelector<HTMLInputElement>('input[name="email"]')!; email.value = "dancer@example.com"
  return { container, root, name, email }
}

it("opens an accessible popup, saves RSVP, and shows confirmation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true })))
  const { container, root } = await openRsvp()
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(fetch).toHaveBeenCalledWith("/api/events/special/rsvp", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Test Dancer", email: "dancer@example.com" }) }))
  expect(container.textContent).toContain("See you on the dance floor!")
  await act(async () => container.querySelector<HTMLButtonElement>('dialog [aria-haspopup="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
  expect(container.querySelector('dialog [role="menu"]')).not.toBeNull()
  expect(container.querySelector('dialog [role="menu"] a')?.getAttribute("href")).toBe("/api/events/special/calendar")
  const ids = [...container.querySelectorAll("[id]")].map(element => element.id)
  expect(new Set(ids).size).toBe(ids.length)
  await act(async () => root.unmount())
  expect(document.body.style.overflow).toBe("")
})


it.each(["fetch", "body"])("retries a %s network failure once with the same RSVP", async failure => {
  vi.useFakeTimers()
  const request = vi.fn()
    .mockImplementationOnce(async () => {
      if (failure === "fetch") throw new TypeError("Load failed")
      return { ok: true, json: async () => { throw new TypeError("Load failed") } }
    })
    .mockResolvedValueOnce(Response.json({ success: true }))
  vi.stubGlobal("fetch", request)
  const { container, root } = await openRsvp()
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(request).toHaveBeenCalledTimes(1)
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0])
  expect(container.textContent).toContain("See you on the dance floor!")
  await act(async () => root.unmount())
})

it.each(["network", "API"])("retains RSVP details after a %s error without repeated retries", async failure => {
  vi.useFakeTimers()
  const request = vi.fn(async () => {
    if (failure === "network") throw new TypeError("Load failed")
    return Response.json({ error: "Please wait before trying again." }, { status: 429 })
  })
  vi.stubGlobal("fetch", request)
  const { container, root, name, email } = await openRsvp()
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await act(async () => vi.advanceTimersByTimeAsync(10000))
  expect(request).toHaveBeenCalledTimes(failure === "network" ? 2 : 1)
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(failure === "network"
    ? "Check your connection and try again."
    : "Please wait before trying again.")
  expect(name.value).toBe("Test Dancer")
  expect(email.value).toBe("dancer@example.com")
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  expect(container.textContent).not.toContain("See you on the dance floor!")
  await act(async () => root.unmount())
})

// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import type { EventRecord } from "../events/model"
import { NormalEventRow, parsePrograms, serializePrograms } from "./NormalEventRow"

const event: EventRecord = { id: "normal-2099-10-12", kind: "normal", title: "Monday swing", date: "2099-10-12", startTime: "20:00", endTime: "22:00", location: "Dance hall", description: "**Beginner:** Basics\n\n**Advanced:** Swingouts\n\nThe social dance is 8-10pm!\n\n[Details](https://example.com)", updatedAt: "2026-09-20T12:00:00.000Z" }
let root: Root | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""
})

async function render(record: EventRecord, onSave = vi.fn(async (_draft: EventRecord) => {})) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div"); document.body.appendChild(container)
  root = createRoot(container)
  function Harness() {
    const [editing, setEditing] = useState(!record.id)
    return <NormalEventRow event={record} editing={editing} onEdit={() => setEditing(true)} onCancel={() => setEditing(false)} onSave={onSave} />
  }
  await act(async () => root!.render(<Harness />))
  return container
}

function inputByLabel(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLInputElement>("input")].find(input =>
    input.getAttribute("aria-label") === label || [...input.labels ?? []].some(element => element.textContent?.trim() === label)
  )!
}

async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function submit(container: HTMLElement) {
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}

it("extracts program labels without discarding extra paragraphs, tables, or duplicate labels", () => {
  const notes = "Social dance 8-10pm.\n\n| Time | Activity |\n| --- | --- |\n| 9 PM | Jazz |\n\n**Beginner:** A second announcement"
  const description = `**Beginner:** Basics\n\n**Advanced**: Swingouts\n\n${notes}`
  const fields = parsePrograms(description)
  expect(fields).toEqual({ beginner: "Basics", advanced: "Swingouts", notes })
  expect(serializePrograms(fields)).toBe(`**Beginner:** Basics\n\n**Advanced:** Swingouts\n\n${notes}`)
})

it("shows an inline lesson row and saves edited programs while preserving notes and weekly times", async () => {
  const onSave = vi.fn(async (_draft: EventRecord) => {})
  const container = await render(event, onSave)
  expect(container.textContent).not.toContain("Monday swing")
  await act(async () => container.querySelector<HTMLElement>('.normal-event-summary')!.click())
  const beginner = inputByLabel(container, "Beginner")
  await enter(beginner, "Charleston")
  const unload = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  await submit(container)
  expect(onSave).toHaveBeenCalledWith({ ...event, room: "", description: event.description.replace("Basics", "Charleston") })
  expect(container.querySelector("form")).toBeNull()
})

it("preserves the exact legacy description when only location changes", async () => {
  const onSave = vi.fn(async (_draft: EventRecord) => {})
  const original = { ...event, description: "**Advanced**: Swingouts\n\n\n**Beginner:** Basics\n\nKeep this note." }
  const container = await render(original, onSave)
  await act(async () => container.querySelector<HTMLElement>('.normal-event-summary')!.click())
  await enter(inputByLabel(container, "Location"), "Big Red Barn")
  await submit(container)
  expect(onSave).toHaveBeenCalledWith({ ...original, room: "", location: "Big Red Barn", locationUrl: "" })
})

it("starts new rows in edit mode and preserves the draft after a failed save", async () => {
  const onSave = vi.fn(async (_draft: EventRecord) => { throw new Error("Connection lost") })
  const container = await render({ ...event, id: "" }, onSave)
  expect(container.querySelector("form")).not.toBeNull()
  const beginner = inputByLabel(container, "Beginner")
  await enter(beginner, "New lesson")
  await submit(container)
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Connection lost")
  expect(beginner.value).toBe("New lesson")
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Cancel")!.click())
  expect(confirm).not.toHaveBeenCalled()
  expect(container.querySelector("form")).toBeNull()
})

// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HeroCarousel } from "./HeroCarousel"

describe("hero carousel", () => {
  let root: Root
  let container: HTMLDivElement
  let style: HTMLStyleElement
  let hidden: boolean
  let motionPreference: EventTarget & { matches: boolean }

  async function mount() {
    await act(async () => {
      root.render(<StrictMode><HeroCarousel /></StrictMode>)
    })
  }

  async function advanceTime(milliseconds: number) {
    await act(async () => {
      vi.advanceTimersByTime(milliseconds)
    })
  }

  async function setHidden(value: boolean) {
    await act(async () => {
      hidden = value
      document.dispatchEvent(new Event("visibilitychange"))
    })
  }

  function currentPhoto() {
    return container.querySelector('button[aria-current="true"]')?.getAttribute("aria-label")
  }

  async function choosePhoto(number: number) {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="Go to photo ${number}"]`)!.click()
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    hidden = false
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden)
    motionPreference = Object.assign(new EventTarget(), { matches: false })
    vi.stubGlobal("matchMedia", () => motionPreference)

    // jsdom has no layout/observer engine. Supply a fixed single-photo viewport;
    // the mounted React component and Embla still handle all selection and timing.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      return this.matches('[aria-roledescription="slide"]')
        ? Array.from(this.parentElement!.children).indexOf(this) * 900
        : 0
    })
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    })
    style = document.createElement("style")
    style.textContent = '[aria-roledescription="slide"] { margin-right: 0px; }'
    document.head.appendChild(style)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    style.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(["load", "error"])("defers hidden photo requests until the first photo finishes with %s", async (event) => {
    await mount()
    const photos = Array.from(container.querySelectorAll("img"))
    expect(photos.filter((photo) => photo.hasAttribute("src"))).toHaveLength(1)
    expect(photos.filter((photo) => photo.hasAttribute("srcset"))).toHaveLength(1)

    await act(async () => photos[0].dispatchEvent(new Event(event)))
    expect(photos.every((photo) => photo.hasAttribute("src") && photo.hasAttribute("srcset"))).toBe(true)
  })

  it("loads the remaining photos when the first photo was cached before hydration", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true)
    await mount()
    expect(container.querySelectorAll("img[src][srcset]")).toHaveLength(4)
  })

  it("can request a manually selected photo while the first photo is still loading", async () => {
    await mount()
    await choosePhoto(4)
    const photo = container.querySelectorAll("img")[3]
    expect(currentPhoto()).toBe("Go to photo 4")
    expect(photo.hasAttribute("src") && photo.hasAttribute("srcset")).toBe(true)
  })

  it("keeps the current photo while hidden, then resumes one photo at a time after a full countdown", async () => {
    await mount()
    expect(currentPhoto()).toBe("Go to photo 1")
    await advanceTime(6000)
    expect(currentPhoto()).toBe("Go to photo 2")

    await advanceTime(5000)
    await setHidden(true)
    await advanceTime(60000)
    expect(currentPhoto()).toBe("Go to photo 2")

    await setHidden(false)
    expect(currentPhoto()).toBe("Go to photo 2")
    await advanceTime(5999)
    expect(currentPhoto()).toBe("Go to photo 2")
    await advanceTime(1)
    expect(currentPhoto()).toBe("Go to photo 3")
    await advanceTime(6000)
    expect(currentPhoto()).toBe("Go to photo 4")
  })

  it("waits for the page to become visible when initially opened in a background tab", async () => {
    hidden = true
    await mount()
    await advanceTime(60000)
    expect(currentPhoto()).toBe("Go to photo 1")

    await setHidden(false)
    await advanceTime(5999)
    expect(currentPhoto()).toBe("Go to photo 1")
    await advanceTime(1)
    expect(currentPhoto()).toBe("Go to photo 2")
  })

  it.each([1, 3])("gives a manually selected photo %i a full countdown, even if it was already selected", async (photo) => {
    await mount()
    await advanceTime(5000)
    await choosePhoto(photo)
    expect(currentPhoto()).toBe(`Go to photo ${photo}`)
    await advanceTime(5999)
    expect(currentPhoto()).toBe(`Go to photo ${photo}`)
    await advanceTime(1)
    expect(currentPhoto()).toBe(`Go to photo ${photo + 1}`)
  })

  it("honors reduced motion across tab switches while still allowing manual navigation", async () => {
    motionPreference.matches = true
    await mount()
    await advanceTime(6000)
    await setHidden(true)
    await setHidden(false)
    await advanceTime(6000)
    expect(currentPhoto()).toBe("Go to photo 1")

    await choosePhoto(3)
    await advanceTime(6000)
    expect(currentPhoto()).toBe("Go to photo 3")

    await act(async () => {
      motionPreference.matches = false
      motionPreference.dispatchEvent(new Event("change"))
    })
    await advanceTime(6000)
    expect(currentPhoto()).toBe("Go to photo 4")
  })
})

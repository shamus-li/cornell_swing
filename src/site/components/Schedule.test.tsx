import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Schedule, SpecialEvents } from "./Schedule"

function render(events: Record<string, string>[]) {
  return renderToStaticMarkup(
    <SpecialEvents title="Special events" events={events} status="loaded" />,
  )
}

describe("special events", () => {
  it("groups by date only and keeps event and activity order", () => {
    const html = render([
      { Date: "10/17/2026", Activity: "Crash course" },
      { Date: "11/13/2026", Title: "November dance" },
      { Date: "2026-10-17", Title: "October dance", Activity: "Live music" },
    ])

    expect(html.match(/class="special-event-row/g)).toHaveLength(2)
    expect(html.match(/class="special-event-activity"/g)).toHaveLength(2)
    expect(html.indexOf("Crash course")).toBeLessThan(html.indexOf("Live music"))
    expect(html.indexOf("Live music")).toBeLessThan(html.indexOf("November dance"))
    expect(html).toContain("October dance")
    expect(html).toContain('dateTime="2026-10-17"')
  })

  it("does not group different dates with matching titles", () => {
    const html = render([
      { Date: "10/17/2026", Title: "Dance" },
      { Date: "11/13/2026", Title: "Dance" },
    ])

    expect(html.match(/class="special-event-row/g)).toHaveLength(2)
  })

  it("shares event metadata when only the first activity provides it", () => {
    const html = render([
      { Date: "10/17/2026", Title: "October dance", Time: "6:15–7:00 PM", Activity: "Crash course", Location: "Memorial Room", URL: "https://example.com/dance" },
      { Date: "10/17/2026", Time: "7:00–10:00 PM", Activity: "Live music" },
    ])

    expect(html.match(/October dance/g)).toHaveLength(1)
    expect(html).toContain('<a href="https://example.com/dance">October dance</a>')
    expect(html.match(/Memorial Room/g)).toHaveLength(1)
    expect(html.indexOf("Memorial Room")).toBeLessThan(html.indexOf("6:15–7:00 PM"))
    expect(html).toContain("7:00–10:00 PM")
    expect(html).toContain("<p>Live music</p>")
    expect(html).not.toContain("Time TBA")
    expect(html).not.toContain("Location TBA")
  })

  it("uses the first known location for the whole event", () => {
    const html = render([
      { Date: "10/17/2026", Activity: "Lesson", Location: "TBA" },
      { Date: "10/17/2026", Activity: "Social", Location: "Dance Studio" },
      { Date: "10/17/2026", Activity: "Afterparty", Location: "Memorial Room" },
    ])
    const activities = html.match(/<li\b.*?<\/li>/g)!

    expect(activities).toHaveLength(3)
    expect(html.match(/Dance Studio/g)).toHaveLength(1)
    expect(html).not.toContain("Memorial Room")
    expect(html).not.toContain("Location TBA")
    expect(activities.join("")).not.toContain("Dance Studio")
  })

  it("does not share metadata between different dates", () => {
    const html = render([
      { Date: "10/17/2026", Title: "October dance", Location: "Memorial Room", URL: "https://example.com/dance" },
      { Date: "11/13/2026", Activity: "Social" },
    ])
    const events = html.match(/<article\b.*?<\/article>/g)!

    expect(events).toHaveLength(2)
    expect(events[1]).toContain('<h3 class="special-event-title">TBA</h3>')
    expect(events[1]).not.toContain('class="special-event-location"')
    expect(events[1]).not.toContain("Memorial Room")
    expect(events[1]).not.toContain("<a ")
  })

  it("uses TBA for blank titles and keeps date-only events", () => {
    const html = render([{ Date: "11/13/2026", Title: "" }])

    expect(html).toContain('<h3 class="special-event-title">TBA</h3>')
    expect(html).toContain("11.13")
    expect(html).not.toContain('class="special-event-time"')
    expect(html).not.toContain('class="special-event-location"')
    expect(html).not.toContain("<ul")
  })

  it.each(["", "TBA", "tba"])("hides unknown location and time values: %j", (value) => {
    const html = render([{ Date: "11/13/2026", Location: value, Time: value }])

    expect(html).toContain('<h3 class="special-event-title">TBA</h3>')
    expect(html).not.toContain('class="special-event-location"')
    expect(html).not.toContain('class="special-event-time"')
    expect(html).not.toContain("<ul")
  })

  it("keeps an activity and known location when its time is TBA", () => {
    const html = render([
      { Date: "10/17/2026", Location: "Memorial Room", Time: "TBA", Activity: "Live music" },
      { Date: "10/17/2026", Time: "TBA" },
    ])

    expect(html).toContain('<p class="special-event-location">Memorial Room</p>')
    expect(html).toContain('<li class="special-event-activity"><p>Live music</p></li>')
    expect(html).not.toContain('class="special-event-time"')
    expect(html.match(/<li\b/g)).toHaveLength(1)
  })

  it("keeps a known time when the location is TBA", () => {
    const html = render([{ Date: "10/17/2026", Location: "TBA", Time: "7:00–10:00 PM" }])

    expect(html).toContain('<span class="special-event-time">7:00–10:00 PM</span>')
    expect(html).not.toContain('class="special-event-location"')
  })

  it("uses the first nonblank title and URL for an event", () => {
    const html = render([
      { Date: "10/17/2026", Title: "", URL: "" },
      { Date: "10/17/2026", Title: "October dance", URL: "https://example.com/dance" },
      { Date: "10/17/2026", Title: "Other title", URL: "https://example.com/other" },
    ])

    expect(html).toContain('<a href="https://example.com/dance">October dance</a>')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).not.toContain("Other title")
    expect(html).not.toContain("https://example.com/other")
  })

  it("links the TBA title when a URL has no title", () => {
    const html = render([{ Date: "10/17/2026", URL: "https://example.com/dance" }])

    expect(html).toContain('<h3 class="special-event-title"><a href="https://example.com/dance">TBA</a></h3>')
  })

  it("preserves loading and error states", () => {
    for (const status of ["loading", "error"] as const) {
      const html = renderToStaticMarkup(
        <SpecialEvents title="Special events" events={[]} status={status} />,
      )

      expect(html).toContain(status === "loading"
        ? "Loading special events..."
        : "The special events could not be loaded.")
      expect(html).toContain(`aria-busy="${status === "loading"}"`)
      expect(html).not.toContain("<article")
    }
  })
})

it("bolds weekly lesson labels but not their descriptions", () => {
  const html = renderToStaticMarkup(
    <Schedule title="Schedule" times="Lesson 8:00–9:00 PM" status="loaded" events={[
      { Date: "10/17/2026", Location: "Big Red Barn", "Beginner Program": "Basics", "Advanced Program": "Charleston" },
    ]} />,
  )

  expect(html).toContain("<strong>Beginner: </strong>Basics")
  expect(html).toContain("<strong>Advanced: </strong>Charleston")
  expect(html.match(/<strong>/g)).toHaveLength(2)
})

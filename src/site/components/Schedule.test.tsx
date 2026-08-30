import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SpecialEvents } from "./Schedule"

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
    expect(html.match(/class="special-event-activity"/g)).toHaveLength(3)
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

  it("shows a shared location once and keeps readable times", () => {
    const html = render([
      { Date: "10/17/2026", Time: "6:15–7:00 PM", Activity: "Crash course", Location: "Memorial Room" },
      { Date: "10/17/2026", Time: "7:00–10:00 PM", Activity: "Live music", Location: "Memorial Room" },
    ])

    expect(html.match(/Memorial Room/g)).toHaveLength(1)
    expect(html.indexOf("Memorial Room")).toBeLessThan(html.indexOf("6:15–7:00 PM"))
    expect(html).toContain("7:00–10:00 PM")
    expect(html).toContain('<p class="special-event-activity-title">Live music</p>')
    expect(html).not.toContain("TBA")
  })

  it("shows different or unknown locations with their activities", () => {
    const html = render([
      { Date: "10/17/2026", Activity: "Lesson", Location: "Dance Studio" },
      { Date: "10/17/2026", Activity: "Social", Location: "Memorial Room" },
      { Date: "10/17/2026", Activity: "Afterparty", Location: "" },
    ])
    const activities = html.match(/<li\b.*?<\/li>/g)!

    expect(activities).toHaveLength(3)
    expect(activities[0]).toContain("Dance Studio")
    expect(activities[1]).toContain("Memorial Room")
    expect(activities[2]).toContain("Location TBA")
  })

  it("leaves blank titles blank and keeps date-only events", () => {
    const html = render([{ Date: "11/13/2026", Title: "" }])

    expect(html).not.toContain("<h3")
    expect(html).toContain("11.13")
    expect(html).toContain("Time TBA")
    expect(html).toContain("Location TBA")
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

  it("links the date when a URL has no title", () => {
    const html = render([{ Date: "10/17/2026", URL: "https://example.com/dance" }])

    expect(html).toContain('<a href="https://example.com/dance">10.17</a>')
    expect(html).not.toContain("<h3")
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

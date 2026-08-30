import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { parseCsv, Schedule, SpecialEvents } from "./Schedule"

describe("parseCsv", () => {
  it("maps records to trimmed header names, fills missing cells, and skips blank rows", () => {
    expect(parseCsv("Date, Title \r\n10/17/2099,Dance\r\n ,, \r\n11/13/2099\r\n")).toEqual([
      { Date: "10/17/2099", Title: "Dance" },
      { Date: "11/13/2099", Title: "" },
    ])
  })

  it("parses quoted fields with commas, escaped quotes, and newlines", () => {
    expect(parseCsv('Title,Notes\n"Dance, live music","Say ""hi""\nat the door"')).toEqual([
      { Title: "Dance, live music", Notes: 'Say "hi"\nat the door' },
    ])
  })

  it("returns nothing without data rows", () => {
    expect(parseCsv("")).toEqual([])
    expect(parseCsv("Date,Title\n")).toEqual([])
  })
})

function render(events: Record<string, string>[]) {
  return renderToStaticMarkup(
    <SpecialEvents title="Special events" events={events} status="loaded" />,
  )
}

describe("special events", () => {
  it("groups mixed-format dates into one event and uses the first nonblank title, URL, and location", () => {
    const html = render([
      { Date: "10/17/2099", Title: "", URL: "", Time: "6:15–7:00 PM", Activity: "Crash course" },
      { Date: "11/13/2099", Title: "November dance" },
      { Date: "2099-10-17", Title: "October dance", URL: "https://example.com/dance", Location: "Memorial Room", Time: "7:00–10:00 PM", Activity: "Live music" },
      { Date: "2099-10-17", Title: "Other title", URL: "https://example.com/other" },
    ])

    expect(html.match(/class="special-event-row/g)).toHaveLength(2)
    expect(html).toContain('<a href="https://example.com/dance">October dance</a>')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).not.toContain("Other title")
    expect(html.match(/Memorial Room/g)).toHaveLength(1)
    expect(html).toContain('dateTime="2099-10-17"')
    expect(html.indexOf("Crash course")).toBeLessThan(html.indexOf("Live music"))
    expect(html.indexOf("Live music")).toBeLessThan(html.indexOf("November dance"))
  })

  it("keeps same-titled events on different dates separate and shares nothing between them", () => {
    const html = render([
      { Date: "10/17/2099", Title: "Dance", Location: "Memorial Room", URL: "https://example.com/dance" },
      { Date: "11/13/2099", Title: "Dance" },
    ])
    const events = html.match(/<article\b.*?<\/article>/g)!

    expect(events).toHaveLength(2)
    expect(events[1]).toContain('<h3 class="special-event-title">Dance</h3>')
    expect(events[1]).not.toContain("<a ")
    expect(events[1]).not.toContain("Memorial Room")
  })

  it("hides TBA times and locations while keeping known values", () => {
    const html = render([
      { Date: "10/17/2099", Location: "TBA", Time: "7:00–10:00 PM" },
      { Date: "10/17/2099", Location: "Memorial Room", Time: "tba", Activity: "Live music" },
      { Date: "11/13/2099", URL: "https://example.com/night", Time: "TBA" },
    ])
    const events = html.match(/<article\b.*?<\/article>/g)!

    expect(events).toHaveLength(2)
    expect(events[0]).toContain('<h3 class="special-event-title">TBA</h3>')
    expect(events[0]).toContain('<p class="special-event-location">Memorial Room</p>')
    expect(events[0]).toContain('<span class="special-event-time">7:00–10:00 PM</span>')
    expect(events[0].match(/class="special-event-time"/g)).toHaveLength(1)
    expect(events[0].match(/<li\b/g)).toHaveLength(2)
    expect(events[1]).toContain('<a href="https://example.com/night">TBA</a>')
    expect(events[1]).not.toContain("<ul")
    expect(events[1]).not.toContain('class="special-event-location"')
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

it("renders weekly rows with labeled programs, past-date marking, and TBA fallbacks", () => {
  const html = renderToStaticMarkup(
    <Schedule title="Schedule" times="Lesson 8:00–9:00 PM" status="loaded" events={[
      { Date: "10/17/2099", Location: "Big Red Barn", "Beginner Program": "Basics", "Advanced Program": "—", Notes: "Bring water" },
      { Date: "9/7", Location: "" },
      { Date: "1/1/2001", Location: "Old venue" },
    ]} />,
  )

  expect(html).toContain("<strong>Beginner: </strong>Basics")
  expect(html).not.toContain("Advanced") // an em-dash program is omitted
  expect(html).toContain('<p class="schedule-detail">Bring water</p>')
  // A date without a year still renders, without a machine-readable dateTime.
  expect(html).toContain('<time class="schedule-date">9.7</time>')
  expect(html.match(/TBA/g)).toHaveLength(3) // second row's location and program, third row's program
  expect(html.match(/schedule-row is-past/g)).toHaveLength(1)
})

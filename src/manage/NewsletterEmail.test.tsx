import { renderToString } from "react-dom/server"
import { expect, it } from "vitest"
import type { EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { CommunityBlock, EventsBlock, FeaturedBlock, GlanceBlock } from "./NewsletterEmail"

const weekend: EventRecord = { id: "a", kind: "special", title: "Workshop Weekend", date: "2099-11-13", startTime: "19:15", endTime: "22:00", moreDays: [{ date: "2099-11-14", startTime: "10:30", endTime: "17:00" }], lastDate: "2099-11-14", location: "Flynn Hall", city: "Ithaca", styles: ["Swing"], description: "", published: true, updatedAt: "" }

it.each([
  ["featured", <FeaturedBlock event={weekend} />],
  ["glance", <GlanceBlock events={[weekend]} />],
  ["list", <EventsBlock events={[weekend]} title="Coming up" />],
])("shows only the dates of an event running several days in the %s block", (_, block) => {
  const html = renderToString(block)
  expect(html).toMatch(/Fri, Nov 13.*Sat, Nov 14/)
  expect(html).not.toMatch(/7:15|10:30/)
})

it("lists community events with their own page, group and place", () => {
  const dance: OutsideEvent = { id: "b", kind: "outside", groupName: "Hands Four", title: "Contra", date: "2099-11-14", lastDate: "", startTime: "19:00", endTime: "22:00", location: "Flynn Hall", city: "Rochester", styles: ["Contra"], price: "$5", url: "https://example.com/contra", published: true, needsReview: false, updatedAt: "", fromFeed: true, sourceNote: "" }
  const html = renderToString(<CommunityBlock events={[dance, { ...dance, id: "c", title: "Weekend", startTime: "19:15", lastDate: "2099-11-16" }]} />)
  expect(html).toContain('href="https://example.com/contra"')
  expect(html).toContain("7–10 PM · Flynn Hall, Rochester · Hands Four · $5")
  expect(html).toContain("Sat, Nov 14 – Mon, Nov 16")
  expect(html).not.toContain("7:15")
})

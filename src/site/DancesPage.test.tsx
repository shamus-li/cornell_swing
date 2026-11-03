import { renderToString } from "react-dom/server"
import { expect, it } from "vitest"
import type { EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { DancesPage } from "./DancesPage"

const ours: EventRecord = { id: "a", kind: "special", title: "Blues in Rochester", date: "2099-11-13", startTime: "20:00", endTime: "22:00", location: "Flynn Hall", city: "Rochester", styles: ["Blues"], description: "", published: true, updatedAt: "" }
const theirs: OutsideEvent = { id: "b", kind: "outside", groupName: "Hands Four", title: "Contra", date: "2099-11-14", lastDate: "", startTime: "19:00", endTime: "", location: "", city: "Ithaca", styles: ["Contra"], price: "$5", url: "https://example.com", published: true, needsReview: false, updatedAt: "", fromFeed: true, sourceNote: "" }

it("treats Swing Syndicate's events and other groups' alike for area and style", () => {
  const html = renderToString(<DancesPage events={[ours]} outside={[theirs]} today="2099-01-01" />)
  // The page starts on the Ithaca area, where a Rochester event isn't listed, though its style still has a button.
  expect(html).not.toContain("Blues in Rochester")
  expect(html).toContain(">Blues</button>")
  expect(html).toContain('href="https://example.com"')
})

it("shows only the dates of an event running several days, through its last day", () => {
  const weekend = { ...theirs, startTime: "19:15", lastDate: "2099-11-16" }
  const html = renderToString(<DancesPage events={[]} outside={[weekend]} today="2099-11-15" />)
  expect(html).toContain("Sat, Nov 14 – Mon, Nov 16")
  expect(html).not.toContain("7:15")
})

import { expect, it } from "vitest"
import { buildEvents, buildTransactions, parseSheetRows } from "./finance-data"

// Rows as the Balance Sheet returns them, with its real labels: date serial, amount, source, description, site row's ID, treasurer's event link.
const sheetRow = (serial: number, amount: number | string, source: string, description: string, id = "", event = "") => ["26-27", serial, amount, source, "Y", description, "", id, event]
const rows = parseSheetRows([
  sheetRow(46286, -400, "GPSA", "Fall 26 The Lindy Haunt: Ageless Jazz Band", "", "haunt"),
  sheetRow(46321, -550, "GPSA", "Fall 26 Sweater Weather Swing: Aaron Ruiz & JazzLink", "", "new"),
  sheetRow(45950, -1400, "GPSA", "Fall 25 Sweater Weather Swing: Gaby Cook Instructor Fee", "", "old"),
  sheetRow(46283, 1, "Square", "Fall 26 The Lindy Haunt: Square Profits", "haunt"),
  sheetRow(46339, "", "Square", "Fall 26 Sweater Weather Swing: Square Profits", "new"),
  sheetRow(46312, 150, "Venmo", "Fall 26 The Lindy Haunt: Venmo Profits", "", "haunt"),
])
const events = [{ id: "haunt", title: "The Lindy Haunt 👻", date: "2026-10-17" }, { id: "old", title: "Sweater Weather Swing 2025", date: "2025-11-08" }, { id: "new", title: "Sweater Weather Swing", date: "2026-11-13" }]
const exportRows = {
  uploadedAt: "2026-09-27T20:47:00.000Z",
  rows: [
    { source: "GPSAFC - FY27 Budget and Field Funding", amount: "-400", paymentStatus: "Pending Approval", item: "Ageless Jazz Band", date: "9/21/2026 8:24:18 PM" },
    { source: "GPSAFC - FY26 Budget and Field Funding", amount: "-1483.85", paymentStatus: "Approved", item: "Instructor with transport", date: "10/20/2025 10:04:05 AM" },
    { source: "GPSAFC - FY26 Budget and Field Funding", amount: "-350", paymentStatus: "Rejected", item: "Band", date: "2/10/2026 3:22:11 PM" },
  ],
}

it("explains a gap with CampusGroups row by row", () => {
  const list = buildTransactions(rows, [], exportRows, events)
  const status = (description: string) => list.find(item => item.description === description)?.status
  expect(status("Ageless Jazz Band")).toBe("in-campusgroups")
  expect(status("Aaron Ruiz & JazzLink")).toBe("after-export")
  expect(status("Gaby Cook Instructor Fee")).toBe("not-in-campusgroups")
  expect(status("Instructor with transport")).toBe("only-campusgroups")
  expect(status("Band")).toBeUndefined()
  expect(status("Venmo Profits")).toBeNull()
})

it("replaces the site's batched rows with each payment and links rows to events", () => {
  const list = buildTransactions(rows, [{ id: "p1", paidAt: "2026-10-17T23:30:00Z", amount: 1000, fee: 41, cash: 0, note: "", eventId: "haunt", title: "The Lindy Haunt 👻" }, { id: "refunded", paidAt: "2026-11-03T14:00:00Z", amount: 0, fee: 0, cash: 1, note: "", eventId: null, title: null }], null, events)
  expect(list.some(item => item.description === "Square Profits")).toBe(false)
  expect(list.some(item => item.id === "refunded")).toBe(false)
  expect(list.find(item => item.id === "p1")).toMatchObject({ date: "2026-10-17", amount: 10, fee: 0.41, account: "Square", description: "Card sale" })
  expect(list.find(item => item.description === "Venmo Profits")?.eventId).toBe("haunt")
  expect(list.find(item => item.description === "Gaby Cook Instructor Fee")?.eventId).toBe("old")
})

it("totals each event from the sheet, including its batched rows", () => {
  expect(buildEvents(rows, events).find(event => event.id === "haunt")).toEqual({ id: "haunt", name: "The Lindy Haunt 👻", date: "2026-10-17", earned: 151, spent: 400, grant: 400 })
})

it("keeps two events with one title and semester apart by ID, and leaves a row with no ID unlinked", () => {
  const sameName = [{ id: "first", title: "Swing Night", date: "2026-09-01" }, { id: "second", title: "Swing Night", date: "2026-10-01" }]
  const lines = parseSheetRows([
    sheetRow(46290, -100, "GPSA", "Fall 26 Swing Night: Room Rental", "", "first"),
    sheetRow(46320, -200, "GPSA", "Fall 26 Swing Night: Room Rental", "", "second"),
    sheetRow(46320, -300, "GPSA", "Fall 26 Swing Night: Band"),
  ])
  expect(buildEvents(lines, sameName).map(event => [event.id, event.spent])).toEqual([["second", 200], ["first", 100]])
  expect(buildTransactions(lines, [], null, sameName).find(item => item.amount === -300)).toMatchObject({ eventId: null, eventName: null, description: "Fall 26 Swing Night: Band" })
})

it("pairs one CampusGroups payment with the sheet lines that add up to it", () => {
  const split = parseSheetRows([
    sheetRow(45950, -1400, "GPSA", "Fall 25 Sweater Weather Swing: Gaby Cook Instructor Fee", "", "old"),
    sheetRow(45950, -83.85, "GPSA", "Fall 25 Sweater Weather Swing: Gaby Cook Transportation from NYC", "", "old"),
    sheetRow(45950, -400, "GPSA", "Fall 25 Sweater Weather Swing: Mike Thibult Instructor Fee", "", "old"),
    sheetRow(45950, -210, "GPSA", "Fall 25 Sweater Weather Swing: Room Rental", "", "old"),
  ])
  const list = buildTransactions(split, [], { uploadedAt: "2026-11-03T00:00:00.000Z", rows: [{ source: "GPSAFC - FY26", amount: "-1483.85", paymentStatus: "Approved", item: "Instructor with transport", date: "10/20/2025 10:04:05 AM" }] }, events)
  expect(list.map(item => [item.description, item.status])).toEqual([
    ["Gaby Cook Instructor Fee", "in-campusgroups"],
    ["Gaby Cook Transportation from NYC", "in-campusgroups"],
    ["Mike Thibult Instructor Fee", "not-in-campusgroups"],
    ["Room Rental", "not-in-campusgroups"],
  ])
})

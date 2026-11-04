import type { DanceFeed } from "../src/events/feeds"
import type { EventActivity, FinanceOverview, SquareFeed, Transaction } from "../src/events/finance"
import type { PlaceResult } from "../src/events/locations"
import { todayInNewYork, type ManagedEvent } from "../src/events/model"
import type { OutsideEvent } from "../src/events/outside"
import type { Redirect } from "../src/redirects/redirect"

// Sample data for the dev server. Dates count from today, so there are always upcoming lessons and events.

function daysFromToday(days: number) {
  const date = new Date(`${todayInNewYork()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const nextMonday = (8 - new Date(`${todayInNewYork()}T00:00:00Z`).getUTCDay()) % 7
const barn = { location: "Big Red Barn", locationUrl: "https://www.google.com/maps/search/?api=1&query=Big+Red+Barn&query_place_id=ChIJDR2olYqB0IkRr0G4Rv2qXek", room: "" }
const straight = { location: "Willard Straight Hall", locationUrl: "https://www.google.com/maps/search/?api=1&query=Willard+Straight+Hall&query_place_id=ChIJjYXdZomB0IkRlRAhm3sQd9s" }
const common = { city: "Ithaca", styles: ["Swing"],  published: true, updatedAt: new Date().toISOString(), rsvpCount: 0, tickets: [], moreDays: [] }
const lesson = (week: number, description: string, times = { startTime: "20:00", lessonEndTime: "21:00", socialStartTime: "21:00" }): ManagedEvent => ({ ...common, ...barn, id: `mock-lesson-${week}`, kind: "normal", title: "Monday Night Swing", date: daysFromToday(nextMonday + week * 7), endTime: "22:00", ...times, description })

export const events: ManagedEvent[] = [
  lesson(0, "**Beginner:** 6-count basics\n\n**Advanced:** Swingout smorgasbord"),
  lesson(1, "**Lesson:** Charleston for everyone", { startTime: "19:00", lessonEndTime: "20:00", socialStartTime: "19:00" }),
  lesson(3, "**Lesson:** Blues basics", { startTime: "21:00", lessonEndTime: "22:00", socialStartTime: "20:00" }),
  lesson(2, "Last week in the barn!", { startTime: "20:00", lessonEndTime: "", socialStartTime: "" }),
  { ...common, ...straight, id: "mock-special-1", slug: "sweater-weather-swing", kind: "special", title: "Sweater Weather Swing", date: daysFromToday(nextMonday + 4), startTime: "18:15", endTime: "22:00", room: "Memorial Room", tickets: [{ id: "student", name: "Student", price: "10", days: 1 }, { id: "general", name: "General", price: "15", days: 1 }], rsvpCount: 12,
    description: "## **🍁 Sweater Weather Swing is Back! 🍁**\n\nBundle up for an evening of live music with Aaron Ruiz. **No partner, no experience, and no worries required!**\n\n*Pay at the door (cash or Venmo)*" },
  { ...common, ...straight, id: "mock-special-4", slug: "spring-workshop-weekend", kind: "special", title: "Spring Workshop Weekend", date: daysFromToday(nextMonday + 18), startTime: "19:00", endTime: "23:00", room: "Memorial Room",
    moreDays: [{ date: daysFromToday(nextMonday + 19), startTime: "10:00", endTime: "17:00" }, { date: daysFromToday(nextMonday + 20), startTime: "11:00", endTime: "15:00" }], lastDate: daysFromToday(nextMonday + 20),
    tickets: [{ id: "weekend", name: "Weekend pass", price: "60", days: 3 }, { id: "day", name: "One day", price: "25", days: 1 }],
    description: "Three days of classes with a Friday night dance." },
  { ...common, ...barn, id: "mock-special-3", kind: "special", styles: ["Blues"], title: "Blues Night", date: daysFromToday(nextMonday + 12), startTime: "20:00", endTime: "23:00",
    description: "A slower social with a blues DJ." },
  { ...common, ...straight, id: "mock-special-2", kind: "special", title: "Winter Ball", date: daysFromToday(nextMonday + 25), startTime: "19:00", endTime: "23:00", room: "Memorial Room", tickets: [{ id: "student", name: "Student", price: "5", days: 1 }, { id: "general", name: "General", price: "10", days: 1 }],
    description: "Dress up and dance the semester out with a live big band." },
]

const outside = (id: string, title: string, groupName: string, days: number, startTime: string, endTime: string, location: string, style: string, price: string): OutsideEvent => ({
  id, kind: "outside", title, groupName, date: daysFromToday(nextMonday + days), startTime, endTime, lastDate: "", location, city: "Ithaca", styles: [style], price, url: "https://example.com", published: true, needsReview: false, updatedAt: common.updatedAt, fromFeed: false, sourceNote: "",
})
export const outsideEvents: OutsideEvent[] = [
  outside("mock-outside-1", "First Friday Contra", "Ithaca Contra Dance", 4, "19:30", "22:30", "Bethel Grove Community Center", "Contra", "$10, students free"),
  outside("mock-outside-2", "Salsa Social", "Cornell Salsa", 9, "20:00", "23:00", "Willard Straight Hall", "Salsa", ""),
  { ...outside("mock-outside-3", "Solo Jazz Weekend", "Ithaca Swing", 11, "", "", "Bethel Grove Community Center", "Swing", "Weekend pass $125"), lastDate: daysFromToday(nextMonday + 13), city: "Rochester" },
  outside("mock-outside-5", "Tuesday Night Blues", "Ithaca Blues", 8, "20:00", "22:00", "Bethel Grove Community Center", "Blues", "$5"),
  outside("mock-outside-6", "Second Saturday Contra", "Ithaca Contra Dance", 19, "19:30", "22:30", "Bethel Grove Community Center", "Contra", "$10, students free"),
  outside("mock-outside-7", "Thanksgiving Swing Social", "Ithaca Swing", 22, "19:00", "22:00", "Big Red Barn", "Swing", ""),
  { ...outside("mock-outside-8", "Lindy on the Lake", "Syracuse Swings", 5, "19:00", "23:00", "The Palace Theater", "Swing", "$12"), city: "Syracuse" },
  { ...outside("mock-outside-9", "Rochester Contra Weekend with a Very Long Event Name to Check Wrapping", "Rochester Traditional Dance Society", 15, "", "", "Lovin' Cup", "Contra", "$80"), lastDate: daysFromToday(nextMonday + 16), city: "Rochester" },
  { ...outside("mock-outside-10", "Salsa on the Waterfront", "Binghamton Latin Dance", 17, "20:00", "23:30", "The Lost Dog", "Salsa", ""), city: "Binghamton" },
  // The real list runs to dozens of events across upstate New York.
  ...Array.from({ length: 40 }, (_, index) => ({ ...outside(`mock-outside-more-${index}`, `${["Swing", "Contra", "Salsa", "Tango", "Blues"][index % 5]} Night ${index + 1}`, ["Syracuse Swings", "Rochester Dance Society", "Binghamton Latin Dance", "Albany Tango", "Buffalo Blues"][index % 5], 2 + index * 2, "19:30", "22:00", "Community Hall", ["Swing", "Contra", "Salsa", "Tango", "Blues"][index % 5], ""), city: ["Syracuse", "Rochester", "Binghamton", "Albany", "Buffalo"][index % 5] })),
  { ...outside("mock-outside-4", "Tango Night", "Cornell Tango", 6, "19:00", "21:00", "Willard Straight Hall", "Tango", ""), published: false, needsReview: true, sourceNote: "Requested by tango@example.edu" },
]

export const danceFeeds: DanceFeed[] = [
  { id: "mock-feed-1", name: "Ithaca Contra Dance", style: "Contra", city: "Ithaca", siteUrl: "https://example.com", feedUrl: "https://example.com/contra.ics", skipTitles: "", eventPages: "", checkedAt: `${todayInNewYork()}T11:00:00Z`, feedError: null },
  { id: "mock-feed-2", name: "Cornell Salsa", style: "Salsa", city: "Ithaca", siteUrl: "", feedUrl: "https://example.com/salsa.ics", skipTitles: "Practice", eventPages: "", checkedAt: `${todayInNewYork()}T11:00:00Z`, feedError: "The calendar could not be read." },
]

export const places: PlaceResult[] = [
  { label: "Willard Straight Hall", address: "Ho Plaza, Ithaca, NY", url: straight.locationUrl },
  { label: "Big Red Barn", address: "Garden Ave, Ithaca, NY", url: barn.locationUrl },
]

export const sheet = { url: "https://docs.google.com/spreadsheets/d/mock", error: null }
export const serviceAccountEmail = "sheets@mock.iam.gserviceaccount.com"

export const redirects: Redirect[] = [
  { source: "/join", destination: "https://cornell.campusgroups.com/swingsyndicate", code: 301 },
  { source: "/waiver", destination: "https://example.com/a-long-destination-that-will-not-fit-on-a-phone/waiver-form", code: 302 },
]

export const square: SquareFeed = { square: "Swing Syndicate" }

const row = (id: string, date: string, description: string, account: string, amount: number, eventName: string | null = null, status: Transaction["status"] = null, fee = 0, eventId: string | null = null): Transaction => ({ id, date, description, account, amount, eventName, status, fee, eventId })
const sweater = (id: string, date: string, description: string, account: string, amount: number, fee = 0) => row(id, date, description, account, amount, "Sweater Weather Swing", account === "GPSA" ? "after-export" : null, fee, "mock-special-1")
const sweaterRows = [
  sweater("s1", daysFromToday(-1), "Card sale", "Square", 15, 0.54),
  sweater("s2", daysFromToday(-1), "Card sale", "Square", 10, 0.41),
  sweater("s3", daysFromToday(-1), "Cash sale", "Cash", 10),
  sweater("s4", daysFromToday(-1), "Cash sale", "Cash", 15),
  sweater("sheet-0", "2026-10-26", "Aaron Ruiz & JazzLink", "GPSA", -550),
]

export const finance: FinanceOverview = {
  accounts: [
    { name: "GPSA", start: 0, moneyIn: 3500, moneyOut: 950, balance: 2550, check: { source: "CampusGroups", difference: 550 } },
    { name: "Outside Funding", start: 0, moneyIn: 208.37, moneyOut: 0, balance: 208.37, check: { source: "CampusGroups", difference: 0 } },
    { name: "Square Checking", start: 1149.35, moneyIn: 150.82, moneyOut: 0, balance: 1300.17, check: { source: "Square sales", difference: 0 } },
    { name: "Cash box", start: 989, moneyIn: 225, moneyOut: 0, balance: 1214, check: { source: "Last count", difference: 0.78 } },
  ],
  events: [
    { id: "mock-special-1", name: "Sweater Weather Swing", date: "2026-11-13", earned: 0, spent: 550, grant: 550 },
    { id: "special-2026-10-17", name: "The Lindy Haunt 👻", date: "2026-10-17", earned: 375, spent: 400, grant: 400 },
    { id: "special-2026-03-13", name: "Pre-Spring Swing Fling", date: "2026-03-13", earned: 464, spent: 512.5, grant: 112.5 },
    { id: "special-2025-11-08", name: "Sweater Weather Swing 2025", date: "2025-11-08", earned: 1546, spent: 2986.42, grant: 2093.85 },
    { id: "special-2025-09-20", name: "Back-2-Skool Swing", date: "2025-09-20", earned: 812, spent: 1710, grant: 1210 },
    { id: "special-2025-04-19", name: "Lindy Bloom", date: "2025-04-19", earned: 1970, spent: 6330, grant: 1417.5 },
    { id: "special-2024-12-12", name: "CU Jazz Event", date: "2024-12-12", earned: 150, spent: 0, grant: 0 },
    { id: "special-2024-11-09", name: "Sweater Weather Swing 2024", date: "2024-11-09", earned: 1301, spent: 2564.88, grant: 2082.5 },
  ],
  transactions: [
    ...sweaterRows,
    row("sheet-6", "2026-11-01", "Band deposit", "GPSA", -200),
    row("sheet-1", "2026-10-17", "Venmo Profits", "Venmo", 150, "The Lindy Haunt 👻", null, 0, "special-2026-10-17"),
    row("sheet-2", "2026-09-21", "Ageless Jazz Band", "GPSA", -400, "The Lindy Haunt 👻", "in-campusgroups", 0, "special-2026-10-17"),
    row("sheet-3", "2026-08-23", "Allocation - FY27 Beginning Balance", "Outside Funding", 208.37, null, "in-campusgroups"),
    row("sheet-4", "2026-08-07", "GPSAFC - FY27 Annual Allocation", "GPSA", 3500, null, "in-campusgroups"),
    row("sheet-5", "2025-10-20", "Gaby Cook Instructor Fee", "GPSA", -1400, "Sweater Weather Swing 2025", "not-in-campusgroups", 0, "special-2025-11-08"),
    row("t6", "2025-10-20", "Payment for dance instructor (including transport)", "GPSA", -1483.85, null, "only-campusgroups"),
  ],
  eventOptions: [
    { id: "mock-special-1", title: "Sweater Weather Swing", date: "2026-11-13" },
    { id: "special-2026-10-17", title: "The Lindy Haunt 👻", date: "2026-10-17" },
    { id: "special-2026-03-13", title: "Pre-Spring Swing Fling", date: "2026-03-13" },
    { id: "special-2025-11-08", title: "Sweater Weather Swing 2025", date: "2025-11-08" },
  ],
  campusGroupsUploadedAt: "2026-09-27T20:47:00.000Z",
}

export const activity: EventActivity = {
  attendance: null,
  tickets: [{ name: "Student", count: 2, amount: 20 }, { name: "General", count: 2, amount: 30 }],
  transactions: sweaterRows,
  checkins: [
    { name: "Maya Rivera", email: "maya@example.edu", time: "6:32 PM", ticket: "Student" },
    { name: "Ben Kim", email: "ben@example.com", time: "6:35 PM", ticket: "General" },
    { name: "Ada Lovelace", email: "ada@cornell.edu", time: "6:41 PM", ticket: "Student" },
    { name: "Jeff Bishop", email: "jpb@cornell.edu", time: "6:50 PM", ticket: "General" },
  ],
}
export const eventRsvps = [
  { name: "Maya Rivera", email: "maya@example.edu", createdAt: `${daysFromToday(-9)}T15:00:00Z` },
  { name: "Grace Hopper", email: "grace@example.com", createdAt: `${daysFromToday(-6)}T15:00:00Z` },
]

import type { FinanceOverview, SquareFeed } from "../src/events/finance"
import { todayInNewYork, type ManagedEvent } from "../src/events/model"
import type { OutsideEvent } from "../src/events/outside"

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
  id, kind: "outside", title, groupName, date: daysFromToday(nextMonday + days), startTime, endTime, location, city: "Ithaca", styles: [style], price, url: "https://example.com", published: true, needsReview: false, updatedAt: common.updatedAt, fromFeed: false, sourceNote: "",
})
export const outsideEvents: OutsideEvent[] = [
  outside("mock-outside-1", "First Friday Contra", "Ithaca Contra Dance", 4, "19:30", "22:30", "Bethel Grove Community Center", "Contra", "$10, students free"),
  outside("mock-outside-2", "Salsa Social", "Cornell Salsa", 9, "20:00", "23:00", "Willard Straight Hall", "Salsa", ""),
]

const paid = (id: string, days: number, amount: number, cash: boolean, event: string) => ({ id, paidAt: `${daysFromToday(days)}T00:30:00Z`, amount, cash, note: "", event })
export const square: SquareFeed = { square: "Swing Syndicate", payments: [paid("mock-payment-1", -1, 1000, false, "Monday Night Swing"), paid("mock-payment-2", -1, 500, true, "Monday Night Swing")] }

export const finance: FinanceOverview = {
  accounts: [
    { name: "GPSA", note: "Doesn't carry over", start: 0, moneyIn: 3500, moneyOut: 950, balance: 2550, check: { source: "CampusGroups", amount: 3100, difference: 550 } },
    { name: "Outside Funding", note: "Held at Cornell, carries over", start: 0, moneyIn: 208.37, moneyOut: 0, balance: 208.37, check: { source: "CampusGroups", amount: 208.37, difference: 0 } },
    { name: "Square Checking", note: "Door card sales and the old Venmo balance", start: 1149.35, moneyIn: 150.82, moneyOut: 0, balance: 1300.17, check: { source: "Square sales", amount: 0.82, difference: 0 } },
    { name: "Cash box", note: "Balance is what the box should hold", start: 989, moneyIn: 225, moneyOut: 0, balance: 1214, check: { source: "Last count", amount: 1214.78, difference: 0.78 } },
  ],
  events: [
    { name: "Sweater Weather Swing", date: "2026-11-13", people: null, earned: 0, spent: 550, grant: 550 },
    { name: "The Lindy Haunt", date: "2026-10-17", people: null, earned: 375, spent: 400, grant: 400 },
    { name: "Pre-Spring Swing Fling", date: "2026-03-13", people: null, earned: 464, spent: 512.5, grant: 112.5 },
    { name: "Sweater Weather Swing", date: "2025-11-08", people: null, earned: 1546, spent: 2986.42, grant: 2093.85 },
    { name: "Back-2-Skool Swing", date: "2025-09-20", people: null, earned: 812, spent: 1710, grant: 1210 },
    { name: "Lindy Bloom", date: "2025-04-20", people: null, earned: 1970, spent: 6330, grant: 1417.5 },
    { name: "CU Jazz Event", date: "2024-12-10", people: null, earned: 150, spent: 0, grant: 0 },
    { name: "Sweater Weather Swing", date: "2024-11-10", people: null, earned: 1301, spent: 2564.88, grant: 2082.5 },
  ],
  unassigned: { count: 4, amount: 133.8 },
  grantExpires: "2027-07-31",
  campusGroupsUploadedAt: "2026-09-27T20:47:00.000Z",
}

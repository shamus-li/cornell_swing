import type { SquareFeed } from "../src/events/finance"
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
const common = { published: true, updatedAt: new Date().toISOString(), rsvpCount: 0, studentPrice: "", generalPrice: "" }
const lesson = (week: number, description: string, times = { startTime: "20:00", lessonEndTime: "21:00", socialStartTime: "21:00" }): ManagedEvent => ({ ...common, ...barn, id: `mock-lesson-${week}`, kind: "normal", title: "Monday Night Swing", date: daysFromToday(nextMonday + week * 7), endTime: "22:00", ...times, description })

export const events: ManagedEvent[] = [
  lesson(0, "**Beginner:** 6-count basics\n\n**Advanced:** Swingout smorgasbord"),
  lesson(1, "**Lesson:** Charleston for everyone", { startTime: "19:00", lessonEndTime: "20:00", socialStartTime: "19:00" }),
  lesson(3, "**Lesson:** Blues basics", { startTime: "21:00", lessonEndTime: "22:00", socialStartTime: "20:00" }),
  lesson(2, "Last week in the barn!", { startTime: "20:00", lessonEndTime: "", socialStartTime: "" }),
  { ...common, ...straight, id: "mock-special-1", slug: "sweater-weather-swing", kind: "special", title: "Sweater Weather Swing", date: daysFromToday(nextMonday + 4), startTime: "18:15", endTime: "22:00", room: "Memorial Room", studentPrice: "10", generalPrice: "15", rsvpCount: 12,
    description: "## **🍁 Sweater Weather Swing is Back! 🍁**\n\nBundle up for an evening of live music with Aaron Ruiz. **No partner, no experience, and no worries required!**\n\n*Pay at the door (cash or Venmo)*" },
  { ...common, ...barn, id: "mock-special-3", kind: "special", title: "Blues Night", date: daysFromToday(nextMonday + 12), startTime: "20:00", endTime: "23:00",
    description: "A slower social with a blues DJ." },
  { ...common, ...straight, id: "mock-special-2", kind: "special", title: "Winter Ball", date: daysFromToday(nextMonday + 25), startTime: "19:00", endTime: "23:00", room: "Memorial Room", studentPrice: "5", generalPrice: "10",
    description: "Dress up and dance the semester out with a live big band." },
]

const outside = (id: string, title: string, groupName: string, days: number, startTime: string, endTime: string, venue: string, style: string, price: string): OutsideEvent => ({
  id, title, groupName, date: daysFromToday(nextMonday + days), startTime, endTime, venue, city: "Ithaca", styles: [style], price, url: "https://example.com", status: "published", updatedAt: common.updatedAt, fromFeed: false, sourceNote: "",
})
export const outsideEvents: OutsideEvent[] = [
  outside("mock-outside-1", "First Friday Contra", "Ithaca Contra Dance", 4, "19:30", "22:30", "Bethel Grove Community Center", "Contra", "$10, students free"),
  outside("mock-outside-2", "Salsa Social", "Cornell Salsa", 9, "20:00", "23:00", "Willard Straight Hall", "Salsa", ""),
]

const paid = (id: string, days: number, amount: number, cash: boolean, event: string) => ({ id, paidAt: `${daysFromToday(days)}T00:30:00Z`, amount, cash, note: "", event })
export const square: SquareFeed = { square: "Swing Syndicate", payments: [paid("mock-payment-1", -1, 1000, false, "Monday Night Swing"), paid("mock-payment-2", -1, 500, true, "Monday Night Swing")] }

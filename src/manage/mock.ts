import { todayInNewYork, type ManagedEvent } from "../events/model"

// Dev-only sample events, loaded by /manage/?mock so the manager works without signing in.
// Dates count from today, so there are always upcoming Monday lessons and special events. Saving events still needs the API.

function daysFromToday(days: number) {
  const date = new Date(`${todayInNewYork()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const nextMonday = (8 - new Date(`${todayInNewYork()}T00:00:00Z`).getUTCDay()) % 7
const barn = { location: "Big Red Barn", locationUrl: "https://www.google.com/maps/search/?api=1&query=Big+Red+Barn&query_place_id=ChIJDR2olYqB0IkRr0G4Rv2qXek", room: "" }
const straight = { location: "Willard Straight Hall", locationUrl: "https://www.google.com/maps/search/?api=1&query=Willard+Straight+Hall&query_place_id=ChIJjYXdZomB0IkRlRAhm3sQd9s" }
const common = { published: true, updatedAt: new Date().toISOString(), rsvpCount: 0, studentPrice: "", generalPrice: "" }
const lesson = (week: number, description: string, times = { startTime: "20:00", lessonEndTime: "21:00" }): ManagedEvent => ({ ...common, ...barn, id: `mock-lesson-${week}`, kind: "normal", title: "Monday Night Swing", date: daysFromToday(nextMonday + week * 7), endTime: "22:00", ...times, description })

export const events: ManagedEvent[] = [
  lesson(0, "**Beginner:** 6-count basics\n\n**Advanced:** Swingout smorgasbord"),
  lesson(1, "**Lesson:** Charleston for everyone", { startTime: "19:00", lessonEndTime: "21:00" }),
  lesson(2, "Last week in the barn!", { startTime: "20:00", lessonEndTime: "" }),
  { ...common, ...straight, id: "mock-special-1", kind: "special", title: "Sweater Weather Swing", date: daysFromToday(nextMonday + 4), startTime: "18:15", endTime: "22:00", room: "Memorial Room", studentPrice: "10", generalPrice: "15", rsvpCount: 12,
    description: "## **🍁 Sweater Weather Swing is Back! 🍁**\n\nBundle up for an evening of live music with Aaron Ruiz. **No partner, no experience, and no worries required!**\n\n*Pay at the door (cash or Venmo)*" },
  { ...common, ...barn, id: "mock-special-3", kind: "special", title: "Blues Night", date: daysFromToday(nextMonday + 12), startTime: "20:00", endTime: "23:00",
    description: "A slower social with a blues DJ." },
  { ...common, ...straight, id: "mock-special-2", kind: "special", title: "Winter Ball", date: daysFromToday(nextMonday + 25), startTime: "19:00", endTime: "23:00", room: "Memorial Room", studentPrice: "5", generalPrice: "10",
    description: "Dress up and dance the semester out with a live big band." },
]

// The saved newsletter template lives in memory, so saving and restoring parts can be tried without the API.
const template: Record<string, string> = {}
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  if (input !== "/manage/api/newsletter-template") return realFetch(input, init)
  const body = init?.body ? JSON.parse(String(init.body)) as { part: string; html?: string } : null
  if (init?.method === "PUT" && body) template[body.part] = body.html!
  if (init?.method === "DELETE" && body) delete template[body.part]
  return Response.json(init?.method ? { success: true } : { parts: template })
}

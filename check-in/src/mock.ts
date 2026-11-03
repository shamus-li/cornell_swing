import type { Member, NextSteps, WaiverBlock } from "@/lib/checkin"
import { searchMembers } from "@/lib/member-search"

// Dev-only stand-in for the check-in API, loaded by /check-in/?mock. Nothing reaches the Sheet,
// Notion, or CampusGroups. Add &waiver=changed to see the kiosk skip the waiver when the form
// changed, &waiver=down for the sign-on-your-phone fallback when CampusGroups is down, or
// &waiver=refuses for that fallback after signing. Add &priced for an event with tickets to buy, or
// &events for a day with several events to choose from.
// Jeff Bishop still needs the General Risk waiver and Ada Lovelace has signed it.

const MEMBERS: Member[] = [
  { id: "mock-ada", name: "Ada Lovelace", email: "ada@cornell.edu", phone: "(607) 555-0101", affiliation: "Undergraduate Student" },
  { id: "mock-grace", name: "Grace Hopper", email: "gh@cornell.edu", phone: "(607) 555-0102", affiliation: "Faculty" },
  { id: "mock-jeff", name: "Jeff Bishop", email: "jpb@cornell.edu", phone: "(607) 555-0103", affiliation: "Staff" },
  { id: "mock-nora", name: "Nora Murphy", email: "nora@example.com", phone: "(607) 555-0104", affiliation: "Community Member" },
  { id: "mock-alan", name: "Alan Turing", email: "alan@example.com", phone: "(607) 555-0105", affiliation: "Alumni" },
]

// Stands in for the uploaded CampusGroups list.
const CAMPUSGROUPS: Record<string, { member: boolean; generalRisk: boolean }> = {
  "ada@cornell.edu": { member: true, generalRisk: true },
  "gh@cornell.edu": { member: false, generalRisk: true },
}

// The waiver as CampusGroups showed it on October 6, 2026.
const WAIVER_BLOCKS: WaiverBlock[] = [
  { list: false, runs: [
    { text: "Non-Cornell Participant Assumption Of Risk And Hold Harmless Agreement", bold: true, italic: false },
  ] },
  { list: false, runs: [
    { text: "Please read this entire document carefully. This document contains important information and legally binding terms.", bold: true, italic: true },
  ] },
  { list: false, runs: [
    { text: "By signing this agreement, you give up your right to bring a court action to recover damages or obtain any other remedy for any injury to yourself or your property including death, however caused, arising out of your participation in the hosting Department/Unit, or Organization “Event” activities now or any time in the future.", bold: true, italic: false },
  ] },
  { list: false, runs: [
    { text: "WARNINGS", bold: true, italic: false },
    { text: ": I am aware that this Event activities have inherent risks. Among these risks is the risk of injury from participation in physical activity including but not limited to ", bold: false, italic: false },
    { text: "Trauma From Physical Contact with Participants, Equipment, Or Playing Surface; Brain Damage; Traumatic Brain Injury; Paralysis; Lacerations; Head, Eye, Back, Neck, Spine Injuries; Ligament And Tendon Injuries; Slips, Trips, And Falls; Musculoskeletal Injuries Including Broken Bones, Dislocations, Sprains, And Strains; Bruises, Cuts, And Blisters To The Face, Body, And Appendages; Heart Attack; Stroke; Hypothermia; Dehydration; and Even Death.", bold: true, italic: true },
  ] },
  { list: false, runs: [
    { text: "AGREEMENT TO ASSUME RISKS", bold: true, italic: false },
    { text: ": By signing below, I acknowledge and agree that these are inherent risks of the Event and that I understand I will be exposed to each of these risks and other risks of injury or death by choosing to participate in this Event activities. I acknowledge and agree that my participation is voluntary and that if I believe any activity is unsafe for any reason, including the degree of skill required and my proficiency with that skill, I will immediately discontinue my participation in the activity. I further acknowledge and agree that I am voluntarily assuming all the inherent risks of participation.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "Assumption of Risk, Waiver, and Release of Liability:", bold: true, italic: false },
    { text: " I understand that the risk of becoming exposed to or infected by communicable diseases, including COVID-19, at Cornell University may arise from the actions, omissions, or negligence of myself and/or others. I recognize that the University cannot limit all potential sources of infection from communicable diseases occurring at on- or off-campus locations. I knowingly and voluntarily assume all risks, including but not limited to, the risk of illness, death, bodily injury, disability, or exposure or infection, for myself, and my family. I fully understand the risks, I knowingly and voluntarily waive and release Cornell University trustees, officers, agents, volunteers, employees, students, and the hosting department/unit or organization (the “Released Parties”) from all present and future claims of any type, including negligence, for any harm or loss, including but not limited to, economic loss, personal injury, disease, death or property damage suffered by me or my family, as a result of my participation in a Cornell University program or activity or as a result of my presence on Cornell University’s campus. I agree to indemnify, hold harmless, and covenant not to sue the Released Parties for any personal injury, death, medical expenses, disability, loss of capacity, property damage, court costs, attorney’s fees, or other loss arising out of the", bold: false, italic: false },
    { text: " ", bold: true, italic: false },
    { text: "activity listed in the form below.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "WAIVER OF CLAIMS", bold: true, italic: false },
    { text: ": In consideration of the opportunity to participate in the Event/Program, which may include the use of Cornell facilities, equipment, and property, and/or travel associated with event, I hereby waive all claims against the Released Parties from any liabilities, damages, expenses, causes of action, claims, or demands of any nature whatsoever, including any claims of negligence, on account of personal injury, exposure to communicable diseases, including COVID-19, property damage, death, or accident of any kind related to my participation in this event, however caused, except in the event of gross negligence. I intend for this waiver to bind my family members, heirs, executors, administrators, representatives, and assigns, as well as myself.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "I understand that neither Cornell University nor the hosting Department/Unit or Organization provides any accident or medical insurance and that I am required to provide my own accident and medical insurance. I hereby agree that I am financially responsible for all such expenses. I understand that the hosting department/unit or organization does not carry radios or cell phones, and I may be far from medical facilities.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "I understand that neither Cornell University nor the hosting department/unit or organization provides any private vehicle insurance and that I am required to provide my own private vehicle insurance should I elect to use my own vehicle for transportation to or from the Event/Program’s activities. In the event of an accident or injury in my private vehicle or any other private vehicle in which I may ride to or from this Event/Program’s activity, I agree to the same terms outlined above.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "I understand that all participants are subject to Cornell University regulations including the hosting department/unit or organization policies, laws of the United States, and the laws of New York State. In the event of a violation of these or behavior that is considered by ", bold: false, italic: false },
    { text: "the hosting Organization ", bold: true, italic: true },
    { text: "to be detrimental to me as a participant, other participants, or the event or program, Cornell University and/or the hosting department/unit or organization shall have the right to dismiss me from the Event/Program while retaining any applicable payment(s).", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "I hereby grant and authorize Cornell University the right and permission to use photographic portraits, pictures, digital images, videotapes, interviews, likenesses, or reproductions thereof for any lawful purposes, including without limitation in any Cornell University publication, illustration, advertising, trade, or historical archive, publicity materials, websites, and social media platforms in any manner or medium worldwide, without payment or any other consideration. I understand that the use or non-use of these images does not create any financial obligation for Cornell University or its programs to me.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "This Waiver and Release of Claims shall be governed by the laws of the State of New York, without consideration of its conflicts of laws principles, and any dispute about the terms shall be brought in a court of competent jurisdiction in the State of New York with venue in Tompkins County.", bold: false, italic: false },
  ] },
  { list: true, runs: [
    { text: "I hereby certify that I am physically fit and able to participate in this activity.", bold: false, italic: false },
  ] },
  { list: true, runs: [
    { text: "I certify that I am of lawful age and legally competent to sign this Waiver and Release of Claims. I understand the terms herein are contractual.", bold: false, italic: false },
  ] },
  { list: false, runs: [
    { text: "I have read and fully understand the above warnings and agree to assume all risks, as well as the waiver/ release of claims. I have signed this document of my own free will and agree to the terms outlined herein.", bold: true, italic: false },
  ] },
]

const checkedIn = new Set<string>()
const priced = new URLSearchParams(window.location.search).has("priced")
const justPaid = new URLSearchParams(window.location.search).has("paid") ? ["Ada Lovelace"] : []
const MOCK_TICKETS = [
  { id: "student", name: "Student", amount: 1000, days: 1 },
  { id: "general", name: "General", amount: 1500, days: 1 },
]
const doorCharges = new Map<string, { id: string; body: Record<string, string>; ticketName: string; amount: number; createdAt: string; verifying: boolean }>([
  ["mock-a", { id: "mock-a", body: { name: "Maya Rivera" }, ticketName: "Student", amount: 1000, createdAt: new Date().toISOString(), verifying: false }],
  ["mock-b", { id: "mock-b", body: { name: "Ben Kim" }, ticketName: "General", amount: 1500, createdAt: new Date().toISOString(), verifying: false }],
])
const waiverMode = new URLSearchParams(window.location.search).get("waiver")
const MOCK_EVENTS = new URLSearchParams(window.location.search).has("events")
  ? [
      { id: "workshop", title: "Balboa Workshop", time: "3:00–5:00 PM" },
      { id: "lesson", title: "Monday Night Swing", time: "8:00–10:00 PM" },
    ]
  : [{ id: "dance", title: "Swing Dance", time: "7:00–9:00 PM" }]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function nextSteps(email: string, affiliation: string): NextSteps {
  if (affiliation === "Community Member" || affiliation === "Alumni") return { waiver: null, joinCampusGroups: false }
  const person = CAMPUSGROUPS[email]
  return { waiver: person?.generalRisk ? null : "cornell", joinCampusGroups: !person?.member }
}

async function respond(url: string, init: RequestInit = {}): Promise<Response> {
  const [path, query] = url.split("?")
  const chosen = MOCK_EVENTS.find((event) => event.id === new URLSearchParams(query).get("event")) ?? MOCK_EVENTS[0]
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, string>) : {}
  const checkinKey = `${chosen.id}|${body.email}`
  if (path.endsWith("api/events")) return json({ events: MOCK_EVENTS })
  if (path.endsWith("api/members")) {
    await wait(150)
    return json({ members: searchMembers(MEMBERS, body.q, {}) })
  }
  if (path.endsWith("api/checkins/status")) {
    await wait(300)
    return json({ checkedIn: checkedIn.has(checkinKey), next: nextSteps(body.email, body.affiliation) })
  }
  if (path.endsWith("api/door/queue")) {
    return json({ applicationId: "mock-app", justPaid, charges: [...doorCharges.values()].map(({ id, body: person, ticketName, amount, createdAt, verifying }) => ({ id, label: person.name, ticketName, amount, createdAt, verifying })) })
  }
  if (path.endsWith("api/door/charges")) {
    const id = `mock-${doorCharges.size + 1}`
    const ticket = MOCK_TICKETS.find((option) => option.id === body.ticketId) ?? MOCK_TICKETS[0]
    doorCharges.set(id, { id, body, ticketName: ticket.name, amount: ticket.amount, createdAt: new Date().toISOString(), verifying: false })
    return json({ id, amount: ticket.amount }, 201)
  }
  if (path.endsWith("api/door/settle")) {
    await wait(300)
    checkedIn.add(checkinKey)
    return json({ message: "Checked in", next: nextSteps(body.email, body.affiliation) }, 201)
  }
  const doorCharge = path.match(/api\/door\/charges\/([^/]+)/)?.[1]
  if (doorCharge) {
    if (init.method === "DELETE") doorCharges.delete(doorCharge)
    if (path.endsWith("/tap")) doorCharges.get(doorCharge)!.verifying = true
    if (path.endsWith("/return")) {
      if (body.ok) doorCharges.delete(doorCharge)
      return json({ status: body.ok ? "paid" : "pending", name: "Maya" })
    }
    return json({ status: "pending" })
  }
  if (path.endsWith("api/checkins")) {
    await wait(400)
    const next = nextSteps(body.email, body.affiliation)
    if (checkedIn.has(checkinKey)) return json({ message: "Already checked in", next }, 409)
    if (priced) return json({ message: "Choose a ticket", event: chosen.title, tickets: MOCK_TICKETS }, 402)
    checkedIn.add(checkinKey)
    return json({ message: "Checked in", next }, 201)
  }
  if (path.endsWith("api/waiver") && init.method === "POST") {
    await wait(1200)
    if (waiverMode === "refuses") return json({ unavailable: true }, 503)
    return json({ message: "Waiver signed" }, 201)
  }
  if (path.endsWith("api/waiver")) {
    await wait(500)
    if (waiverMode === "changed") return json({ formChanged: true }, 503)
    if (waiverMode === "down") return json({ unavailable: true }, 503)
    const today = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date())
    return json({ blocks: WAIVER_BLOCKS, eventName: MOCK_EVENTS.length > 1 ? chosen.title : `${today} Swing Dance` })
  }
  return json({ message: "Not found" }, 404)
}

const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url
  return path.includes("api/") ? respond(path, init) : realFetch(input, init)
}

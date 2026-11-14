import { DurableObject } from "cloudflare:workers"

import {
  isAffiliation,
  isValidEmail,
  isValidName,
  normalizeName,
  normalizePhone,
  PARTICIPANT_WAIVER_AFFILIATIONS,
  signatureMatchesName,
  type Attendee,
  type NextSteps,
  type Member,
} from "../src/lib/checkin"
import type { CheckinStats } from "../src/lib/member-search"
import { cachedMembers, searchCachedMembers, storeCheckinStats, storeMemberCache } from "./cache"
import { cancelCharge, findCharge, findTicket, isVerifying, justPaidCharges, openCardCharge, queuedCharges, settleAtDoor, settleCardCharge, ticketsToOffer, useHeldTicket, volunteerTicket, type DoorCharge } from "./door"
import { eventAtSheetTimestamp, eventChoices, findCheckinEvent, type EventSession } from "./events"
import {
  type CheckinRow,
  appendWaiver,
  dateKeyForSheetTimestamp,
  dateKeyInTimeZone,
  getGoogleAccessToken,
  readCheckins,
  readWaivers,
  sortCheckins,
  timestampForSheet,
  updateCheckinRow,
} from "./google"
import { sendAlert } from "../../src/events/alert-email"
import { MEMBER_ID_PATTERN } from "./member-id"
import { matchMember, MemberConflict } from "./member-match"
import {
  type AttendanceEvent,
  findAttendanceEvent,
  findOrCreateAttendanceEvent,
  loadMemberRoster,
  type MemberRecord,
  type MemberRoster,
  setGeneralRiskWaiver,
  syncEventWaivers,
  rosterMembers,
  RowProblem,
  syncEventAttendance,
  syncMemberAttendance,
} from "./notion"
import { ATTENDANCE_SYNC_STATE_KEY, ATTENDANCE_SYNC_STATE_VERSION } from "./sync-state"
import { isRecord } from "./util"
import { loadWaiverForm, readWaiver, submitWaiver, WAIVER_FORM_URL, WaiverFormChanged, waiverEventName } from "./waiver"
import { generalRiskTag } from "../../src/events/campusgroups"
import { sendUnsentCash, syncPayments } from "../../src/events/square"
import { campusGroupsKey, type CampusGroupsData } from "../../src/events/campusgroups"

export { CheckinGuard } from "./checkin-guard"

const MEMBER_SEARCH_PATH = "/check-in/api/members"
const CHECKIN_PATH = "/check-in/api/checkins"
const CHECKIN_STATUS_PATH = "/check-in/api/checkins/status"
const WAIVER_PATH = "/check-in/api/waiver"
const EVENTS_PATH = "/check-in/api/events"
const DOOR_PATH = "/check-in/api/door/"
type AccessTokenProvider = (env: Env) => Promise<string>

// Includes the row's event, which for rows without an Event ID depends on the events in /manage.
function checkinFingerprint(row: CheckinRow, eventId: string): string {
  return JSON.stringify([row.timestamp, row.name, row.email, row.affiliation, row.memberId, row.phone, eventId])
}

// Missing, outdated, or unreadable state means every night is synced again, which is safe because
// syncing a night is idempotent.
async function readAttendanceSyncState(env: Env): Promise<Set<string> | null> {
  const value: unknown = await env.MEMBER_CACHE.get(ATTENDANCE_SYNC_STATE_KEY, "json")
  if (!isRecord(value) || value.version !== ATTENDANCE_SYNC_STATE_VERSION || !Array.isArray(value.fingerprints)) return null
  return new Set(value.fingerprints.filter((fingerprint) => typeof fingerprint === "string"))
}

function sameFingerprints(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((fingerprint) => right.has(fingerprint))
}

async function writeAttendanceSyncState(env: Env, fingerprints: Set<string>): Promise<void> {
  await env.MEMBER_CACHE.put(
    ATTENDANCE_SYNC_STATE_KEY,
    JSON.stringify({ version: ATTENDANCE_SYNC_STATE_VERSION, fingerprints: [...fingerprints] }),
  )
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The kiosk must send a name and phone; older Sheet rows may lack both.
function validateAttendee(value: unknown, fromKiosk = false): Attendee | null {
  if (!isRecord(value)) return null
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : ""
  const memberId = typeof value.memberId === "string" ? value.memberId.trim() : null
  const enteredName = typeof value.name === "string" ? normalizeName(value.name) : ""
  const name = enteredName.toLowerCase() === email ? "" : enteredName
  const enteredPhone = typeof value.phone === "string" ? value.phone.trim() : ""
  const phone = fromKiosk ? normalizePhone(enteredPhone) : enteredPhone
  if (
    (memberId !== null && !MEMBER_ID_PATTERN.test(memberId)) ||
    (name ? !isValidName(name) : fromKiosk) ||
    (fromKiosk && !phone) ||
    phone.length > 40 ||
    !email ||
    !isValidEmail(email) ||
    !isAffiliation(value.affiliation)
  ) {
    return null
  }
  return { memberId, name, email, affiliation: value.affiliation, phone }
}

async function handleMemberSearch(request: Request, env: Env): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ message: "Invalid search data" }, 400)
  }
  if (!isRecord(payload) || typeof payload.q !== "string") {
    return json({ message: "Invalid search data" }, 400)
  }
  const query = payload.q.trim()
  if (!query) return json({ members: [] })
  if (query.length > 100) return json({ message: "Search is too long" }, 400)

  const identity = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim().toLocaleLowerCase()
    || "access-identity-missing"
  const { success } = await env.MEMBER_SEARCH_RATE_LIMITER.limit({ key: identity })
  if (!success) {
    const response = json({ message: "Too many member searches. Wait a minute and try again." }, 429)
    response.headers.set("Retry-After", "60")
    return response
  }
  return json({ members: await searchCachedMembers(env, query) })
}

// Reads a kiosk check-in and links it to an existing member record, or returns the error response.
async function readCheckinAttendee(request: Request, env: Env): Promise<Attendee | Response> {
  const contentLength = Number.parseInt(request.headers.get("Content-Length") ?? "0", 10)
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return json({ message: "Check-in data is too large" }, 413)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ message: "Invalid check-in data" }, 400)
  }
  const attendee = validateAttendee(payload, true)
  if (!attendee) return json({ message: "Enter a valid name, email, phone number, and affiliation" }, 400)

  const members = await cachedMembers(env)
  // A Member ID only comes from picking a name in the dropdown, so it must still be on the roster.
  if (attendee.memberId && !members.some((member) => member.id === attendee.memberId)) {
    return json(
      { message: "That member record is no longer available. Select “Not you?” and choose again." },
      400,
    )
  }
  try {
    attendee.memberId = matchMember(members, attendee)?.id ?? null
  } catch (error) {
    if (error instanceof MemberConflict) return json({ message: error.message }, 400)
    throw error
  }
  return attendee
}

// The event a check-in at this moment belongs to, and the moment in Sheet form. The kiosk names the event in
// the URL when the day has several to choose from.
async function eventNow(request: Request, env: Env, timestamp: number): Promise<{ event: EventSession; sheetTimestamp: number } | Response> {
  const sheetTimestamp = timestampForSheet(timestamp, env.TIME_ZONE)
  const chosen = new URL(request.url).searchParams.get("event")
  if (!chosen) return { event: await eventAtSheetTimestamp(env, sheetTimestamp), sheetTimestamp }
  const event = (await eventChoices(env, sheetTimestamp)).find(({ id }) => id === chosen)
  return event ? { event, sheetTimestamp } : json({ message: "That event isn't available anymore. Choose another event." }, 400)
}

export async function handleCheckin(request: Request, env: Env, timestamp = Date.now()): Promise<Response> {
  const attendee = await readCheckinAttendee(request, env)
  if (attendee instanceof Response) return attendee

  const now = await eventNow(request, env, timestamp)
  if (now instanceof Response) return now
  const { event, sheetTimestamp } = now
  const guard = env.CHECKIN_GUARD.getByName(event.sessionDate)
  if (!await guard.isCheckedIn(attendee, event.id)) {
    const tickets = ticketsToOffer(event)
    if (tickets.length && !await useHeldTicket(env, event, attendee)) return json({ message: "Choose a ticket", event: event.title, tickets }, 402)
  }
  const memberId = await guard.checkin(attendee, event.id, sheetTimestamp)
  const next = await nextSteps(env, attendee)
  return memberId === null
    ? json({ message: "Already checked in", next }, 409)
    : json({ message: "Checked in", next }, 201)
}

const firstName = (charge: DoorCharge) => (JSON.parse(charge.attendee) as Attendee).name.split(/\s+/)[0]
const isPaid = (charge: DoorCharge) => charge.status !== "pending" && charge.status !== "canceled"

async function syncSquareQuietly(env: Env): Promise<void> {
  await syncPayments(env).catch((error: unknown) => console.error(JSON.stringify({ message: "Square sync failed", error: errorMessage(error) })))
}

// Several laptops and the phone all ask while someone is paying, so only one of them gets to look at Square
// every few seconds. Moving syncedAt early is safe because each sync lists the last few days again.
const SYNC_EVERY_MS = 5_000
async function syncSquareIfStale(env: Env): Promise<void> {
  const claimed = await env.EVENTS_DB.prepare("UPDATE square_connection SET syncedAt = ? WHERE syncedAt < ?")
    .bind(new Date().toISOString(), new Date(Date.now() - SYNC_EVERY_MS).toISOString()).run()
  if (claimed.meta.changes) await syncSquareQuietly(env)
}

// The laptop's payment step and the iPhone's list. A card charge is settled by Square's return, or by its
// payment showing up in Square if the return never arrives.
async function handleDoor(request: Request, env: Env, path: string, timestamp = Date.now()): Promise<Response> {
  if (path === "queue" && request.method === "GET") {
    let charges = await queuedCharges(env)
    if (charges.some(isVerifying)) {
      await syncSquareIfStale(env)
      charges = await queuedCharges(env)
    }
    return json({
      applicationId: env.SQUARE_APPLICATION_ID,
      justPaid: (await justPaidCharges(env)).map(firstName),
      charges: charges.map((charge) => ({ id: charge.id, label: (JSON.parse(charge.attendee) as Attendee).name, ticketName: charge.ticketName, amount: charge.amount, createdAt: charge.createdAt, verifying: isVerifying(charge) })),
    })
  }
  if (path === "charges" && request.method === "POST") {
    const { ticketId } = (await request.clone().json().catch(() => ({}))) as { ticketId?: unknown }
    const attendee = await readCheckinAttendee(request, env)
    if (attendee instanceof Response) return attendee
    const now = await eventNow(request, env, timestamp)
    if (now instanceof Response) return now
    const { event } = now
    const ticket = findTicket(event, ticketId)
    if (!ticket?.amount) return json({ message: "Choose a ticket" }, 400)
    if (await env.CHECKIN_GUARD.getByName(event.sessionDate).isCheckedIn(attendee, event.id)) {
      return json({ message: "Already checked in", next: await nextSteps(env, attendee) }, 409)
    }
    const charge = await openCardCharge(env, event, attendee, ticket)
    return json({ id: charge.id, amount: charge.amount }, 201)
  }
  if (path === "settle" && request.method === "POST") {
    const { id, method, ticketId } = (await request.clone().json().catch(() => ({}))) as { id?: unknown; method?: unknown; ticketId?: unknown }
    if (typeof id !== "string" || !id) return json({ message: "Invalid payment" }, 400)
    if (method !== "cash" && method !== "free" && method !== "waived") return json({ message: "Choose how to pay" }, 400)
    const attendee = await readCheckinAttendee(request, env)
    if (attendee instanceof Response) return attendee
    const now = await eventNow(request, env, timestamp)
    if (now instanceof Response) return now
    const { event } = now
    const ticket = method === "waived" ? volunteerTicket(event) : findTicket(event, ticketId)
    if (!ticket || (method === "cash") !== ticket.amount > 0) return json({ message: "Choose a ticket" }, 400)
    // Another laptop already checked them in, unless this is a retry of the same payment.
    if (!await findCharge(env, id) && await env.CHECKIN_GUARD.getByName(event.sessionDate).isCheckedIn(attendee, event.id)) {
      return json({ message: "Already checked in", next: await nextSteps(env, attendee) }, 409)
    }
    const recorded = await settleAtDoor(env, id, event, attendee, ticket, method, timestamp)
    if (method === "cash") await sendUnsentCash(env)
    return json({ message: recorded ? "Checked in" : "Already checked in", next: await nextSteps(env, attendee) }, recorded ? 201 : 409)
  }
  const match = path.match(/^charges\/([^/]+)(?:\/(tap|return))?$/)
  const charge = match && await findCharge(env, match[1])
  if (!charge) return json({ message: "Not found" }, 404)
  // Going to Square locks the name on the iPhone until Square answers, so a lost return can't charge twice by accident.
  if (match[2] === "tap" && request.method === "POST") {
    await env.EVENTS_DB.prepare("UPDATE door_charges SET tappedAt = ? WHERE id = ? AND status = 'pending'").bind(new Date(timestamp).toISOString(), charge.id).run()
    return json({ success: true })
  }
  if (match[2] === "return" && request.method === "POST") {
    const { ok } = (await request.json()) as { ok?: boolean }
    if (!ok) await env.EVENTS_DB.prepare("UPDATE door_charges SET tappedAt = NULL WHERE id = ? AND status = 'pending'").bind(charge.id).run()
    else if (charge.status === "pending") await settleCardCharge(env, charge, null, timestamp)
    const current = (await findCharge(env, charge.id))!
    return json({ status: isPaid(current) ? "paid" : "pending", name: firstName(current) })
  }
  // The laptop asks too, because the phone's page stops while Square's app is open.
  if (request.method === "GET") {
    if (isVerifying(charge)) await syncSquareIfStale(env)
    const current = (await findCharge(env, charge.id))!
    return json(isPaid(current)
      ? { status: "paid", next: await nextSteps(env, JSON.parse(current.attendee) as Attendee) }
      : { status: current.status === "canceled" ? "canceled" : "pending" })
  }
  if (request.method === "DELETE") {
    await cancelCharge(env, charge.id)
    return json({ success: true })
  }
  return json({ message: "Method not allowed" }, 405)
}

// Whether the attendee already checked into tonight's event and what they still need to do, asked before the waivers.
export async function handleCheckinStatus(request: Request, env: Env, timestamp = Date.now()): Promise<Response> {
  const attendee = await readCheckinAttendee(request, env)
  if (attendee instanceof Response) return attendee
  const now = await eventNow(request, env, timestamp)
  if (now instanceof Response) return now
  const { event } = now
  const guard = env.CHECKIN_GUARD.getByName(event.sessionDate)
  return json({ checkedIn: await guard.isCheckedIn(attendee, event.id), next: await nextSteps(env, attendee) })
}

// What the attendee still needs to do, from the latest CampusGroups member upload.
async function nextSteps(env: Env, attendee: Attendee): Promise<NextSteps> {
  if (PARTICIPANT_WAIVER_AFFILIATIONS.includes(attendee.affiliation)) return { waiver: null, joinCampusGroups: false }
  const campusGroups = await env.MEMBER_CACHE.get<CampusGroupsData>(campusGroupsKey, "json")
  const person = campusGroups?.people[attendee.email]
  return { waiver: person?.generalRisk ? null : "cornell", joinCampusGroups: !person?.member }
}

// The events the kiosk can choose between right now.
async function handleEvents(env: Env, timestamp = Date.now()): Promise<Response> {
  const sessions = await eventChoices(env, timestampForSheet(timestamp, env.TIME_ZONE))
  return json({ events: sessions.map(({ id, title, time }) => ({ id, title, time })) })
}

async function handleWaiver(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const now = await eventNow(request, env, Date.now())
    return now instanceof Response ? now : json(await readWaiver(now.event))
  }
  if (request.method !== "POST") return json({ message: "Method not allowed" }, 405)
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ message: "Invalid waiver data" }, 400)
  }
  const name = isRecord(payload) && typeof payload.name === "string" ? normalizeName(payload.name) : ""
  const email = isRecord(payload) && typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
  const phone = isRecord(payload) && typeof payload.phone === "string" ? normalizePhone(payload.phone) : ""
  const signature = isRecord(payload) && typeof payload.signature === "string" ? normalizeName(payload.signature) : ""
  if (!isValidName(name) || !isValidEmail(email) || !phone || !isValidName(signature)) {
    return json({ message: "Enter your name, email, phone number, and signature." }, 400)
  }
  if (!signatureMatchesName(signature, name)) {
    return json({ message: `Sign with your full name: ${name}` }, 400)
  }
  const timestamp = Date.now()
  const now = await eventNow(request, env, timestamp)
  if (now instanceof Response) return now
  const { event } = now
  const eventName = waiverEventName(event)
  const responseId = await submitWaiver({ name, phone, signature }, eventName)
  // CampusGroups holds the signed waiver, so a failed log entry shouldn't make the attendee sign again.
  try {
    await appendWaiver(env, await getGoogleAccessToken(env), { name, email, phone, eventName, responseId, eventId: event.id }, timestamp)
  } catch (error) {
    console.error(JSON.stringify({ message: "waiver log append failed", email, error: errorMessage(error) }))
  }
  return json({ message: "Waiver signed" }, 201)
}

// The event in a stored fingerprint, so a deleted row still marks its event as changed.
function fingerprintEvent(fingerprint: string): string | null {
  try {
    const eventId = (JSON.parse(fingerprint) as unknown[])[6]
    return typeof eventId === "string" && eventId ? eventId : null
  } catch {
    return null
  }
}

function rowAttendee(row: CheckinRow): Attendee {
  if (typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) {
    throw new RowProblem("Check-in timestamp is not a Google Sheets date")
  }
  const attendee = validateAttendee({
    memberId: row.memberId || null,
    name: row.name,
    email: row.email,
    affiliation: row.affiliation,
    phone: row.phone,
  })
  if (!attendee) throw new RowProblem("Check-in row has invalid member data")
  return attendee
}

// The Sheet is the source of truth, so a member's Notion details come from their newest check-in,
// even when an older night is the one being synced. People can share an email, so a row with a Member
// ID only takes details from rows with that ID. Rows are in time order, so the last one wins.
function newestDetails(rows: CheckinRow[]): (attendee: Attendee) => Attendee {
  const newest = new Map<string, Attendee>()
  const person = (attendee: Attendee) => attendee.memberId ? `id:${attendee.memberId}` : `email:${attendee.email}`
  for (const row of rows) {
    try {
      const attendee = rowAttendee(row)
      newest.set(person(attendee), attendee)
    } catch { continue }
  }
  return (attendee) => newest.get(person(attendee)) ?? attendee
}

// How far back member search counts nights, about one semester.
const RECENT_DAYS = 120

// Uses the Member IDs the sync wrote back, so rows that failed to sync are left out until they sync.
function checkinStats(rows: CheckinRow[], today: string): CheckinStats {
  const cutoff = new Date(Date.parse(today) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
  const recentNights = new Map<string, Set<string>>()
  const last = new Map<string, string>()
  for (const row of rows) {
    const date = dateKeyForSheetTimestamp(row.timestamp)
    if (!date || !row.memberId) continue
    if (date >= cutoff) recentNights.set(row.memberId, (recentNights.get(row.memberId) ?? new Set()).add(date))
    if (date > (last.get(row.memberId) ?? "")) last.set(row.memberId, date)
  }
  return Object.fromEntries(
    [...last].map(([memberId, date]) => [memberId, { nights: recentNights.get(memberId)?.size ?? 0, last: date }]),
  )
}

async function syncAttendance(env: Env, accessToken: string, storage: DurableObjectStorage): Promise<{
  synced: number
  failed: number
  attempted: number
  previousFingerprints: Set<string> | null
  nextFingerprints: Set<string>
  members: Member[]
  stats: CheckinStats
}> {
  const rows = (await readCheckins(env, accessToken))
    .filter((row) => row.timestamp !== null && row.email)
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp))
  const previousFingerprints = await readAttendanceSyncState(env)
  const roster = await loadMemberRoster(env, { assignMissingIds: true })
  const details = newestDetails(rows)

  // Rows from before check-ins named their event, and rows officers add by hand, belong to the
  // event at their time.
  const eventIds = new Map<CheckinRow, string>()
  for (const row of rows) {
    const assigned = !row.eventId && typeof row.timestamp === "number"
    eventIds.set(row, assigned ? (await eventAtSheetTimestamp(env, row.timestamp as number)).id : row.eventId)
  }
  const fingerprint = (row: CheckinRow) => checkinFingerprint(row, eventIds.get(row)!)

  // An event needs syncing when any of its rows was added, edited, or deleted since the last run.
  const currentFingerprints = new Set(rows.map(fingerprint))
  const changedEvents = new Set<string>()
  for (const row of rows) {
    if (!previousFingerprints?.has(fingerprint(row)) && eventIds.get(row)) changedEvents.add(eventIds.get(row)!)
  }
  for (const previous of previousFingerprints ?? []) {
    const eventId = currentFingerprints.has(previous) ? null : fingerprintEvent(previous)
    if (eventId) changedEvents.add(eventId)
  }

  const events = new Map<string, AttendanceEvent>()
  const attendees = new Map<string, Set<string>>()
  const eventsWithRows = new Set<string>()
  const syncedRows: CheckinRow[] = []
  // Events with a temporary failure keep their previous state and sync again on the next run.
  const retryEvents = new Set<string>()
  let failed = 0
  let attempted = 0

  for (const row of rows) {
    const eventId = eventIds.get(row)!
    if (!changedEvents.has(eventId)) continue
    eventsWithRows.add(eventId)
    if (!previousFingerprints?.has(fingerprint(row))) attempted += 1
    try {
      const attendee = rowAttendee(row)
      const date = dateKeyForSheetTimestamp(row.timestamp)!
      let event = events.get(eventId)
      if (!event) {
        const record = await findCheckinEvent(env, eventId)
        // The Notion event's name keeps the title from /manage even if the event is later deleted there.
        const name = record ? `${record.date} ${record.title}` : date
        event = await findOrCreateAttendanceEvent(env, { id: eventId, date: record?.date || date, name }, storage)
        events.set(eventId, event)
      }
      const member = await syncMemberAttendance(env, roster, attendee, details(attendee), date, event.id, storage)
      attendees.set(eventId, (attendees.get(eventId) ?? new Set()).add(member.pageId))
      // Write back only this row's own cleaned-up values and its Member ID.
      const values = { name: attendee.name, email: attendee.email, affiliation: attendee.affiliation, memberId: member.id, phone: attendee.phone }
      if (values.name !== row.name || values.email !== row.email || values.affiliation !== row.affiliation || values.memberId !== row.memberId || values.phone !== row.phone) {
        await updateCheckinRow(env, accessToken, row, values)
        Object.assign(row, values)
      }
      syncedRows.push(row)
    } catch (error) {
      failed += 1
      if (!(error instanceof RowProblem)) retryEvents.add(eventId)
      console.error(
        JSON.stringify({
          message: "attendance row sync failed",
          row: row.rowNumber,
          error: errorMessage(error),
        }),
      )
    }
  }

  // Each changed event's attendees become exactly its synced rows. An event whose rows were all
  // deleted is looked up so its attendees can be cleared.
  for (const eventId of changedEvents) {
    if (retryEvents.has(eventId)) continue
    try {
      const event = events.get(eventId) ?? (eventsWithRows.has(eventId) ? null : await findAttendanceEvent(env, eventId))
      if (event) await syncEventAttendance(env, event, attendees.get(eventId) ?? [])
    } catch (error) {
      failed += 1
      retryEvents.add(eventId)
      console.error(JSON.stringify({ message: "event attendance sync failed", eventId, error: errorMessage(error) }))
    }
  }

  const nextFingerprints = new Set<string>()
  for (const row of rows) {
    if (!changedEvents.has(eventIds.get(row)!)) nextFingerprints.add(fingerprint(row))
  }
  let synced = 0
  for (const row of syncedRows) {
    if (retryEvents.has(eventIds.get(row)!)) continue
    if (!previousFingerprints?.has(fingerprint(row))) synced += 1
    nextFingerprints.add(fingerprint(row))
  }
  for (const previous of previousFingerprints ?? []) {
    const eventId = fingerprintEvent(previous)
    if (eventId && retryEvents.has(eventId)) nextFingerprints.add(previous)
  }

  failed += await syncWaivers(env, accessToken, roster)
  failed += await syncGeneralRisk(env, roster)

  return {
    synced,
    failed,
    attempted,
    previousFingerprints,
    nextFingerprints,
    members: rosterMembers(roster),
    stats: checkinStats(rows, dateKeyInTimeZone(Date.now(), env.TIME_ZONE)),
  }
}

// Lists each event's participant waiver signers on its Notion event. Returns how many items failed.
async function syncWaivers(env: Env, accessToken: string, roster: MemberRoster): Promise<number> {
  const signers = new Map<string, Set<string>>()
  let failed = 0
  for (const row of await readWaivers(env, accessToken)) {
    let member: MemberRecord | null = null
    try {
      member = matchMember(roster.records, { memberId: null, email: row.email, name: row.name })
    } catch (error) {
      if (!(error instanceof MemberConflict)) throw error
    }
    if (typeof row.timestamp !== "number" || !member) {
      failed += 1
      console.error(JSON.stringify({ message: "waiver row has no single matching member", email: row.email }))
      continue
    }
    // Waivers from before they named their event belong to the event at their time.
    const eventId = row.eventId || (await eventAtSheetTimestamp(env, row.timestamp)).id
    signers.set(eventId, (signers.get(eventId) ?? new Set()).add(member.pageId))
  }
  for (const [eventId, pageIds] of signers) {
    try {
      const event = await findAttendanceEvent(env, eventId)
      if (!event) throw new RowProblem(`No Notion event for ${eventId}`)
      await syncEventWaivers(env, event, pageIds)
    } catch (error) {
      failed += 1
      console.error(JSON.stringify({ message: "event waiver sync failed", eventId, error: errorMessage(error) }))
    }
  }
  return failed
}

// Marks members whose General Risk waiver appears in the latest CampusGroups upload with that academic year.
async function syncGeneralRisk(env: Env, roster: MemberRoster): Promise<number> {
  const campusGroups = await env.MEMBER_CACHE.get<CampusGroupsData>(campusGroupsKey, "json")
  if (!campusGroups) return 0
  const academicYear = generalRiskTag(new Date(campusGroups.uploadedAt)).replace(" - General Risk", "")
  let failed = 0
  for (const member of roster.records) {
    if (!campusGroups.people[member.email]?.generalRisk) continue
    try {
      await setGeneralRiskWaiver(env, member, academicYear)
    } catch (error) {
      failed += 1
      console.error(JSON.stringify({ message: "general risk sync failed", member: member.id, error: errorMessage(error) }))
    }
  }
  return failed
}

export async function runNightlySync(
  env: Env,
  getAccessToken: AccessTokenProvider = getGoogleAccessToken,
): Promise<{ synced: number; failed: number }> {
  const accessToken = await getAccessToken(env)
  return env.ATTENDANCE_SYNC.getByName("nightly").run(accessToken)
}

export class AttendanceSync extends DurableObject<Env> {
  private running: Promise<{ synced: number; failed: number }> | null = null

  async run(accessToken: string): Promise<{ synced: number; failed: number }> {
    this.running ??= performNightlySync(this.env, accessToken, this.ctx.storage).finally(() => {
      this.running = null
    })
    return this.running
  }
}

async function performNightlySync(
  env: Env,
  accessToken: string,
  storage: DurableObjectStorage,
): Promise<{ synced: number; failed: number }> {
  const {
    attempted,
    members,
    stats,
    previousFingerprints,
    nextFingerprints,
    ...result
  } = await syncAttendance(env, accessToken, storage)
  await storeMemberCache(env, members)
  await storeCheckinStats(env, stats)
  if (attempted > 0) {
    await sortCheckins(env, accessToken)
  }
  if (previousFingerprints === null || !sameFingerprints(previousFingerprints, nextFingerprints)) {
    await writeAttendanceSyncState(env, nextFingerprints)
    if (previousFingerprints === null) {
      console.log(
        JSON.stringify({ message: "attendance sync state initialized", rows: nextFingerprints.size }),
      )
    }
  }
  if (result.failed > 0) {
    throw new Error(`Nightly attendance sync incomplete: ${result.synced} synced, ${result.failed} failed`)
  }
  return result
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname

  try {
    if (pathname === MEMBER_SEARCH_PATH) {
      if (request.method !== "POST") return json({ message: "Method not allowed" }, 405)
      return await handleMemberSearch(request, env)
    }
    if (pathname === CHECKIN_PATH) {
      if (request.method !== "POST") return json({ message: "Method not allowed" }, 405)
      return await handleCheckin(request, env)
    }
    if (pathname === CHECKIN_STATUS_PATH) {
      if (request.method !== "POST") return json({ message: "Method not allowed" }, 405)
      return await handleCheckinStatus(request, env)
    }
    if (pathname === EVENTS_PATH) {
      if (request.method !== "GET") return json({ message: "Method not allowed" }, 405)
      return await handleEvents(env)
    }
    if (pathname.startsWith(DOOR_PATH)) return await handleDoor(request, env, pathname.slice(DOOR_PATH.length))
    if (pathname === WAIVER_PATH) {
      try {
        return await handleWaiver(request, env)
      } catch (error) {
        if (error instanceof WaiverFormChanged) {
          // The kiosk skips the waiver without telling the attendee; an officer gets the email.
          await alertWaiverFormChanged(env, error)
          return json({ formChanged: true }, 503)
        }
        // CampusGroups is down or refused the submission, so the kiosk has the attendee sign on their phone.
        console.error(JSON.stringify({ message: "waiver request failed", error: errorMessage(error) }))
        return json({ unavailable: true }, 503)
      }
    }
    return json({ message: "Not found" }, 404)
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "request failed",
        path: pathname,
        error: errorMessage(error),
      }),
    )
    const message = pathname === MEMBER_SEARCH_PATH ? "Member search unavailable" : "Check-in failed"
    return json({ message }, 503)
  }
}

// Checked each morning so a changed form is caught before the next event.
export async function checkWaiverForm(env: Env): Promise<void> {
  try {
    await loadWaiverForm()
  } catch (error) {
    if (!(error instanceof WaiverFormChanged)) throw error
    await alertWaiverFormChanged(env, error)
  }
}

// Emails an officer, at most once a day, when the CampusGroups waiver form no longer has the fields
// the kiosk fills in. The kiosk skips the waiver until waiver.ts is updated to match.
async function alertWaiverFormChanged(env: Env, error: WaiverFormChanged): Promise<void> {
  console.error(JSON.stringify({ message: "waiver form check failed", error: error.message }))
  const key = `waiver-form-alert:${dateKeyInTimeZone(Date.now(), env.TIME_ZONE)}`
  if (await env.MEMBER_CACHE.get(key)) return
  await sendAlert(env, "The CampusGroups waiver form changed", [
    "The check-in kiosk can't fill in the non-Cornell participant waiver anymore, so it skips the waiver for community members and alumni.",
    `Form: ${WAIVER_FORM_URL}`,
    "Update the field names in check-in/worker/waiver.ts to match the form.",
  ])
  await env.MEMBER_CACHE.put(key, "sent", { expirationTtl: 2 * 24 * 60 * 60 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new URL(request.url).pathname.startsWith("/check-in/api/")
      ? handleApiRequest(request, env)
      : env.ASSETS.fetch(request)
  },

  async scheduled(_controller, env): Promise<void> {
    try {
      const result = await runNightlySync(env)
      console.log(JSON.stringify({ message: "nightly attendance sync complete", ...result }))
    } catch (error) {
      console.error(
        JSON.stringify({ message: "nightly attendance sync failed", error: errorMessage(error) }),
      )
      throw error
    }
  },
} satisfies ExportedHandler<Env>

import { DurableObject } from "cloudflare:workers"

import {
  isAffiliation,
  isValidEmail,
  isValidName,
  normalizeName,
  normalizePhone,
  PARTICIPANT_WAIVER_AFFILIATIONS,
  signatureMatchesName,
  type Affiliation,
  type NextSteps,
  type Member,
} from "../src/lib/checkin"
import { cachedMembers, findCachedMemberById, searchCachedMembers, storeMemberCache } from "./cache"
import {
  type CheckinRow,
  appendWaiver,
  dateKeyForSheetTimestamp,
  dateKeyInTimeZone,
  getGoogleAccessToken,
  readCheckins,
  readWaivers,
  sortCheckins,
  updateCheckinRow,
} from "./google"
import { MEMBER_ID_PATTERN } from "./member-id"
import {
  type AttendanceEvent,
  findEventForDate,
  findOrCreateEventForDate,
  loadMemberRoster,
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
import { campusGroupsKey, type CampusGroupsData } from "../../src/events/campusgroups"

export { CheckinGuard } from "./checkin-guard"

const MEMBER_SEARCH_PATH = "/check-in/api/members"
const CHECKIN_PATH = "/check-in/api/checkins"
const WAIVER_PATH = "/check-in/api/waiver"
// The morning cron that checks the CampusGroups waiver form; the others run the attendance sync.
const WAIVER_CHECK_CRON = "30 11 * * *"
type Attendee = {
  memberId: string | null
  name: string
  email: string
  affiliation: Affiliation
  phone: string
}

type AccessTokenProvider = (env: Env) => Promise<string>

// Phone is only included when present so rows from before the Phone column keep their fingerprints.
function checkinFingerprint(row: CheckinRow): string {
  return JSON.stringify([row.timestamp, row.name, row.email, row.affiliation, row.memberId, ...(row.phone ? [row.phone] : [])])
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

export async function handleCheckin(
  request: Request,
  env: Env,
  getAccessToken?: AccessTokenProvider,
  timestamp = Date.now(),
): Promise<Response> {
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

  if (attendee.memberId) {
    const member = await findCachedMemberById(env, attendee.memberId)
    if (!member) {
      return json(
        { message: "That member record is no longer available. Select “Not you?” and choose again." },
        400,
      )
    }
  } else {
    const members = await cachedMembers(env)
    const sameName = (member: Member) => member.name.toLocaleLowerCase() === attendee.name.toLocaleLowerCase()
    const emailMatches = members.filter((member) => member.email === attendee.email)
    const nameMatches = emailMatches.filter(sameName)
    // Members added to Notion without an email are found by name in the dropdown, so typing the same
    // name and affiliation links to them too.
    const emaillessMatches = emailMatches.length
      ? []
      : members.filter(
          (member) => !member.email && sameName(member) && member.affiliation === attendee.affiliation,
        )
    const member = emailMatches.length === 1
      ? emailMatches[0]
      : nameMatches.length === 1
        ? nameMatches[0]
        : emaillessMatches.length === 1
          ? emaillessMatches[0]
          : null
    if (member) attendee.memberId = member.id
  }

  const accessToken = getAccessToken ? await getAccessToken(env) : undefined
  const dateKey = dateKeyInTimeZone(timestamp, env.TIME_ZONE)
  const result = await env.CHECKIN_GUARD.getByName(dateKey).checkin(attendee, timestamp, accessToken)
  if (result === "failed") throw new Error("Check-in persistence failed")
  const next = await nextSteps(env, attendee)
  return result === "duplicate"
    ? json({ message: "Already checked in", next }, 409)
    : json({ message: "Checked in", next }, 201)
}

// What the attendee still needs to do after checking in, from the latest CampusGroups member upload.
async function nextSteps(env: Env, attendee: Attendee): Promise<NextSteps> {
  if (PARTICIPANT_WAIVER_AFFILIATIONS.includes(attendee.affiliation)) return { waiver: null, joinCampusGroups: false }
  const campusGroups = await env.MEMBER_CACHE.get<CampusGroupsData>(campusGroupsKey, "json")
  const person = campusGroups?.people[attendee.email]
  return { waiver: person?.generalRisk ? null : "cornell", joinCampusGroups: !person?.member }
}

async function handleWaiver(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return json(await readWaiver(env))
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
  const eventName = await waiverEventName(env, timestamp)
  const responseId = await submitWaiver({ name, phone, signature }, eventName)
  // CampusGroups holds the signed waiver, so a failed log entry shouldn't make the attendee sign again.
  try {
    await appendWaiver(env, await getGoogleAccessToken(env), { name, email, phone, eventName, responseId }, timestamp)
  } catch (error) {
    console.error(JSON.stringify({ message: "waiver log append failed", email, error: errorMessage(error) }))
  }
  return json({ message: "Waiver signed" }, 201)
}

// The date in a stored fingerprint, so a deleted row still marks its night as changed.
function fingerprintDate(fingerprint: string): string | null {
  try {
    const [timestamp] = JSON.parse(fingerprint) as unknown[]
    return dateKeyForSheetTimestamp(typeof timestamp === "number" ? timestamp : null)
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
// even when an older night is the one being synced.
function newestDetails(rows: CheckinRow[]): (attendee: Attendee) => Attendee {
  const byId = new Map<string, Attendee>()
  const byEmail = new Map<string, Attendee>()
  const order = new Map<Attendee, number>()
  for (const [index, row] of rows.entries()) {
    let attendee: Attendee
    try { attendee = rowAttendee(row) } catch { continue }
    order.set(attendee, index)
    if (attendee.memberId) byId.set(attendee.memberId, attendee)
    byEmail.set(attendee.email, attendee)
  }
  return (attendee) => {
    const candidates = [attendee.memberId ? byId.get(attendee.memberId) : undefined, byEmail.get(attendee.email)]
      .filter((candidate): candidate is Attendee => candidate !== undefined)
    return candidates.sort((left, right) => order.get(right)! - order.get(left)!)[0] ?? attendee
  }
}

async function syncAttendance(env: Env, accessToken: string, storage: DurableObjectStorage): Promise<{
  synced: number
  failed: number
  attempted: number
  previousFingerprints: Set<string> | null
  nextFingerprints: Set<string>
  members: Member[]
}> {
  const rows = (await readCheckins(env, accessToken))
    .filter((row) => row.timestamp !== null && row.email)
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp))
  const previousFingerprints = await readAttendanceSyncState(env)
  const roster = await loadMemberRoster(env, { assignMissingIds: true })
  const details = newestDetails(rows)

  // A night needs syncing when any of its rows was added, edited, or deleted since the last run.
  const currentFingerprints = new Set(rows.map(checkinFingerprint))
  const changedDates = new Set<string>()
  for (const row of rows) {
    if (previousFingerprints?.has(checkinFingerprint(row))) continue
    const date = dateKeyForSheetTimestamp(row.timestamp)
    if (date) changedDates.add(date)
  }
  for (const fingerprint of previousFingerprints ?? []) {
    const date = currentFingerprints.has(fingerprint) ? null : fingerprintDate(fingerprint)
    if (date) changedDates.add(date)
  }

  const events = new Map<string, AttendanceEvent>()
  const attendees = new Map<string, Set<string>>()
  const datesWithRows = new Set<string>()
  const syncedRows: CheckinRow[] = []
  // Nights with a temporary failure keep their previous state and sync again on the next run.
  const retryDates = new Set<string>()
  let failed = 0
  let attempted = 0

  for (const row of rows) {
    const date = dateKeyForSheetTimestamp(row.timestamp)
    if (!date || !changedDates.has(date)) continue
    datesWithRows.add(date)
    if (!previousFingerprints?.has(checkinFingerprint(row))) attempted += 1
    try {
      const attendee = rowAttendee(row)
      let event = events.get(date)
      if (!event) {
        event = await findOrCreateEventForDate(env, date, storage)
        events.set(date, event)
      }
      const member = await syncMemberAttendance(env, roster, attendee, details(attendee), date, event.id, storage)
      attendees.set(date, (attendees.get(date) ?? new Set()).add(member.pageId))
      // Write back only this row's own cleaned-up values and its Member ID.
      const values = { name: attendee.name, email: attendee.email, affiliation: attendee.affiliation, memberId: member.id, phone: attendee.phone }
      if (values.name !== row.name || values.email !== row.email || values.affiliation !== row.affiliation || values.memberId !== row.memberId || values.phone !== row.phone) {
        await updateCheckinRow(env, accessToken, row, values)
        Object.assign(row, values)
      }
      syncedRows.push(row)
    } catch (error) {
      failed += 1
      if (!(error instanceof RowProblem)) retryDates.add(date)
      console.error(
        JSON.stringify({
          message: "attendance row sync failed",
          row: row.rowNumber,
          error: errorMessage(error),
        }),
      )
    }
  }

  // Each changed night's attendees become exactly its synced rows. A night whose rows were all
  // deleted is looked up so its attendees can be cleared.
  for (const date of changedDates) {
    if (retryDates.has(date)) continue
    try {
      const event = events.get(date) ?? (datesWithRows.has(date) ? null : await findEventForDate(env, date))
      if (event) await syncEventAttendance(env, event, attendees.get(date) ?? [])
    } catch (error) {
      failed += 1
      retryDates.add(date)
      console.error(JSON.stringify({ message: "event attendance sync failed", date, error: errorMessage(error) }))
    }
  }

  const nextFingerprints = new Set<string>()
  for (const row of rows) {
    const date = dateKeyForSheetTimestamp(row.timestamp)
    if (date && !changedDates.has(date)) nextFingerprints.add(checkinFingerprint(row))
  }
  let synced = 0
  for (const row of syncedRows) {
    const date = dateKeyForSheetTimestamp(row.timestamp)!
    if (retryDates.has(date)) continue
    if (!previousFingerprints?.has(checkinFingerprint(row))) synced += 1
    nextFingerprints.add(checkinFingerprint(row))
  }
  for (const fingerprint of previousFingerprints ?? []) {
    const date = fingerprintDate(fingerprint)
    if (date && retryDates.has(date)) nextFingerprints.add(fingerprint)
  }

  failed += await syncWaivers(env, accessToken, roster)
  failed += await syncGeneralRisk(env, roster)

  return { synced, failed, attempted, previousFingerprints, nextFingerprints, members: rosterMembers(roster) }
}

// Lists each night's participant waiver signers on its Notion event. Returns how many items failed.
async function syncWaivers(env: Env, accessToken: string, roster: MemberRoster): Promise<number> {
  const signers = new Map<string, Set<string>>()
  let failed = 0
  for (const row of await readWaivers(env, accessToken)) {
    const date = dateKeyForSheetTimestamp(row.timestamp)
    // Members who share an email are told apart by name, as at the kiosk.
    const emailMatches = roster.byEmail.get(row.email) ?? []
    const matches = emailMatches.length > 1
      ? emailMatches.filter((member) => member.name.toLocaleLowerCase() === row.name.toLocaleLowerCase())
      : emailMatches
    if (!date || matches.length !== 1) {
      failed += 1
      console.error(JSON.stringify({ message: "waiver row has no single matching member", email: row.email, date }))
      continue
    }
    signers.set(date, (signers.get(date) ?? new Set()).add(matches[0].pageId))
  }
  for (const [date, pageIds] of signers) {
    try {
      const event = await findEventForDate(env, date)
      if (!event) throw new RowProblem(`No Notion event for ${date}`)
      await syncEventWaivers(env, event, pageIds)
    } catch (error) {
      failed += 1
      console.error(JSON.stringify({ message: "event waiver sync failed", date, error: errorMessage(error) }))
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
    previousFingerprints,
    nextFingerprints,
    ...result
  } = await syncAttendance(env, accessToken, storage)
  await storeMemberCache(env, members)
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
    if (pathname === WAIVER_PATH) {
      try {
        return await handleWaiver(request, env)
      } catch (error) {
        if (error instanceof WaiverFormChanged) {
          // The kiosk skips the waiver without telling the attendee; an officer gets the email.
          await alertWaiverFormChanged(env)
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
    await alertWaiverFormChanged(env)
  }
}

// Emails an officer, at most once a day, when the CampusGroups waiver form no longer has the fields
// the kiosk fills in. The kiosk skips the waiver until waiver.ts is updated to match.
async function alertWaiverFormChanged(env: Env): Promise<void> {
  const key = `waiver-form-alert:${dateKeyInTimeZone(Date.now(), env.TIME_ZONE)}`
  if (await env.MEMBER_CACHE.get(key)) return
  await env.ALERT_EMAIL.send({
    to: "wl757@cornell.edu",
    from: { email: "check-in@swingsyndicate.club", name: "Swing Syndicate check-in" },
    subject: "The CampusGroups waiver form changed",
    text: [
      "The check-in kiosk can't fill in the non-Cornell participant waiver anymore, so it skips the waiver for community members and alumni.",
      `Form: ${WAIVER_FORM_URL}`,
      "Update the field names in check-in/worker/waiver.ts to match the form.",
    ].join("\n\n"),
  })
  await env.MEMBER_CACHE.put(key, "sent", { expirationTtl: 2 * 24 * 60 * 60 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new URL(request.url).pathname.startsWith("/check-in/api/")
      ? handleApiRequest(request, env)
      : env.ASSETS.fetch(request)
  },

  async scheduled(controller, env): Promise<void> {
    if (controller.cron === WAIVER_CHECK_CRON) return checkWaiverForm(env)
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

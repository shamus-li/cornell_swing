import { isAffiliation, type Affiliation } from "../src/lib/checkin"
import { findCachedMemberById, refreshMemberCache, searchCachedMembers } from "./cache"
import {
  dateKeyForSheetTimestamp,
  getGoogleAccessToken,
  readCheckins,
  recordCheckin,
  updateCheckinMemberDetails,
  updateCheckinMemberId,
} from "./google"
import { MEMBER_ID_PATTERN } from "./member-id"
import { findOrCreateEventForDate, syncMemberAttendance } from "./notion"

const MEMBER_SEARCH_PATH = "/check-in/api/members"
const CHECKIN_PATH = "/check-in/api/checkins"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type Attendee = {
  memberId: string | null
  name: string
  email: string
  affiliation: Affiliation
}

type AccessTokenProvider = (env: Env) => Promise<string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function validateAttendee(value: unknown): Attendee | null {
  if (!isRecord(value)) return null
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : ""
  const memberId = typeof value.memberId === "string" ? value.memberId.trim() : null
  const enteredName = typeof value.name === "string" ? value.name.trim() : ""
  const name = enteredName.toLowerCase() === email ? "" : enteredName
  if (
    (memberId !== null && !MEMBER_ID_PATTERN.test(memberId)) ||
    name.length > 160 ||
    !email ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    !isAffiliation(value.affiliation)
  ) {
    return null
  }
  return { memberId, name, email, affiliation: value.affiliation }
}

async function handleMemberSearch(request: Request, env: Env): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  if (query.length < 2) return json({ members: [] })
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
  getAccessToken: AccessTokenProvider = getGoogleAccessToken,
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
  const attendee = validateAttendee(payload)
  if (!attendee) return json({ message: "Enter a valid email and affiliation" }, 400)

  if (attendee.memberId) {
    const member = await findCachedMemberById(env, attendee.memberId)
    if (!member) {
      return json(
        { message: "That member record is no longer available. Select “Not you?” and choose again." },
        400,
      )
    }
  } else {
    const emailMatches = (await searchCachedMembers(env, attendee.email)).filter(
      (member) => member.email === attendee.email,
    )
    const nameMatches = emailMatches.filter(
      (member) => member.name.toLocaleLowerCase() === attendee.name.toLocaleLowerCase(),
    )
    const member = emailMatches.length === 1
      ? emailMatches[0]
      : nameMatches.length === 1
        ? nameMatches[0]
        : null
    if (member) attendee.memberId = member.id
  }

  const accessToken = await getAccessToken(env)
  const result = await recordCheckin(env, accessToken, attendee, timestamp)
  return result === "duplicate"
    ? json({ message: "Already checked in" }, 409)
    : json({ message: "Checked in" }, 201)
}

async function syncAttendance(env: Env, getAccessToken: AccessTokenProvider): Promise<{
  synced: number
  failed: number
}> {
  const accessToken = await getAccessToken(env)
  const rows = await readCheckins(env, accessToken)
  const events = new Map<string, string>()
  let synced = 0
  let failed = 0

  for (const row of rows) {
    if (row.timestamp === null || !row.email) continue

    try {
      if (typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) {
        throw new Error("Check-in timestamp is not a Google Sheets date")
      }
      const date = dateKeyForSheetTimestamp(row.timestamp)
      const attendee = validateAttendee({
        memberId: row.memberId || null,
        name: row.name,
        email: row.email,
        affiliation: row.affiliation,
      })
      if (!date) throw new Error("Check-in timestamp is not a Google Sheets date")
      if (!attendee) throw new Error("Check-in row has invalid member data")

      let eventId = events.get(date)
      if (!eventId) {
        eventId = await findOrCreateEventForDate(env, date)
        events.set(date, eventId)
      }
      const member = await syncMemberAttendance(env, attendee, date, eventId, row.timestamp)
      if (
        member.name !== row.name ||
        member.email !== row.email ||
        member.affiliation !== row.affiliation
      ) {
        await updateCheckinMemberDetails(env, accessToken, row.rowNumber, member)
      }
      if (member.id !== row.memberId) {
        await updateCheckinMemberId(env, accessToken, row.rowNumber, member.id)
      }
      synced += 1
    } catch (error) {
      failed += 1
      console.error(
        JSON.stringify({
          message: "attendance row sync failed",
          row: row.rowNumber,
          error: errorMessage(error),
        }),
      )
    }
  }
  return { synced, failed }
}

export async function runNightlySync(
  env: Env,
  getAccessToken: AccessTokenProvider = getGoogleAccessToken,
): Promise<{ synced: number; failed: number }> {
  const result = await syncAttendance(env, getAccessToken)
  await refreshMemberCache(env)
  return result
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname

  try {
    if (pathname === MEMBER_SEARCH_PATH) {
      if (request.method !== "GET") return json({ message: "Method not allowed" }, 405)
      return await handleMemberSearch(request, env)
    }
    if (pathname === CHECKIN_PATH) {
      if (request.method !== "POST") return json({ message: "Method not allowed" }, 405)
      return await handleCheckin(request, env)
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

export default {
  async fetch(request, env): Promise<Response> {
    return handleApiRequest(request, env)
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

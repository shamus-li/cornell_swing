import { env, exports } from "cloudflare:workers"
import { createScheduledController, listDurableObjectIds, runInDurableObject } from "cloudflare:test"
import { exportPKCS8, generateKeyPair } from "jose"
import { HttpResponse, http } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import worker, {
  handleApiRequest,
  handleCheckin,
  handleCheckinStatus,
  runNightlySync,
} from "../worker"
import { refreshMemberCache, searchCachedMembers } from "../worker/cache"
import {
  createCachedGoogleAccessTokenProvider,
  dateKeyForSheetTimestamp,
  dateKeyInTimeZone,
  timestampForSheet,
} from "../worker/google"
import { MEMBER_ID_PATTERN } from "../worker/member-id"
import {
  ATTENDANCE_SYNC_STATE_KEY,
  ATTENDANCE_SYNC_STATE_VERSION,
} from "../worker/sync-state"
import { resetEventsDb } from "./events-db"
import { FakeNotion, FakeSheets } from "./fakes"
import { network } from "./network"

const TEST_TIMESTAMP = Date.parse("2026-08-25T23:00:00Z") // 7pm in New York
const HOUR = 60 * 60 * 1000
const ADA_MEMBER_ID = "Ada_00000001"
const GRACE_MEMBER_ID = "Grace_000001"
const SHAMUS_MEMBER_ID = "Shamus_00001"
const MISSING_MEMBER_ID = "Missing_0001"

const token = async () => "test-access-token"
const serialFor = (timestamp: number) => timestampForSheet(timestamp, "America/New_York")

beforeEach(async () => {
  for (const id of await listDurableObjectIds(env.ATTENDANCE_SYNC)) {
    await runInDurableObject(env.ATTENDANCE_SYNC.get(id), async (_instance, state) => {
      await state.storage.deleteAll()
    })
  }
  for (const id of await listDurableObjectIds(env.CHECKIN_GUARD)) {
    await runInDurableObject(env.CHECKIN_GUARD.get(id), async (_instance, state) => {
      state.storage.sql.exec("DELETE FROM checkin_keys")
      state.storage.sql.exec("DELETE FROM pending")
      await state.storage.delete(["failingSince", "alerted"])
      await state.storage.deleteAlarm()
    })
  }
  await resetEventsDb()
  await env.MEMBER_CACHE.delete("members:v2")
  await env.MEMBER_CACHE.delete("checkin-stats:v1")
  await env.MEMBER_CACHE.delete("campusgroups:v1")
  await env.MEMBER_CACHE.put(
    ATTENDANCE_SYNC_STATE_KEY,
    JSON.stringify({ version: ATTENDANCE_SYNC_STATE_VERSION, fingerprints: [] }),
  )
})

// Copies the night's pending check-ins to the Sheet, as the guard's alarm does.
async function flush(timestamp = TEST_TIMESTAMP): Promise<void> {
  await env.CHECKIN_GUARD.getByName(dateKeyInTimeZone(timestamp, env.TIME_ZONE)).flush("test-access-token")
}

async function pendingMemberId(timestamp = TEST_TIMESTAMP): Promise<string> {
  return runInDurableObject(env.CHECKIN_GUARD.getByName(dateKeyInTimeZone(timestamp, env.TIME_ZONE)), (_instance, state) => {
    const [{ entry }] = state.storage.sql.exec<{ entry: string }>("SELECT entry FROM pending").toArray()
    return (JSON.parse(entry) as { memberId: string }).memberId
  })
}

async function addEvent(id: string, startTime: string, endTime: string, date = "2026-08-25"): Promise<void> {
  await env.EVENTS_DB
    .prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, updatedAt) VALUES (?, 'normal', ?, ?, ?, ?, '')")
    .bind(id, id, date, startTime, endTime)
    .run()
}

function useFakes() {
  const sheets = new FakeSheets()
  const notion = new FakeNotion()
  network.use(...sheets.handlers(), ...notion.handlers())
  return { sheets, notion }
}

function checkinRequestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    memberId: ADA_MEMBER_ID,
    name: "Ada Lovelace",
    email: "ADA@EXAMPLE.COM",
    affiliation: "Community Member",
    phone: "607-555-0100",
    ...overrides,
  })
}

function checkinRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://example.com/check-in/api/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: checkinRequestBody(overrides),
  })
}

function memberSearchRequest(q: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/check-in/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ q }),
  })
}

async function cacheMembers(...members: Array<{
  id: string
  name: string
  email: string
  affiliation: string
}>): Promise<void> {
  await env.MEMBER_CACHE.put(
    "members:v2",
    JSON.stringify({ refreshedAt: Date.now(), members: members.map((member) => ({ phone: "", ...member })) }),
  )
}

describe("sheet timestamps", () => {
  it("round-trips the New York calendar date across DST and UTC-midnight boundaries", () => {
    const instants = [
      Date.parse("2026-08-25T23:00:00Z"), // 7:00pm EDT
      Date.parse("2026-01-06T02:30:00Z"), // 9:30pm EST the previous calendar day
      Date.parse("2026-11-01T05:30:00Z"), // 1:30am on the night DST ends
      Date.parse("2026-03-08T06:59:00Z"), // 1:59am just before DST begins
    ]
    for (const instant of instants) {
      expect(dateKeyForSheetTimestamp(serialFor(instant))).toBe(
        dateKeyInTimeZone(instant, "America/New_York"),
      )
    }
  })
})

describe("Google access tokens", () => {
  it("reuses a token until it expires", async () => {
    let currentTime = 0
    let refreshes = 0
    const provider = createCachedGoogleAccessTokenProvider(
      async () => `token-${++refreshes}`,
      () => currentTime,
    )

    expect(await provider(env)).toBe("token-1")
    expect(await provider(env)).toBe("token-1")
    expect(refreshes).toBe(1)

    currentTime += 60 * 60 * 1000
    expect(await provider(env)).toBe("token-2")
    expect(refreshes).toBe(2)
  })
})

describe("member search", () => {
  it("builds the roster cache from every Notion page and reuses it across searches", async () => {
    const { notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    // Force a second Notion page to prove pagination is followed.
    for (let index = 0; index < 100; index += 1) {
      notion.addMember({
        memberId: `Filler_${String(index).padStart(5, "0")}`,
        name: `Roster Filler ${index}`,
        email: `filler${index}@example.com`,
        affiliation: "Staff",
      })
    }

    const response = await exports.default.fetch(memberSearchRequest("Ada"))

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      members: [
        {
          id: ADA_MEMBER_ID,
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "",
          affiliation: "Community Member",
        },
      ],
    })
    expect(notion.queries).toBe(2)

    await exports.default.fetch(memberSearchRequest("Roster"))
    expect(notion.queries).toBe(2) // second search served from the cached roster
  })

  it("uses the roster snapshot until it is explicitly refreshed", async () => {
    const { notion } = useFakes()
    notion.addMember({
      memberId: "Fresh_000001",
      name: "Fresh Fiona",
      email: "fiona@example.com",
      affiliation: "Staff",
    })
    const cachedSam = { id: "Stale_000001", name: "Stale Sam", email: "sam@example.com", phone: "", affiliation: "Staff" }

    await env.MEMBER_CACHE.put(
      "members:v2",
      JSON.stringify({ refreshedAt: Date.now() - 24 * 60 * 60 * 1000, members: [cachedSam] }),
    )
    expect((await searchCachedMembers(env, "sam")).map((member) => member.id)).toEqual(["Stale_000001"])
    expect(await searchCachedMembers(env, "fiona")).toEqual([])
    expect(notion.queries).toBe(0)

    await refreshMemberCache(env)
    expect((await searchCachedMembers(env, "fiona")).map((member) => member.id)).toEqual(["Fresh_000001"])
    expect(notion.queries).toBeGreaterThan(0)
  })

  it("matches names despite small typos and does not search emails", async () => {
    await cacheMembers(
      { id: "Bishop000001", name: "Jeff Bishop", email: "jpb6@example.com", affiliation: "Staff" },
      { id: "Taylor000001", name: "Jeff Taylor", email: "jt@example.com", affiliation: "Staff" },
      { id: "Accent000001", name: "Zoë Müller", email: "zoe@example.com", affiliation: "Staff" },
      { id: "Email_000001", name: "Grace Hopper", email: "jeffbishop@example.com", affiliation: "Staff" },
    )
    const search = async (query: string) => (await searchCachedMembers(env, query)).map((member) => member.id)

    expect(await search("jefff")).toEqual(["Bishop000001", "Taylor000001"])
    expect(await search("jfef bishop")).toEqual(["Bishop000001"])
    expect(await search("zoe muller")).toEqual(["Accent000001"])
    expect(await search("hopper")).toEqual(["Email_000001"])
    expect(await search("jpb6")).toEqual([])
  })

  it("lists names that start with the typed words first, then regulars, then by first name", async () => {
    const member = (id: string, name: string) => ({ id, name, email: "", phone: "", affiliation: "Staff" })
    await env.MEMBER_CACHE.put("members:v2", JSON.stringify({
      members: [
        member("Zed_00000001", "Ana Zed"),
        member("Able00000001", "Ana Able"),
        member("Bell00000001", "Ana Bell"),
        member("Cole00000001", "Ana Cole"),
        member("Dana00000001", "Dana Regular"),
      ],
    }))
    await env.MEMBER_CACHE.put("checkin-stats:v1", JSON.stringify({
      Bell00000001: { nights: 2, last: "2026-10-01" },
      Cole00000001: { nights: 2, last: "2026-10-29" },
      Dana00000001: { nights: 12, last: "2026-10-29" },
    }))

    expect((await searchCachedMembers(env, "ana")).map(({ id }) => id)).toEqual([
      "Cole00000001",
      "Bell00000001",
      "Able00000001",
      "Zed_00000001",
      "Dana00000001",
    ])
  })

  it("keys the rate limit by Access identity and returns 429 when it trips", async () => {
    const keys: string[] = []
    const limiter: Env["MEMBER_SEARCH_RATE_LIMITER"] = {
      limit: async ({ key }) => {
        keys.push(String(key))
        return { success: false }
      },
    }
    const limitedEnv: Env = { ...env, MEMBER_SEARCH_RATE_LIMITER: limiter }

    const response = await handleApiRequest(
      memberSearchRequest("Ada", { "Cf-Access-Authenticated-User-Email": "Kiosk@Example.COM" }),
      limitedEnv,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(await response.json()).toEqual({
      message: "Too many member searches. Wait a minute and try again.",
    })

    await handleApiRequest(memberSearchRequest("Ada"), limitedEnv)
    expect(keys).toEqual(["kiosk@example.com", "access-identity-missing"])
  })

  it.each(["{", "null", "[]", "{}", '{"q":123}'])("rejects invalid search JSON: %s", async (body) => {
    const response = await exports.default.fetch("https://example.com/check-in/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ message: "Invalid search data" })
  })

  it("returns no results for blank searches and rejects oversized queries", async () => {
    const blank = await exports.default.fetch(memberSearchRequest("  "))
    expect(await blank.json()).toEqual({ members: [] })
    const oversized = await exports.default.fetch(memberSearchRequest("a".repeat(101)))
    expect(oversized.status).toBe(400)
  })
})

describe("check-in", () => {
  it("reports tonight's check-ins before the waiver, by member ID or by email for new attendees", async () => {
    useFakes()
    await cacheMembers({ id: ADA_MEMBER_ID, name: "Ada Lovelace", email: "ada@example.com", affiliation: "Community Member" })
    const statusRequest = (overrides: Record<string, unknown> = {}) =>
      new Request("https://example.com/check-in/api/checkins/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: checkinRequestBody(overrides) })
    const status = async (overrides: Record<string, unknown> = {}) =>
      (await (await handleCheckinStatus(statusRequest(overrides), env, TEST_TIMESTAMP)).json()) as { checkedIn: boolean }

    expect(await status()).toMatchObject({ checkedIn: false })
    expect((await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP)).status).toBe(201)
    expect(await status()).toMatchObject({ checkedIn: true })

    const newcomer = { memberId: null, name: "New Dancer", email: "new@example.com" }
    expect(await status(newcomer)).toMatchObject({ checkedIn: false })
    expect((await handleCheckin(checkinRequest(newcomer), env, TEST_TIMESTAMP)).status).toBe(201)
    expect(await status(newcomer)).toMatchObject({ checkedIn: true })
  })

  it("reports who still needs the General Risk waiver before they check in", async () => {
    useFakes()
    await env.MEMBER_CACHE.put("campusgroups:v1", JSON.stringify({
      uploadedAt: "2026-10-01T00:00:00.000Z",
      people: { "signed@cornell.edu": { member: true, generalRisk: true } },
    }))
    const status = async (email: string) => {
      const request = new Request("https://example.com/check-in/api/checkins/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: checkinRequestBody({ memberId: null, email, affiliation: "Staff" }),
      })
      return (await handleCheckinStatus(request, env, TEST_TIMESTAMP)).json()
    }

    expect(await status("unknown@cornell.edu")).toMatchObject({ checkedIn: false, next: { waiver: "cornell" } })
    expect(await status("signed@cornell.edu")).toMatchObject({ checkedIn: false, next: { waiver: null } })
  })

  it("records a first-time attendee with a generated durable member ID and tonight's event", async () => {
    const { sheets } = useFakes()

    const response = await handleCheckin(
      checkinRequest({ memberId: null, name: "New Dancer", email: "new@example.com" }),
      env,
      TEST_TIMESTAMP,
    )
    await flush()

    expect(response.status).toBe(201)
    expect(sheets.rows).toHaveLength(1)
    const [timestamp, name, email, phone, affiliation, memberId, eventId] = sheets.rows[0]
    expect(timestamp).toBe(serialFor(TEST_TIMESTAMP))
    expect(name).toBe("New Dancer")
    expect(email).toBe("new@example.com")
    expect(phone).toBe("(607) 555-0100")
    expect(affiliation).toBe("Community Member")
    expect(String(memberId)).toMatch(MEMBER_ID_PATTERN)
    // A night with no event in /manage gets an unpublished one.
    expect(await env.EVENTS_DB.prepare("SELECT id, kind, title, date, published FROM events WHERE kind = 'normal'").all()).toMatchObject({
      results: [{ id: eventId, kind: "normal", title: "Swing Dance", date: "2026-08-25", published: 0 }],
    })
  })

  it("checks into the event happening at that time, and into each event of the night separately", async () => {
    const { sheets } = useFakes()
    await cacheMembers({ id: ADA_MEMBER_ID, name: "Ada Lovelace", email: "ada@example.com", affiliation: "Community Member" })
    await addEvent("workshop", "17:00", "18:00")
    await addEvent("social", "19:30", "22:00")

    // 7:00 PM is between the two, closer to the social; 8:00 PM is during it; 6:00 PM ends the workshop.
    expect((await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP)).status).toBe(201)
    expect((await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP + HOUR)).status).toBe(409)
    expect((await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP - HOUR)).status).toBe(201)
    await flush()

    expect(sheets.rows.map((row) => row[6])).toEqual(["social", "workshop"])
  })

  it("confirms check-ins while Google Sheets is down and copies them once it is back", async () => {
    const { sheets } = useFakes()
    sheets.failAppends = true
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const first = await handleCheckin(checkinRequest({ memberId: null, name: "Ada Lovelace", email: "ada@example.com" }), env, TEST_TIMESTAMP)
      await flush()
      const second = await handleCheckin(checkinRequest({ memberId: null, name: "Grace Hopper", email: "grace@example.com" }), env, TEST_TIMESTAMP)
      expect([first.status, second.status]).toEqual([201, 201])
      expect(sheets.rows).toEqual([])

      sheets.failAppends = false
      await flush()
      expect(sheets.rows.map((row) => row[2])).toEqual(["ada@example.com", "grace@example.com"])
      await flush()
      expect(sheets.rows).toHaveLength(2)
    } finally {
      consoleError.mockRestore()
    }
  })

  it("emails the alert address once when check-ins can't reach the Sheet for 30 minutes", async () => {
    const { sheets } = useFakes()
    await env.EVENTS_DB.exec("UPDATE settings SET alertEmail = 'officer@example.com'")
    const send = vi.fn(async () => ({ messageId: "message" }))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      await handleCheckin(checkinRequest({ memberId: null }), env, TEST_TIMESTAMP)
      const guard = env.CHECKIN_GUARD.getByName(dateKeyInTimeZone(TEST_TIMESTAMP, env.TIME_ZONE))
      await runInDurableObject(guard, async (instance, state) => {
        const guardEnv = (instance as unknown as { env: Env }).env
        Object.assign(instance, { env: { ...guardEnv, ALERT_EMAIL: { send } } })
        // Without a token the guard signs in to Google, which fails in tests because the key is fake.
        await instance.flush()
        expect(send).not.toHaveBeenCalled()

        await state.storage.put("failingSince", Date.now() - 31 * 60_000)
        await instance.flush()
        await instance.flush()
        expect(send).toHaveBeenCalledTimes(1)
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
          to: "officer@example.com",
          subject: "Check-ins aren't reaching the Google Sheet",
        }))

        await instance.flush("test-access-token")
        expect(sheets.rows).toHaveLength(1)
        expect(await state.storage.get("failingSince")).toBeUndefined()
        Object.assign(instance, { env: guardEnv })
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it("does not copy a check-in twice when a failed append reached the Sheet", async () => {
    const { sheets } = useFakes()
    sheets.failAppends = true
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      await handleCheckin(checkinRequest({ memberId: null, name: "Ada Lovelace", email: "ada@example.com" }), env, TEST_TIMESTAMP)
      await flush()
      // The append committed even though Google answered with an error.
      sheets.rows.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "(607) 555-0100", "Community Member", await pendingMemberId(), ""])
      await handleCheckin(checkinRequest({ memberId: null, name: "Grace Hopper", email: "grace@example.com" }), env, TEST_TIMESTAMP)

      sheets.failAppends = false
      await flush()
      expect(sheets.rows.map((row) => row[2])).toEqual(["ada@example.com", "grace@example.com"])
    } finally {
      consoleError.mockRestore()
    }
  })

  it("requires a full email and a phone number, and stores the phone formatted in the Phone column", async () => {
    const { sheets } = useFakes()

    const missing = await handleCheckin(checkinRequest({ phone: "123" }), env, TEST_TIMESTAMP)
    const noDomain = await handleCheckin(checkinRequest({ email: "ada@cornell" }), env, TEST_TIMESTAMP)
    const valid = await handleCheckin(checkinRequest({ memberId: null, phone: "1 607.555.0100" }), env, TEST_TIMESTAMP)
    await flush()

    expect(missing.status).toBe(400)
    expect(noDomain.status).toBe(400)
    expect(valid.status).toBe(201)
    expect(sheets.rows[0][3]).toBe("(607) 555-0100")
  })

  it("tells Cornell affiliates what they still need and asks nothing more of non-Cornell attendees", async () => {
    useFakes()
    await env.MEMBER_CACHE.put("campusgroups:v1", JSON.stringify({
      uploadedAt: "2026-10-01T00:00:00.000Z",
      people: {
        "signed@cornell.edu": { member: true, generalRisk: true },
        "contact@cornell.edu": { member: false, generalRisk: true },
      },
    }))
    const nextFor = async (email: string, affiliation: string) => {
      const response = await handleCheckin(checkinRequest({ memberId: null, email, affiliation }), env, TEST_TIMESTAMP)
      return ((await response.json()) as { next: unknown }).next
    }

    expect(await nextFor("guest@example.com", "Community Member")).toEqual({ waiver: null, joinCampusGroups: false })
    expect(await nextFor("alum@example.com", "Alumni")).toEqual({ waiver: null, joinCampusGroups: false })
    expect(await nextFor("signed@cornell.edu", "Staff")).toEqual({ waiver: null, joinCampusGroups: false })
    expect(await nextFor("contact@cornell.edu", "Faculty")).toEqual({ waiver: null, joinCampusGroups: true })
    expect(await nextFor("unknown@cornell.edu", "Undergraduate Student")).toEqual({ waiver: "cornell", joinCampusGroups: true })
  })

  it("rejects a second check-in the same night but allows the next day", async () => {
    const { sheets } = useFakes()
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })

    expect((await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP)).status).toBe(201)
    const sameNight = await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP + HOUR)
    expect(sameNight.status).toBe(409)
    expect(await sameNight.json()).toMatchObject({ message: "Already checked in" })
    expect((await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP + 24 * HOUR)).status).toBe(201)
    await flush()
    await flush(TEST_TIMESTAMP + 24 * HOUR)

    expect(sheets.rows.map((row) => row[5])).toEqual([ADA_MEMBER_ID, ADA_MEMBER_ID])
  })

  it("recovers the durable member ID from an exact email when the client omits it", async () => {
    const { sheets } = useFakes()
    await cacheMembers({
      id: SHAMUS_MEMBER_ID,
      name: "Shamus Li",
      email: "wl757@cornell.edu",
      affiliation: "Graduate/Professional Student",
    })

    const response = await handleCheckin(
      checkinRequest({
        memberId: null,
        name: "Shamus Li",
        email: "wl757@cornell.edu",
        affiliation: "Graduate/Professional Student",
      }),
      env,
      TEST_TIMESTAMP,
    )
    await flush()

    expect(response.status).toBe(201)
    expect(sheets.rows[0][5]).toBe(SHAMUS_MEMBER_ID)
  })

  it("links a typed check-in to the one member with that name and no email", async () => {
    const { sheets } = useFakes()
    await cacheMembers({ id: ADA_MEMBER_ID, name: "Ada Lovelace", email: "", affiliation: "Community Member" })

    const typed = await handleCheckin(
      checkinRequest({ memberId: null, name: "ada lovelace", email: "ada@example.com", affiliation: "Staff" }),
      env,
      TEST_TIMESTAMP,
    )
    const otherName = await handleCheckin(
      checkinRequest({ memberId: null, name: "Ada Byron", email: "byron@example.com" }),
      env,
      TEST_TIMESTAMP,
    )
    await flush()

    expect(typed.status).toBe(201)
    expect(otherName.status).toBe(201)
    expect(sheets.rows[0][5]).toBe(ADA_MEMBER_ID)
    expect(sheets.rows[1][5]).not.toBe(ADA_MEMBER_ID)
  })

  it("lets two members who share an email check in separately", async () => {
    const { sheets } = useFakes()
    await cacheMembers(
      {
        id: ADA_MEMBER_ID,
        name: "Ada Lovelace",
        email: "shared@example.com",
        affiliation: "Community Member",
      },
      {
        id: GRACE_MEMBER_ID,
        name: "Grace Hopper",
        email: "shared@example.com",
        affiliation: "Community Member",
      },
    )

    const ada = await handleCheckin(checkinRequest({ memberId: null, email: "shared@example.com" }), env, TEST_TIMESTAMP)
    const grace = await handleCheckin(
      checkinRequest({ memberId: GRACE_MEMBER_ID, name: "Grace Hopper", email: "shared@example.com" }),
      env,
      TEST_TIMESTAMP + HOUR,
    )
    await flush()

    expect(ada.status).toBe(201)
    expect(grace.status).toBe(201)
    expect(sheets.rows.map((row) => row[5]).sort()).toEqual([ADA_MEMBER_ID, GRACE_MEMBER_ID])
  })

  it("asks attendees to pick their name when the email or name could mean more than one member", async () => {
    useFakes()
    await cacheMembers(
      { id: ADA_MEMBER_ID, name: "Ada Lovelace", email: "shared@example.com", affiliation: "Community Member" },
      { id: GRACE_MEMBER_ID, name: "Grace Hopper", email: "shared@example.com", affiliation: "Community Member" },
      { id: SHAMUS_MEMBER_ID, name: "Shamus Li", email: "wl757@cornell.edu", affiliation: "Staff" },
    )
    const message = async (overrides: Record<string, unknown>) => {
      const response = await handleCheckin(checkinRequest(overrides), env, TEST_TIMESTAMP)
      return [response.status, ((await response.json()) as { message: string }).message]
    }

    expect(await message({ memberId: null, name: "Someone Else", email: "shared@example.com" }))
      .toEqual([400, "More than one member uses that email. Pick your name from the list."])
    expect(await message({ email: "wl757@cornell.edu" })).toEqual([400, "That email belongs to another member."])
  })

  it("handles concurrent check-ins without losing either", async () => {
    const { sheets } = useFakes()

    const [first, second] = await Promise.all([
      handleCheckin(checkinRequest({ memberId: null, name: "Ada Lovelace", email: "ada@example.com" }), env, TEST_TIMESTAMP),
      handleCheckin(checkinRequest({ memberId: null, name: "Grace Hopper", email: "grace@example.com" }), env, TEST_TIMESTAMP),
    ])
    await flush()

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(sheets.rows.map((row) => row[2]).sort()).toEqual(["ada@example.com", "grace@example.com"])
  })

  it("allows only one of two concurrent duplicate check-ins", async () => {
    const { sheets } = useFakes()

    const responses = await Promise.all([
      handleCheckin(checkinRequest({ memberId: null, name: "New Dancer", email: "new@example.com" }), env, TEST_TIMESTAMP),
      handleCheckin(checkinRequest({ memberId: null, name: "New Dancer", email: "new@example.com" }), env, TEST_TIMESTAMP),
    ])
    await flush()

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(sheets.rows).toHaveLength(1)
  })

  it("rejects malformed payloads without recording anything", async () => {
    const { sheets } = useFakes()
    const badPayloads = [
      { email: "not-an-email" },
      { email: "" },
      { affiliation: "Wizard" },
      { memberId: "short" },
      { name: "" },
      { name: "123 --" },
      { name: "x".repeat(161) },
    ]

    for (const overrides of badPayloads) {
      const response = await handleCheckin(checkinRequest(overrides), env, TEST_TIMESTAMP)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        message: "Enter a valid name, email, phone number, and affiliation",
      })
    }

    const notJson = await handleCheckin(
      new Request("https://example.com/check-in/api/checkins", { method: "POST", body: "not json" }),
      env,
      TEST_TIMESTAMP,
    )
    expect(notJson.status).toBe(400)

    const oversized = await handleCheckin(
      new Request("https://example.com/check-in/api/checkins", {
        method: "POST",
        headers: { "Content-Length": "8192" },
        body: "{}",
      }),
      env,
      TEST_TIMESTAMP,
    )
    expect(oversized.status).toBe(413)

    await flush()
    expect(sheets.appends).toBe(0)
  })

  it("rejects a client-supplied member ID that is not in the roster", async () => {
    const { sheets } = useFakes()
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })

    const response = await handleCheckin(checkinRequest({ memberId: MISSING_MEMBER_ID }), env, TEST_TIMESTAMP)
    await flush()

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: "That member record is no longer available. Select “Not you?” and choose again.",
    })
    expect(sheets.appends).toBe(0)
  })

  it("uses a stale roster snapshot during submission instead of querying Notion", async () => {
    const { notion } = useFakes()
    await env.MEMBER_CACHE.put(
      "members:v2",
      JSON.stringify({
        refreshedAt: Date.now() - 24 * 60 * 60 * 1000,
        members: [{
          id: ADA_MEMBER_ID,
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "",
          affiliation: "Community Member",
        }],
      }),
    )

    const response = await handleCheckin(checkinRequest(), env, TEST_TIMESTAMP)

    expect(response.status).toBe(201)
    expect(notion.queries).toBe(0)
  })

  it("answers 503 with a generic message when a backend fails", async () => {
    useFakes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const brokenDb = { prepare() { throw new Error("D1 is unavailable") } } as unknown as D1Database

    try {
      const response = await handleApiRequest(checkinRequest({ memberId: null }), { ...env, EVENTS_DB: brokenDb })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ message: "Check-in failed" })
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe("nightly sync", () => {
  it("rejects the scheduled invocation when a row fails", async () => {
    const { sheets } = useFakes()
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP), "Ada Lovelace", "not-an-email", "", "Community Member", ADA_MEMBER_ID,
    ])
    const { privateKey } = await generateKeyPair("RS256", { extractable: true })
    network.use(http.post("https://oauth2.googleapis.com/token", () =>
      HttpResponse.json({ access_token: "test-access-token" }),
    ))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await expect(worker.scheduled(createScheduledController(), {
        ...env,
        GOOGLE_PRIVATE_KEY: await exportPKCS8(privateKey),
      })).rejects.toThrow("1 failed")
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("nightly attendance sync failed"))
      expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining("nightly attendance sync complete"))
    } finally {
      consoleError.mockRestore()
      consoleLog.mockRestore()
    }
  })

  it("converges the sheet and Notion, then a second run makes no further writes", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push(
      [serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID],
      [serialFor(TEST_TIMESTAMP + 60_000), "Grace Hopper", "grace@example.com", "", "Alumni", GRACE_MEMBER_ID],
      // The legacy Student affiliation must keep syncing even though the form no longer offers it.
      [serialFor(TEST_TIMESTAMP + 120_000), "Legacy Lee", "legacy@example.com", "", "Student", ""],
    )

    const first = await runNightlySync(env, token)

    expect(first).toEqual({ synced: 3, failed: 0 })
    // One event for the night, every attendee related to it.
    expect(notion.events).toHaveLength(1)
    expect(notion.events[0]).toMatchObject({ date: "2026-08-25", name: "2026-08-25 Swing Dance" })
    expect(notion.members).toHaveLength(3)
    for (const member of notion.members) {
      expect(member.events).toEqual([notion.events[0].pageId])
      expect(member.memberSince).toBe("2026-08-25")
    }
    // The legacy row got a durable member ID backfilled into the sheet.
    const legacyRow = sheets.rows.find((row) => row[2] === "legacy@example.com")
    expect(String(legacyRow?.[5])).toMatch(MEMBER_ID_PATTERN)
    // The sheet ends up sorted newest-first.
    const serials = sheets.rows.map((row) => Number(row[0]))
    expect(serials).toEqual([...serials].sort((left, right) => right - left))

    const notionWrites = notion.writes
    const sheetWrites = sheets.updates + sheets.appends
    const sheetSorts = sheets.sorts
    const second = await runNightlySync(env, token)

    expect(second).toEqual({ synced: 0, failed: 0 })
    expect(notion.writes).toBe(notionWrites)
    expect(sheets.updates + sheets.appends).toBe(sheetWrites)
    expect(sheets.sorts).toBe(sheetSorts)
  })

  it("counts each member's nights in the last four months and their latest night", async () => {
    const { sheets } = useFakes()
    const DAY = 24 * HOUR
    const now = Date.now()
    sheets.rows.push(
      [serialFor(now - 200 * DAY), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID],
      [serialFor(now - 14 * DAY), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID],
      [serialFor(now - 7 * DAY), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID],
      [serialFor(now - 300 * DAY), "Grace Hopper", "grace@example.com", "", "Alumni", GRACE_MEMBER_ID],
    )

    await runNightlySync(env, token)

    expect(await env.MEMBER_CACHE.get("checkin-stats:v1", "json")).toEqual({
      [ADA_MEMBER_ID]: { nights: 2, last: dateKeyForSheetTimestamp(serialFor(now - 7 * DAY)) },
      [GRACE_MEMBER_ID]: { nights: 0, last: dateKeyForSheetTimestamp(serialFor(now - 300 * DAY)) },
    })
  })

  it("reconciles existing rows when it initializes incremental state", async () => {
    const { sheets, notion } = useFakes()
    await env.MEMBER_CACHE.delete(ATTENDANCE_SYNC_STATE_KEY)
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Community Member",
      ADA_MEMBER_ID,
    ])

    const first = await runNightlySync(env, token)

    expect(first).toEqual({ synced: 1, failed: 0 })
    expect(notion.events).toHaveLength(1)
    expect(notion.members.map((member) => member.memberId)).toEqual([ADA_MEMBER_ID])

    sheets.rows.push([
      serialFor(TEST_TIMESTAMP + 60_000),
      "Grace Hopper",
      "grace@example.com",
      "",
      "Alumni",
      GRACE_MEMBER_ID,
    ])
    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members.map((member) => member.memberId).sort()).toEqual([
      ADA_MEMBER_ID,
      GRACE_MEMBER_ID,
    ])
  })

  it("backfills every event when upgrading a legacy checkpoint", async () => {
    const { sheets, notion } = useFakes()
    const august24 = notion.addEvent("2026-08-24")
    const august31 = notion.addEvent("2026-08-31")
    const ella = notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ella Kramer",
      email: "ella@example.com",
      affiliation: "Community Member",
      events: [august31.pageId],
    })
    const stale = notion.addMember({
      memberId: GRACE_MEMBER_ID,
      name: "Stale Attendee",
      email: "stale@example.com",
      affiliation: "Community Member",
      events: [august24.pageId],
    })
    august24.attendees = [stale.pageId]
    august31.attendees = [ella.pageId]
    sheets.rows.push(
      [serialFor(Date.parse("2026-08-24T23:00:00Z")), "Earlier Name", "ella@example.com", "", "Community Member", ADA_MEMBER_ID],
      [serialFor(Date.parse("2026-08-31T23:00:00Z")), "Ella Kramer", "ella@example.com", "", "Community Member", ADA_MEMBER_ID],
    )
    const legacyFingerprints = sheets.rows.map((row) => JSON.stringify(row))
    await env.MEMBER_CACHE.put(
      ATTENDANCE_SYNC_STATE_KEY,
      JSON.stringify({ version: 1, fingerprints: legacyFingerprints }),
    )

    expect(await runNightlySync(env, token)).toEqual({ synced: 2, failed: 0 })
    expect(august24.attendees).toEqual([ella.pageId])
    expect(august31.attendees).toEqual([ella.pageId])
    expect(ella.events.sort()).toEqual([august24.pageId, august31.pageId].sort())
    expect(ella.name).toBe("Ella Kramer")
    expect(stale.events).toEqual([])
    expect(await env.MEMBER_CACHE.get(ATTENDANCE_SYNC_STATE_KEY, "json")).toMatchObject({
      version: ATTENDANCE_SYNC_STATE_VERSION,
    })
  })

  it("resyncs a row when its Sheet data changes", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Community Member",
      ADA_MEMBER_ID,
    ])

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    sheets.rows[0][1] = "Changed in the Sheet"

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0].name).toBe("Changed in the Sheet")
  })

  it("overwrites newer Notion details from a legacy Sheet row", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Graduate/Professional Student",
      lastEditedTime: "2026-08-26T12:00:00.000Z", // edited after the check-in
    })
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Old Name", "ada@example.com", "", "Community Member", ""])

    const result = await runNightlySync(env, token)

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(sheets.rows[0].slice(1)).toEqual([
      "Old Name",
      "ada@example.com",
      "",
      "Community Member",
      ADA_MEMBER_ID,
    ])
    expect(notion.members[0]).toMatchObject({
      name: "Old Name",
      affiliation: "Community Member",
    })
    expect(notion.members[0].events).toEqual([notion.events[0].pageId])
  })

  it("copies the newest check-in's phone number to Notion", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({ memberId: ADA_MEMBER_ID, name: "Ada Lovelace", email: "ada@example.com", affiliation: "Staff" })
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "(607) 555-0100", "Staff", ADA_MEMBER_ID])

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0].phone).toBe("(607) 555-0100")
  })

  it("lists each night's waiver signers on the Notion event and marks General Risk waivers from the upload", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({ memberId: ADA_MEMBER_ID, name: "Ada Lovelace", email: "ada@example.com", affiliation: "Community Member" })
    notion.addMember({ memberId: GRACE_MEMBER_ID, name: "Grace Hopper", email: "gh1@cornell.edu", affiliation: "Staff" })
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID])
    sheets.waivers.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "(607) 555-0100", "August 25, 2026 Swing Dance"])
    await env.MEMBER_CACHE.put("campusgroups:v1", JSON.stringify({
      uploadedAt: "2026-10-01T12:00:00.000Z",
      people: { "gh1@cornell.edu": { member: true, generalRisk: true } },
    }))

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.events[0].waivers).toEqual([notion.members[0].pageId])
    expect(notion.members[1].generalRiskWaiver).toBe("AY 26/27")
    expect(notion.members[0].generalRiskWaiver ?? null).toBeNull()
  })

  it("uses Sheet details regardless of edit time while preserving existing event relations", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Old Name",
      email: "ada@example.com",
      affiliation: "Alumni",
      events: ["previous-event-id"],
      lastEditedTime: "2026-08-26T12:00:00.000Z", // edited after the check-in
    })
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "", "Community Member", ""])

    const result = await runNightlySync(env, token)

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0]).toMatchObject({
      name: "Ada Lovelace",
      affiliation: "Community Member",
      events: ["previous-event-id", notion.events[0].pageId],
    })
    expect(sheets.rows[0][5]).toBe(ADA_MEMBER_ID)
  })

  it("creates a Notion member when a check-in Member ID is missing from the roster", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Grace Hopper",
      "grace@example.com",
      "",
      "Alumni",
      GRACE_MEMBER_ID,
    ])

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members.find((member) => member.memberId === GRACE_MEMBER_ID)).toMatchObject({
      name: "Grace Hopper",
      email: "grace@example.com",
      affiliation: "Alumni",
    })
  })

  it("links a check-in with a new Member ID to the existing member with that email", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    // The kiosk assigns a fresh ID when someone checks in before reaching Notion.
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "", "Alumni", GRACE_MEMBER_ID])

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members).toHaveLength(1)
    expect(notion.members[0]).toMatchObject({ affiliation: "Alumni", events: [notion.events[0].pageId] })
    expect(sheets.rows[0][5]).toBe(ADA_MEMBER_ID)
  })

  it("gives each event of a night its own Notion event, taking over the date-only page from before event IDs", async () => {
    const { sheets, notion } = useFakes()
    await addEvent("workshop", "17:00", "18:00")
    await addEvent("social", "19:30", "22:00")
    const datedPage = notion.addEvent("2026-08-25")
    sheets.rows.push(
      [serialFor(TEST_TIMESTAMP - 90 * 60_000), "Grace Hopper", "grace@example.com", "", "Alumni", GRACE_MEMBER_ID, "workshop"],
      // A row added by hand has no Event ID, so it belongs to the event closest to its time.
      [serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID],
    )

    expect(await runNightlySync(env, token)).toEqual({ synced: 2, failed: 0 })

    const grace = notion.members.find((member) => member.memberId === GRACE_MEMBER_ID)!
    const ada = notion.members.find((member) => member.memberId === ADA_MEMBER_ID)!
    expect(notion.events).toMatchObject([
      { pageId: datedPage.pageId, eventId: "workshop", attendees: [grace.pageId] },
      { name: "2026-08-25 social", date: "2026-08-25", eventId: "social", attendees: [ada.pageId] },
    ])
  })

  it("rejects an ID and email that point to different Notion members", async () => {
    const { sheets, notion } = useFakes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    notion.addMember({
      memberId: GRACE_MEMBER_ID,
      name: "Grace Hopper",
      email: "grace@example.com",
      affiliation: "Alumni",
    })
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Not Ada",
      "ada@example.com",
      "",
      "Alumni",
      GRACE_MEMBER_ID,
    ])

    try {
      await expect(runNightlySync(env, token)).rejects.toThrow("0 synced, 1 failed")
      expect(notion.members).toHaveLength(2)
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(
        "That email belongs to another member.",
      ))
    } finally {
      consoleError.mockRestore()
    }
  })

  it("syncs 50 attendees with a large roster in fewer than 25 Notion requests", async () => {
    const { sheets, notion } = useFakes()
    for (let index = 0; index < 40; index += 1) {
      notion.addMember({
        memberId: `Member${String(index).padStart(6, "0")}`,
        name: `Member ${index}`,
        email: `member${index}@example.com`,
        affiliation: "Community Member",
      })
    }
    for (let index = 0; index < 460; index += 1) {
      notion.addMember({
        memberId: `Filler${String(index).padStart(6, "0")}`,
        name: `Filler ${index}`,
        email: `filler${index}@example.com`,
        affiliation: "Staff",
      })
    }
    for (let index = 0; index < 50; index += 1) {
      sheets.rows.push([
        serialFor(TEST_TIMESTAMP + index * 60_000),
        `Member ${index}`,
        `member${index}@example.com`,
        "",
        "Community Member",
        `Member${String(index).padStart(6, "0")}`,
      ])
    }

    expect(await runNightlySync(env, token)).toEqual({ synced: 50, failed: 0 })
    // One more than before event IDs: a new event is also looked for among events that have only a date.
    expect(notion.requests).toBe(19)
    expect(notion.events[0].attendees).toHaveLength(50)
    expect(notion.members).toHaveLength(510)

    const firstRunRequests = notion.requests
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP + 50 * 60_000),
      "Member 50",
      "member50@example.com",
      "",
      "Community Member",
      "Member000050",
    ])
    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.requests - firstRunRequests).toBe(10)
    expect(notion.events[0].attendees).toHaveLength(51)
  })

  it("clears email-as-name placeholders and fills the member ID with one sheet update", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "ada@example.com",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "ada@example.com",
      "ada@example.com",
      "",
      "Community Member",
      "",
    ])

    const result = await runNightlySync(env, token)

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0].name).toBe("")
    expect(sheets.rows[0][1]).toBe("")
    expect(sheets.rows[0][5]).toBe(ADA_MEMBER_ID)
    expect(sheets.updates).toBe(1)
  })

  it("keeps syncing the remaining rows when one row is invalid", async () => {
    const { sheets, notion } = useFakes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    sheets.rows.push(
      [serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "", "Community Member", ADA_MEMBER_ID],
      [serialFor(TEST_TIMESTAMP), "Broken Row", "not-an-email", "", "Community Member", ""],
      [serialFor(TEST_TIMESTAMP), "Grace Hopper", "grace@example.com", "", "Alumni", GRACE_MEMBER_ID],
    )

    try {
      await expect(runNightlySync(env, token)).rejects.toThrow("2 synced, 1 failed")
      expect(notion.members.map((member) => member.memberId).sort()).toEqual([
        ADA_MEMBER_ID,
        GRACE_MEMBER_ID,
      ])
      await expect(runNightlySync(env, token)).rejects.toThrow("0 synced, 1 failed")
      expect(notion.members).toHaveLength(2)
      expect(consoleError).toHaveBeenCalledTimes(2)
    } finally {
      consoleError.mockRestore()
    }
  })

  it("fails a row instead of guessing when a date has two Notion events", async () => {
    const { sheets, notion } = useFakes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    notion.addEvent("2026-08-25")
    notion.addEvent("2026-08-25")
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Community Member",
      ADA_MEMBER_ID,
    ])

    try {
      await expect(runNightlySync(env, token)).rejects.toThrow("0 synced, 1 failed")
      expect(notion.members).toHaveLength(0)
    } finally {
      consoleError.mockRestore()
    }
  })

  it("fails when sorting fails and retries without advancing the checkpoint", async () => {
    const { sheets } = useFakes()
    sheets.failSort = true
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Community Member",
      ADA_MEMBER_ID,
    ])
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      await expect(runNightlySync(env, token)).rejects.toThrow("403")
      expect(await env.MEMBER_CACHE.get(ATTENDANCE_SYNC_STATE_KEY, "json")).toEqual({
        version: ATTENDANCE_SYNC_STATE_VERSION,
        fingerprints: [],
      })

      sheets.failSort = false
      await expect(runNightlySync(env, token)).resolves.toEqual({ synced: 1, failed: 0 })
      expect(sheets.sorts).toBe(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})

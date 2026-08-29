import { env, exports } from "cloudflare:workers"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ATTENDANCE_SYNC_STATE_KEY,
  handleApiRequest,
  handleCheckin,
  runNightlySync,
} from "../worker"
import { searchCachedMembers } from "../worker/cache"
import { dateKeyForSheetTimestamp, dateKeyInTimeZone, timestampForSheet } from "../worker/google"
import { MEMBER_ID_PATTERN } from "../worker/member-id"
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
  await env.MEMBER_CACHE.delete("members:v2")
  await env.MEMBER_CACHE.put(
    ATTENDANCE_SYNC_STATE_KEY,
    JSON.stringify({ version: 1, fingerprints: [] }),
  )
})

function useFakes() {
  const sheets = new FakeSheets()
  const notion = new FakeNotion()
  network.use(...sheets.handlers(), ...notion.handlers())
  return { sheets, notion }
}

function checkinRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://example.com/check-in/api/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ADA@EXAMPLE.COM",
      affiliation: "Community Member",
      ...overrides,
    }),
  })
}

async function cacheMembers(...members: Array<{
  id: string
  name: string
  email: string
  affiliation: string
}>): Promise<void> {
  await env.MEMBER_CACHE.put("members:v2", JSON.stringify({ refreshedAt: Date.now(), members }))
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

  it("encodes the local wall-clock time in the serial number", () => {
    const serial = serialFor(TEST_TIMESTAMP)
    expect(dateKeyForSheetTimestamp(serial)).toBe("2026-08-25")
    expect(serial % 1).toBeCloseTo(19 / 24, 6)
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

    const response = await exports.default.fetch("https://example.com/check-in/api/members?q=Ada")

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      members: [
        {
          id: ADA_MEMBER_ID,
          name: "Ada Lovelace",
          email: "ada@example.com",
          affiliation: "Community Member",
        },
      ],
    })
    expect(notion.queries).toBe(2)

    await exports.default.fetch("https://example.com/check-in/api/members?q=Roster")
    expect(notion.queries).toBe(2) // second search served from the cached roster
  })

  it("serves a fresh snapshot from KV but refreshes a stale one", async () => {
    const { notion } = useFakes()
    notion.addMember({
      memberId: "Fresh_000001",
      name: "Fresh Fiona",
      email: "fiona@example.com",
      affiliation: "Staff",
    })
    const cachedSam = { id: "Stale_000001", name: "Stale Sam", email: "sam@example.com", affiliation: "Staff" }

    await env.MEMBER_CACHE.put(
      "members:v2",
      JSON.stringify({ refreshedAt: Date.now(), members: [cachedSam] }),
    )
    expect((await searchCachedMembers(env, "sam")).map((member) => member.id)).toEqual(["Stale_000001"])
    expect(notion.queries).toBe(0)

    await env.MEMBER_CACHE.put(
      "members:v2",
      JSON.stringify({ refreshedAt: Date.now() - 16 * 60 * 1000, members: [cachedSam] }),
    )
    expect((await searchCachedMembers(env, "fiona")).map((member) => member.id)).toEqual(["Fresh_000001"])
    expect(notion.queries).toBeGreaterThan(0)
  })

  it("ranks exact and prefix matches before substring matches", async () => {
    await cacheMembers(
      {
        id: "Exact_000001",
        name: "Ada",
        email: "exact@example.com",
        affiliation: "Community Member",
      },
      {
        id: "Email_000001",
        name: "Email Prefix",
        email: "ada@example.com",
        affiliation: "Community Member",
      },
      {
        id: "Name__000001",
        name: "Ada Lovelace",
        email: "name@example.com",
        affiliation: "Community Member",
      },
      {
        id: "Token_000001",
        name: "Grace Ada",
        email: "token@example.com",
        affiliation: "Community Member",
      },
      {
        id: "Inside000001",
        name: "Madam Hopper",
        email: "inside@example.com",
        affiliation: "Community Member",
      },
    )

    const results = await searchCachedMembers(env, "ADA")

    expect(results.map((member) => member.id)).toEqual([
      "Exact_000001",
      "Email_000001",
      "Name__000001",
      "Token_000001",
      "Inside000001",
    ])
  })

  it("searches after one character", async () => {
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })

    const response = await exports.default.fetch("https://example.com/check-in/api/members?q=A")
    expect(await response.json()).toEqual({
      members: [
        {
          id: ADA_MEMBER_ID,
          name: "Ada Lovelace",
          email: "ada@example.com",
          affiliation: "Community Member",
        },
      ],
    })
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
      new Request("https://example.com/check-in/api/members?q=Ada", {
        headers: { "Cf-Access-Authenticated-User-Email": "Kiosk@Example.COM" },
      }),
      limitedEnv,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(await response.json()).toEqual({
      message: "Too many member searches. Wait a minute and try again.",
    })

    await handleApiRequest(new Request("https://example.com/check-in/api/members?q=Ada"), limitedEnv)
    expect(keys).toEqual(["kiosk@example.com", "access-identity-missing"])
  })
})

describe("check-in", () => {
  it("records a first-time attendee with a generated durable member ID", async () => {
    const { sheets } = useFakes()

    const response = await handleCheckin(
      checkinRequest({ memberId: null, name: "New Dancer", email: "new@example.com" }),
      env,
      token,
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(201)
    expect(sheets.rows).toHaveLength(1)
    const [timestamp, name, email, affiliation, memberId] = sheets.rows[0]
    expect(timestamp).toBe(serialFor(TEST_TIMESTAMP))
    expect(name).toBe("New Dancer")
    expect(email).toBe("new@example.com")
    expect(affiliation).toBe("Community Member")
    expect(String(memberId)).toMatch(MEMBER_ID_PATTERN)
  })

  it("rejects a second check-in the same night but allows the next day", async () => {
    const { sheets } = useFakes()
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })

    expect((await handleCheckin(checkinRequest(), env, token, TEST_TIMESTAMP)).status).toBe(201)
    expect(sheets.rows[0][4]).toBe(ADA_MEMBER_ID)

    const sameNight = await handleCheckin(checkinRequest(), env, token, TEST_TIMESTAMP + HOUR)
    expect(sameNight.status).toBe(409)
    expect(await sameNight.json()).toEqual({ message: "Already checked in" })
    expect(sheets.rows).toHaveLength(1)

    const nextDay = await handleCheckin(checkinRequest(), env, token, TEST_TIMESTAMP + 24 * HOUR)
    expect(nextDay.status).toBe(201)
    expect(sheets.rows).toHaveLength(2)
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
      token,
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(201)
    expect(sheets.rows[0][4]).toBe(SHAMUS_MEMBER_ID)
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

    const ada = await handleCheckin(
      checkinRequest({ email: "shared@example.com" }),
      env,
      token,
      TEST_TIMESTAMP,
    )
    const grace = await handleCheckin(
      checkinRequest({ memberId: GRACE_MEMBER_ID, name: "Grace Hopper", email: "shared@example.com" }),
      env,
      token,
      TEST_TIMESTAMP + HOUR,
    )

    expect(ada.status).toBe(201)
    expect(grace.status).toBe(201)
    expect(sheets.rows.map((row) => row[4]).sort()).toEqual([ADA_MEMBER_ID, GRACE_MEMBER_ID])
  })

  it("handles concurrent check-ins without losing either", async () => {
    const { sheets } = useFakes()

    const [first, second] = await Promise.all([
      handleCheckin(
        checkinRequest({ memberId: null, name: "Ada Lovelace", email: "ada@example.com" }),
        env,
        token,
        TEST_TIMESTAMP,
      ),
      handleCheckin(
        checkinRequest({ memberId: null, name: "Grace Hopper", email: "grace@example.com" }),
        env,
        token,
        TEST_TIMESTAMP,
      ),
    ])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(sheets.rows.map((row) => row[2]).sort()).toEqual(["ada@example.com", "grace@example.com"])
  })

  it("accepts the legacy Student affiliation", async () => {
    const { sheets } = useFakes()

    const response = await handleCheckin(
      checkinRequest({ memberId: null, email: "student@example.com", affiliation: "Student" }),
      env,
      token,
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(201)
    expect(sheets.rows[0][3]).toBe("Student")
  })

  it("rejects malformed payloads without touching the sheet", async () => {
    const { sheets } = useFakes()
    const badPayloads = [
      { email: "not-an-email" },
      { email: "" },
      { affiliation: "Wizard" },
      { memberId: "short" },
      { name: "x".repeat(161) },
    ]

    for (const overrides of badPayloads) {
      const response = await handleCheckin(checkinRequest(overrides), env, token, TEST_TIMESTAMP)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ message: "Enter a valid email and affiliation" })
    }

    const notJson = await handleCheckin(
      new Request("https://example.com/check-in/api/checkins", { method: "POST", body: "not json" }),
      env,
      token,
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
      token,
      TEST_TIMESTAMP,
    )
    expect(oversized.status).toBe(413)

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

    const response = await handleCheckin(
      checkinRequest({ memberId: MISSING_MEMBER_ID }),
      env,
      token,
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: "That member record is no longer available. Select “Not you?” and choose again.",
    })
    expect(sheets.reads).toBe(0)
    expect(sheets.appends).toBe(0)
  })

  it("retries transient Google Sheets failures", async () => {
    const { sheets } = useFakes()
    sheets.transientFailures = 2
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })

    const response = await handleCheckin(checkinRequest(), env, token, TEST_TIMESTAMP)

    expect(response.status).toBe(201)
    expect(sheets.reads).toBe(3)
    expect(sheets.rows).toHaveLength(1)
  })

  it("answers 503 with a generic message when a backend fails", async () => {
    useFakes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      // The test environment has no real Google key, so the token exchange throws.
      const response = await exports.default.fetch(checkinRequest({ memberId: null }))
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ message: "Check-in failed" })
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe("nightly sync", () => {
  it("converges the sheet and Notion, then a second run makes no further writes", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push(
      [serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "Community Member", ADA_MEMBER_ID],
      [serialFor(TEST_TIMESTAMP + 60_000), "Grace Hopper", "grace@example.com", "Alumni", GRACE_MEMBER_ID],
      [serialFor(TEST_TIMESTAMP + 120_000), "Legacy Lee", "legacy@example.com", "Staff", ""],
    )

    const first = await runNightlySync(env, token)

    expect(first).toEqual({ synced: 3, failed: 0 })
    // One event for the night, every attendee related to it.
    expect(notion.events).toHaveLength(1)
    expect(notion.events[0]).toMatchObject({ date: "2026-08-25", name: "2026-08-25" })
    expect(notion.members).toHaveLength(3)
    for (const member of notion.members) {
      expect(member.events).toEqual([notion.events[0].pageId])
      expect(member.memberSince).toBe("2026-08-25")
    }
    // The legacy row got a durable member ID backfilled into the sheet.
    const legacyRow = sheets.rows.find((row) => row[2] === "legacy@example.com")
    expect(String(legacyRow?.[4])).toMatch(MEMBER_ID_PATTERN)
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

  it("reconciles existing rows when it initializes incremental state", async () => {
    const { sheets, notion } = useFakes()
    await env.MEMBER_CACHE.delete(ATTENDANCE_SYNC_STATE_KEY)
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
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
      "Alumni",
      GRACE_MEMBER_ID,
    ])
    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members.map((member) => member.memberId).sort()).toEqual([
      ADA_MEMBER_ID,
      GRACE_MEMBER_ID,
    ])
  })

  it("resyncs a row when its Sheet data changes", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
      "Community Member",
      ADA_MEMBER_ID,
    ])

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    sheets.rows[0][1] = "Changed in the Sheet"

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0].name).toBe("Changed in the Sheet")
  })

  it("backfills newer Notion details into a legacy sheet row", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Graduate/Professional Student",
      lastEditedTime: "2026-08-26T12:00:00.000Z", // edited after the check-in
    })
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Old Name", "ada@example.com", "Community Member", ""])

    const result = await runNightlySync(env, token)

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(sheets.rows[0].slice(1)).toEqual([
      "Ada Lovelace",
      "ada@example.com",
      "Graduate/Professional Student",
      ADA_MEMBER_ID,
    ])
    expect(notion.members[0].name).toBe("Ada Lovelace")
    expect(notion.members[0].events).toEqual([notion.events[0].pageId])
  })

  it("prefers newer sheet details while preserving existing event relations", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({
      memberId: ADA_MEMBER_ID,
      name: "Old Name",
      email: "ada@example.com",
      affiliation: "Alumni",
      events: ["previous-event-id"],
      lastEditedTime: "2026-08-25T18:00:00.000Z", // edited before the check-in
    })
    sheets.rows.push([serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "Community Member", ""])

    const result = await runNightlySync(env, token)

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0]).toMatchObject({
      name: "Ada Lovelace",
      affiliation: "Community Member",
      events: ["previous-event-id", notion.events[0].pageId],
    })
    expect(sheets.rows[0][4]).toBe(ADA_MEMBER_ID)
  })

  it("clears email-as-name placeholders from both systems", async () => {
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
      "Community Member",
      ADA_MEMBER_ID,
    ])

    const result = await runNightlySync(env, token)

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(notion.members[0].name).toBe("")
    expect(sheets.rows[0][1]).toBe("")
  })

  it("keeps syncing the remaining rows when one row is invalid", async () => {
    const { sheets, notion } = useFakes()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    sheets.rows.push(
      [serialFor(TEST_TIMESTAMP), "Ada Lovelace", "ada@example.com", "Community Member", ADA_MEMBER_ID],
      [serialFor(TEST_TIMESTAMP), "Broken Row", "not-an-email", "Community Member", ""],
      [serialFor(TEST_TIMESTAMP), "Grace Hopper", "grace@example.com", "Alumni", GRACE_MEMBER_ID],
    )

    try {
      const result = await runNightlySync(env, token)

      expect(result).toEqual({ synced: 2, failed: 1 })
      expect(notion.members.map((member) => member.memberId).sort()).toEqual([
        ADA_MEMBER_ID,
        GRACE_MEMBER_ID,
      ])
      expect(await runNightlySync(env, token)).toEqual({ synced: 0, failed: 1 })
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
      "Community Member",
      ADA_MEMBER_ID,
    ])

    try {
      const result = await runNightlySync(env, token)

      expect(result).toEqual({ synced: 0, failed: 1 })
      expect(notion.members).toHaveLength(0)
    } finally {
      consoleError.mockRestore()
    }
  })

  it("still completes when sorting fails", async () => {
    const { sheets } = useFakes()
    sheets.failSort = true
    sheets.rows.push([
      serialFor(TEST_TIMESTAMP),
      "Ada Lovelace",
      "ada@example.com",
      "Community Member",
      ADA_MEMBER_ID,
    ])
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      await expect(runNightlySync(env, token)).resolves.toEqual({ synced: 1, failed: 0 })
      expect(consoleError).toHaveBeenCalledOnce()

      sheets.failSort = false
      await expect(runNightlySync(env, token)).resolves.toEqual({ synced: 1, failed: 0 })
      expect(sheets.sorts).toBe(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})

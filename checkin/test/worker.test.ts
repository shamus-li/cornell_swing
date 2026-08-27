import { env, exports } from "cloudflare:workers"
import { HttpResponse, http } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { handleCheckin, runNightlySync } from "../worker"
import { searchCachedMembers } from "../worker/cache"
import { readCheckins, timestampForSheet } from "../worker/google"
import { createMemberId, MEMBER_ID_PATTERN } from "../worker/member-id"
import { network } from "./network"

const TEST_TIMESTAMP = Date.parse("2026-08-25T23:00:00Z")
const ADA_MEMBER_ID = "Ada_00000001"
const GRACE_MEMBER_ID = "Grace_000001"
const SHAMUS_MEMBER_ID = "Shamus_00001"
const UNNAMED_MEMBER_ID = "Unknown_0001"
const MISSING_MEMBER_ID = "Missing_0001"

beforeEach(async () => {
  await env.MEMBER_CACHE.delete("members:v2")
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

// The nightly sync sorts the sheet after reconciliation.
function sheetSortHandlers() {
  return [
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId", () =>
      HttpResponse.json({ sheets: [{ properties: { sheetId: 123, title: "Check-ins" } }] }),
    ),
    http.post(/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+:batchUpdate/, () =>
      HttpResponse.json({ replies: [{}] }),
    ),
  ]
}

describe("member IDs", () => {
  it("generates unique 12-character Nano IDs", () => {
    const ids = Array.from({ length: 100 }, () => createMemberId())
    expect(ids.every((id) => MEMBER_ID_PATTERN.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("member search", () => {
  it("caches the Notion roster and searches it by name or email", async () => {
    let notionQueries = 0
    network.use(
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", async ({ request }) => {
        notionQueries += 1
        const body = await request.json()
        expect(body).toMatchObject({
          page_size: 100,
          result_type: "page",
        })
        if (notionQueries === 2) expect(body).toMatchObject({ start_cursor: "next-page" })
        return HttpResponse.json({
          object: "list",
          has_more: notionQueries === 1,
          next_cursor: notionQueries === 1 ? "next-page" : null,
          results: notionQueries === 1 ? [
            {
              object: "page",
              id: "member-page-id",
              last_edited_time: "2026-08-25T20:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "Ada Lovelace" }] },
                Email: { email: null },
                Affiliation: { select: { name: "Community Member" } },
                "Member ID": { rich_text: [{ plain_text: ADA_MEMBER_ID }] },
              },
            },
          ] : [
            {
              object: "page",
              id: "email-member-page-id",
              last_edited_time: "2026-08-25T20:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "Shamus Li" }] },
                Email: { email: "wl757@cornell.edu" },
                Affiliation: { select: { name: "Graduate/Professional Student" } },
                "Member ID": { rich_text: [{ plain_text: SHAMUS_MEMBER_ID }] },
              },
            },
            {
              object: "page",
              id: "unnamed-member-page-id",
              last_edited_time: "2026-08-25T20:00:00.000Z",
              properties: {
                Name: { title: [] },
                Email: { email: "unnamed@example.com" },
                Affiliation: { select: { name: "Alumni" } },
                "Member ID": { rich_text: [{ plain_text: UNNAMED_MEMBER_ID }] },
              },
            },
          ],
        })
      }),
    )

    const response = await exports.default.fetch("https://example.com/check-in/api/members?q=Ada")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      members: [
        {
          id: ADA_MEMBER_ID,
          name: "Ada Lovelace",
          email: "",
          affiliation: "Community Member",
        },
      ],
    })

    const emailResponse = await exports.default.fetch(
      "https://example.com/check-in/api/members?q=WL757",
    )
    expect(await emailResponse.json()).toEqual({
      members: [
        {
          id: SHAMUS_MEMBER_ID,
          name: "Shamus Li",
          email: "wl757@cornell.edu",
          affiliation: "Graduate/Professional Student",
        },
      ],
    })

    const unnamedResponse = await exports.default.fetch(
      "https://example.com/check-in/api/members?q=unnamed%40example.com",
    )
    expect(await unnamedResponse.json()).toEqual({
      members: [
        {
          id: UNNAMED_MEMBER_ID,
          name: "",
          email: "unnamed@example.com",
          affiliation: "Alumni",
        },
      ],
    })
    expect(notionQueries).toBe(2)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
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

  it("rate limits repeated roster enumeration by Access identity", async () => {
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    const request = () => new Request("https://example.com/check-in/api/members?q=Ada", {
      headers: { "Cf-Access-Authenticated-User-Email": "rate-limit-test@example.com" },
    })

    for (let index = 0; index < 300; index += 1) {
      expect((await exports.default.fetch(request())).status).toBe(200)
    }
    const response = await exports.default.fetch(request())

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(await response.json()).toEqual({
      message: "Too many member searches. Wait a minute and try again.",
    })
  })
})

describe("check-in", () => {
  it("retries transient Google Sheets failures", async () => {
    let reads = 0
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        reads += 1
        return reads < 3
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ values: [] })
      }),
    )

    await readCheckins(env, "test-access-token")

    expect(reads).toBe(3)
  })

  it("appends the check-in atomically with the durable member ID", async () => {
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    let appended: { url: URL; body: unknown } | null = null
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({ range: "Check-ins!A2:E", values: [] }),
      ),
      http.post(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        async ({ request }) => {
          appended = { url: new URL(request.url), body: await request.json() }
          return HttpResponse.json({ updates: { updatedRows: 1 } })
        },
      ),
    )

    const response = await handleCheckin(checkinRequest(), env, async () => "test-access-token", TEST_TIMESTAMP)

    expect(response.status).toBe(201)
    expect(appended).not.toBeNull()
    expect(appended!.url.pathname.endsWith(":append")).toBe(true)
    expect(appended!.url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS")
    expect(appended!.body).toEqual({
      majorDimension: "ROWS",
      values: [
        [
          timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
          "Ada Lovelace",
          "ada@example.com",
          "Community Member",
          ADA_MEMBER_ID,
        ],
      ],
    })
  })

  it("recovers the durable member ID from an exact email when the client omits it", async () => {
    let written: unknown
    network.use(
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", () =>
        HttpResponse.json({
          object: "list",
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "page",
              id: "shamus-page-id",
              last_edited_time: "2026-08-25T20:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "Shamus Li" }] },
                Email: { email: "wl757@cornell.edu" },
                Affiliation: { select: { name: "Graduate/Professional Student" } },
                "Member ID": { rich_text: [{ plain_text: SHAMUS_MEMBER_ID }] },
              },
            },
          ],
        }),
      ),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({ range: "Check-ins!A2:E", values: [] }),
      ),
      http.post(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        async ({ request }) => {
          written = await request.json()
          return HttpResponse.json({ updates: { updatedRows: 1 } })
        },
      ),
    )

    const response = await handleCheckin(
      checkinRequest({
        memberId: null,
        name: "Shamus Li",
        email: "wl757@cornell.edu",
        affiliation: "Graduate/Professional Student",
      }),
      env,
      async () => "test-access-token",
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(201)
    expect(written).toMatchObject({
      values: [
        [
          timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
          "Shamus Li",
          "wl757@cornell.edu",
          "Graduate/Professional Student",
          SHAMUS_MEMBER_ID,
        ],
      ],
    })
  })

  it("allows an empty name while requiring a valid email", async () => {
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    let written: unknown
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({ range: "Check-ins!A2:E", values: [] }),
      ),
      http.post(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        async ({ request }) => {
          written = await request.json()
          return HttpResponse.json({ updates: { updatedRows: 1 } })
        },
      ),
    )

    const response = await handleCheckin(
      checkinRequest({ name: "" }),
      env,
      async () => "test-access-token",
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(201)
    expect(written).toMatchObject({
      values: [
        [
          timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
          "",
          "ada@example.com",
          "Community Member",
          ADA_MEMBER_ID,
        ],
      ],
    })

    const missingEmail = await handleCheckin(
      checkinRequest({ name: "Ada Lovelace", email: "" }),
      env,
      async () => "test-access-token",
      TEST_TIMESTAMP,
    )
    expect(missingEmail.status).toBe(400)
    expect(await missingEmail.json()).toEqual({ message: "Enter a valid email and affiliation" })
  })

  it("rejects a duplicate member ID on the same inferred date", async () => {
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "Ada Lovelace",
              "ada@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
          ],
        }),
      ),
    )

    const response = await handleCheckin(checkinRequest(), env, async () => "test-access-token", TEST_TIMESTAMP)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ message: "Already checked in" })
  })

  it("rejects a client-supplied member ID that is not in the roster", async () => {
    await cacheMembers({
      id: ADA_MEMBER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      affiliation: "Community Member",
    })
    let sheetReads = 0
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        sheetReads += 1
        return HttpResponse.json({ values: [] })
      }),
    )

    const response = await handleCheckin(
      checkinRequest({ memberId: MISSING_MEMBER_ID }),
      env,
      async () => "test-access-token",
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: "That member record is no longer available. Select “Not you?” and choose again.",
    })
    expect(sheetReads).toBe(0)
  })

  it("allows two members with the same email to check in separately", async () => {
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
    let written: unknown
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "Ada Lovelace",
              "shared@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
          ],
        }),
      ),
      http.post(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        async ({ request }) => {
          written = await request.json()
          return HttpResponse.json({ updates: { updatedRows: 1 } })
        },
      ),
    )

    const response = await handleCheckin(
      checkinRequest({
        memberId: GRACE_MEMBER_ID,
        name: "Grace Hopper",
        email: "shared@example.com",
      }),
      env,
      async () => "test-access-token",
      TEST_TIMESTAMP,
    )

    expect(response.status).toBe(201)
    expect(written).toMatchObject({
      values: [
        [
          timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
          "Grace Hopper",
          "shared@example.com",
          "Community Member",
          GRACE_MEMBER_ID,
        ],
      ],
    })
  })
})

describe("nightly sync", () => {
  it("still completes when sorting fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    network.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({ values: [] }),
      ),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", () =>
        HttpResponse.json({ object: "list", has_more: false, next_cursor: null, results: [] }),
      ),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId", () =>
        HttpResponse.json({ sheets: [{ properties: { sheetId: 123, title: "Check-ins" } }] }),
      ),
      http.post(/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+:batchUpdate/, () =>
        new HttpResponse(null, { status: 403 }),
      ),
    )

    try {
      await expect(runNightlySync(env, async () => "test-access-token")).resolves.toEqual({
        synced: 0,
        failed: 0,
      })
      expect(consoleError).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
    }
  })

  it("creates one dated event and relates every check-in from that date", async () => {
    const createdEvents: unknown[] = []
    const createdMembers: unknown[] = []
    let eventQueries = 0
    network.use(
      ...sheetSortHandlers(),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "Ada Lovelace",
              "ada@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
            [
              timestampForSheet(TEST_TIMESTAMP + 60_000, "America/New_York"),
              "Grace Hopper",
              "grace@example.com",
              "Alumni",
              GRACE_MEMBER_ID,
            ],
          ],
        }),
      ),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({ updatedRows: 1 }),
      ),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", ({ params }) => {
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          eventQueries += 1
          return HttpResponse.json({ object: "list", has_more: false, next_cursor: null, results: [] })
        }
        return HttpResponse.json({ object: "list", has_more: false, next_cursor: null, results: [] })
      }),
      http.post("https://api.notion.com/v1/pages", async ({ request }) => {
        const body = await request.json()
        const parent = isRecord(body) && isRecord(body.parent) ? body.parent : null
        if (parent?.data_source_id === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          createdEvents.push(body)
          return HttpResponse.json({ object: "page", id: "dated-event-id", properties: {} })
        }
        createdMembers.push(body)
        return HttpResponse.json({ object: "page", id: "new-member-id", properties: {} })
      }),
    )

    const result = await runNightlySync(env, async () => "test-access-token")

    expect(result).toEqual({ synced: 2, failed: 0 })
    expect(eventQueries).toBe(1)
    expect(createdEvents).toEqual([
      {
        parent: { type: "data_source_id", data_source_id: env.NOTION_EVENTS_DATA_SOURCE_ID },
        properties: {
          Name: { title: [{ type: "text", text: { content: "2026-08-25" } }] },
          Date: { date: { start: "2026-08-25" } },
        },
      },
    ])
    expect(createdMembers).toHaveLength(2)
    for (const [index, member] of createdMembers.entries()) {
      expect(member).toMatchObject({
        properties: {
          "Member ID": {
            rich_text: [{ type: "text", text: { content: index === 0 ? ADA_MEMBER_ID : GRACE_MEMBER_ID } }],
          },
          "Events Attended": { relation: [{ id: "dated-event-id" }] },
        },
      })
    }
  })

  it("creates an unknown Notion member and relates the event without a Sheet sync flag", async () => {
    const sheetUpdates: string[] = []
    let createdPage: unknown
    network.use(
      ...sheetSortHandlers(),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "",
              "ada@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
          ],
        }),
      ),
      http.put(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        ({ params }) => {
          sheetUpdates.push(String(params.range))
          return HttpResponse.json({ updatedRows: 1 })
        },
      ),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", ({ params }) => {
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          return HttpResponse.json({
            object: "list",
            has_more: false,
            next_cursor: null,
            results: [{ object: "page", id: "event-page-id", properties: {} }],
          })
        }
        return HttpResponse.json({ object: "list", has_more: false, next_cursor: null, results: [] })
      }),
      http.post("https://api.notion.com/v1/pages", async ({ request }) => {
        createdPage = await request.json()
        return HttpResponse.json({ object: "page", id: "new-member-page-id", properties: {} })
      }),
    )

    const result = await runNightlySync(env, async () => "test-access-token")

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(createdPage).toMatchObject({
      parent: { type: "data_source_id", data_source_id: env.NOTION_MEMBERS_DATA_SOURCE_ID },
      properties: {
        Name: { title: [] },
        Email: { email: "ada@example.com" },
        "Member ID": {
          rich_text: [{ type: "text", text: { content: ADA_MEMBER_ID } }],
        },
        Affiliation: { select: { name: "Community Member" } },
        "Member Since": { date: { start: "2026-08-25" } },
        "Events Attended": { relation: [{ id: "event-page-id" }] },
      },
    })
    expect(sheetUpdates).toEqual([])
  })

  it("clears email-as-name placeholders from Notion and the Sheet", async () => {
    let updatedPage: unknown
    let sheetWrite: { range: string; body: unknown } | null = null
    network.use(
      ...sheetSortHandlers(),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "ada@example.com",
              "ada@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
          ],
        }),
      ),
      http.put(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        async ({ params, request }) => {
          sheetWrite = { range: String(params.range), body: await request.json() }
          return HttpResponse.json({ updatedRows: 1 })
        },
      ),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", ({ params }) => {
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          return HttpResponse.json({
            object: "list",
            has_more: false,
            next_cursor: null,
            results: [{ object: "page", id: "event-page-id", properties: {} }],
          })
        }
        return HttpResponse.json({
          object: "list",
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "page",
              id: "existing-member-id",
              last_edited_time: "2026-08-26T00:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "ada@example.com" }] },
                Email: { email: "ada@example.com" },
                Affiliation: { select: { name: "Community Member" } },
                "Member ID": { rich_text: [{ plain_text: ADA_MEMBER_ID }] },
                "Events Attended": {
                  id: "relation-property-id",
                  type: "relation",
                  relation: [{ id: "event-page-id" }],
                  has_more: false,
                },
              },
            },
          ],
        })
      }),
      http.patch("https://api.notion.com/v1/pages/:pageId", async ({ request }) => {
        updatedPage = await request.json()
        return HttpResponse.json({ object: "page", id: "existing-member-id", properties: {} })
      }),
    )

    const result = await runNightlySync(env, async () => "test-access-token")

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(updatedPage).toEqual({
      properties: {
        Name: { title: [] },
        Email: { email: "ada@example.com" },
        Affiliation: { select: { name: "Community Member" } },
      },
    })
    expect(sheetWrite).toEqual({
      range: "'Check-ins'!B2:D2",
      body: {
        majorDimension: "ROWS",
        values: [["", "ada@example.com", "Community Member"]],
      },
    })
  })

  it("uses newer Sheet details while preserving existing event relations", async () => {
    let updatedPage: unknown
    network.use(
      ...sheetSortHandlers(),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "Ada Lovelace",
              "new@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
          ],
        }),
      ),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({ updatedRows: 1 }),
      ),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", async ({ params, request }) => {
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          return HttpResponse.json({
            object: "list",
            has_more: false,
            next_cursor: null,
            results: [{ object: "page", id: "new-event-id", properties: {} }],
          })
        }
        const body = await request.json()
        if (isRecord(body) && "filter" in body) {
          expect(body.filter).toEqual({
            property: "Member ID",
            rich_text: { equals: ADA_MEMBER_ID },
          })
        }
        return HttpResponse.json({
          object: "list",
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "page",
              id: "existing-member-id",
              last_edited_time: "2026-08-25T18:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "Old Name" }] },
                Email: { email: "ada@example.com" },
                Affiliation: { select: { name: "Alumni" } },
                "Member ID": { rich_text: [{ plain_text: ADA_MEMBER_ID }] },
                "Events Attended": {
                  id: "relation-property-id",
                  type: "relation",
                  relation: [{ id: "old-event-id" }],
                  has_more: false,
                },
              },
            },
          ],
        })
      }),
      http.patch("https://api.notion.com/v1/pages/:pageId", async ({ request }) => {
        updatedPage = await request.json()
        return HttpResponse.json({ object: "page", id: "existing-member-id", properties: {} })
      }),
    )

    const result = await runNightlySync(env, async () => "test-access-token")

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(updatedPage).toEqual({
      properties: {
        Name: { title: [{ type: "text", text: { content: "Ada Lovelace" } }] },
        Email: { email: "new@example.com" },
        Affiliation: { select: { name: "Community Member" } },
        "Events Attended": { relation: [{ id: "old-event-id" }, { id: "new-event-id" }] },
      },
    })
  })

  it("migrates a legacy email-only row using newer Notion details", async () => {
    let updatedPage: unknown
    const sheetWrites: { range: string; body: unknown }[] = []
    network.use(
      ...sheetSortHandlers(),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "Old Name",
              "ada@example.com",
              "Community Member",
            ],
          ],
        }),
      ),
      http.put(
        "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range",
        async ({ params, request }) => {
          sheetWrites.push({ range: String(params.range), body: await request.json() })
          return HttpResponse.json({ updatedRows: 1 })
        },
      ),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", ({ params }) => {
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          return HttpResponse.json({
            object: "list",
            has_more: false,
            next_cursor: null,
            results: [{ object: "page", id: "new-event-id", properties: {} }],
          })
        }
        return HttpResponse.json({
          object: "list",
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "page",
              id: "existing-member-id",
              last_edited_time: "2026-08-26T00:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "Ada Lovelace" }] },
                Email: { email: "ada@example.com" },
                Affiliation: { select: { name: "Graduate/Professional Student" } },
                "Member ID": { rich_text: [{ plain_text: ADA_MEMBER_ID }] },
                "Events Attended": {
                  id: "relation-property-id",
                  type: "relation",
                  relation: [],
                  has_more: false,
                },
              },
            },
          ],
        })
      }),
      http.patch("https://api.notion.com/v1/pages/:pageId", async ({ request }) => {
        updatedPage = await request.json()
        return HttpResponse.json({ object: "page", id: "existing-member-id", properties: {} })
      }),
    )

    const result = await runNightlySync(env, async () => "test-access-token")

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(updatedPage).toEqual({
      properties: {
        "Events Attended": { relation: [{ id: "new-event-id" }] },
      },
    })
    expect(sheetWrites).toEqual([
      {
        range: "'Check-ins'!B2:D2",
        body: {
          majorDimension: "ROWS",
          values: [
            ["Ada Lovelace", "ada@example.com", "Graduate/Professional Student"],
          ],
        },
      },
      {
        range: "'Check-ins'!E2",
        body: { majorDimension: "ROWS", values: [[ADA_MEMBER_ID]] },
      },
    ])
  })

  it("reprocesses an already-related row without duplicating the relation", async () => {
    let notionUpdates = 0
    let sheetUpdates = 0
    network.use(
      ...sheetSortHandlers(),
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () =>
        HttpResponse.json({
          values: [
            [
              timestampForSheet(TEST_TIMESTAMP, "America/New_York"),
              "Ada Lovelace",
              "ada@example.com",
              "Community Member",
              ADA_MEMBER_ID,
            ],
          ],
        }),
      ),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        sheetUpdates += 1
        return HttpResponse.json({ updatedRows: 1 })
      }),
      http.post("https://api.notion.com/v1/data_sources/:dataSourceId/query", ({ params }) => {
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          return HttpResponse.json({
            object: "list",
            has_more: false,
            next_cursor: null,
            results: [{ object: "page", id: "event-page-id", properties: {} }],
          })
        }
        return HttpResponse.json({
          object: "list",
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "page",
              id: "existing-member-id",
              last_edited_time: "2026-08-25T18:00:00.000Z",
              properties: {
                Name: { title: [{ plain_text: "Ada Lovelace" }] },
                Email: { email: "ada@example.com" },
                Affiliation: { select: { name: "Community Member" } },
                "Member ID": { rich_text: [{ plain_text: ADA_MEMBER_ID }] },
                "Events Attended": {
                  id: "relation-property-id",
                  type: "relation",
                  relation: [{ id: "event-page-id" }],
                  has_more: false,
                },
              },
            },
          ],
        })
      }),
      http.patch("https://api.notion.com/v1/pages/:pageId", () => {
        notionUpdates += 1
        return HttpResponse.json({ object: "page", id: "existing-member-id", properties: {} })
      }),
    )

    const result = await runNightlySync(env, async () => "test-access-token")

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(notionUpdates).toBe(0)
    expect(sheetUpdates).toBe(0)
  })
})

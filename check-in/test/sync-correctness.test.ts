import { env } from "cloudflare:workers"
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AttendanceSync, runNightlySync } from "../worker"
import { timestampForSheet } from "../worker/google"
import { ATTENDANCE_SYNC_STATE_KEY, ATTENDANCE_SYNC_STATE_VERSION } from "../worker/sync-state"
import { FakeNotion, FakeSheets } from "./fakes"
import { network } from "./network"

// The Sheet is the source of truth: these cover edits, deletions, and Notion pages officers change by
// hand, and check that every night still syncs without duplicates or exceeding Notion's rate limit.
const token = async () => "test-access-token"
const serial = (iso: string) => timestampForSheet(Date.parse(iso), "America/New_York")
const AUGUST_25 = serial("2026-08-25T23:00:00Z")
const SEPTEMBER_1 = serial("2026-09-01T23:00:00Z")
const MINUTE = 1 / (24 * 60)

beforeEach(async () => {
  for (const id of await listDurableObjectIds(env.ATTENDANCE_SYNC)) {
    await runInDurableObject(env.ATTENDANCE_SYNC.get(id), async (_instance, state) => {
      await state.storage.deleteAll()
    })
  }
  await env.MEMBER_CACHE.delete("members:v2")
  await env.MEMBER_CACHE.put(ATTENDANCE_SYNC_STATE_KEY, JSON.stringify({
    version: ATTENDANCE_SYNC_STATE_VERSION, fingerprints: [],
  }))
})

function useFakes() {
  const sheets = new FakeSheets()
  const notion = new FakeNotion()
  network.use(...sheets.handlers(), ...notion.handlers())
  return { sheets, notion }
}

const row = (timestamp: number, name: string, email: string, memberId: string, affiliation = "Community Member") =>
  [timestamp, name, email, affiliation, memberId]

async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    return await run()
  } finally {
    consoleError.mockRestore()
  }
}

describe("the Sheet as the source of truth", () => {
  it("removes an attendee whose row is deleted, and clears a night whose rows are all deleted", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push(
      row(AUGUST_25, "Ada Lovelace", "ada@example.com", "Ada_00000001"),
      row(AUGUST_25 + MINUTE, "Grace Hopper", "grace@example.com", "Grace_000001"),
      row(SEPTEMBER_1, "Ada Lovelace", "ada@example.com", "Ada_00000001"),
    )
    expect(await runNightlySync(env, token)).toEqual({ synced: 3, failed: 0 })
    const [august, september] = notion.events
    expect(august.attendees).toHaveLength(2)

    sheets.rows = sheets.rows.filter((cells) => cells[2] !== "grace@example.com" && cells[0] !== SEPTEMBER_1)
    expect(await runNightlySync(env, token)).toEqual({ synced: 0, failed: 0 })
    expect(august.attendees).toEqual([notion.members.find((member) => member.memberId === "Ada_00000001")!.pageId])
    expect(september.attendees).toEqual([])
    expect(notion.members).toHaveLength(2)
  })

  it("keeps a member's newest details when an older night is edited", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push(
      row(AUGUST_25, "Ada Byron", "ada@example.com", "Ada_00000001"),
      row(SEPTEMBER_1, "Ada Lovelace", "ada@example.com", "Ada_00000001"),
    )
    await runNightlySync(env, token)
    const august = sheets.rows.find((cells) => cells[0] === AUGUST_25)!
    august[3] = "Alumni"

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members).toHaveLength(1)
    expect(notion.members[0]).toMatchObject({ name: "Ada Lovelace", affiliation: "Community Member" })
    // The edited row keeps its own values.
    expect(august.slice(1, 4)).toEqual(["Ada Byron", "ada@example.com", "Alumni"])
  })

  it("does not write to a row that moved while the sync ran, and fixes it on the next run", async () => {
    const { sheets } = useFakes()
    sheets.rows.push(
      row(AUGUST_25, "Ada Lovelace", "ada@example.com", ""),
      row(AUGUST_25 + MINUTE, "Grace Hopper", "grace@example.com", "Grace_000001"),
    )
    sheets.beforeRowRead = () => sheets.rows.reverse()

    await quietly(() => expect(runNightlySync(env, token)).rejects.toThrow("1 failed"))
    expect(sheets.rows.map((cells) => cells[4])).toEqual(["Grace_000001", ""])

    expect(await runNightlySync(env, token)).toEqual({ synced: 2, failed: 0 })
    expect(sheets.rows.find((cells) => cells[2] === "ada@example.com")![4]).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })
})

describe("Notion pages changed by hand", () => {
  it("gives a hand-added member a Member ID and links their check-in instead of duplicating them", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({ memberId: "", name: "Ada Lovelace", email: "ada@example.com", affiliation: "Community Member" })
    sheets.rows.push(row(AUGUST_25, "Ada Lovelace", "ada@example.com", ""))

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.members).toHaveLength(1)
    expect(notion.members[0].memberId).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(sheets.rows[0][4]).toBe(notion.members[0].memberId)
    expect(notion.events[0].attendees).toEqual([notion.members[0].pageId])
  })

  it("fails only the rows that use a Member ID shared by two Notion pages", async () => {
    const { sheets, notion } = useFakes()
    notion.addMember({ memberId: "Ada_00000001", name: "Ada Lovelace", email: "ada@example.com" })
    notion.addMember({ memberId: "Ada_00000001", name: "Ada Copy", email: "ada.copy@example.com" })
    sheets.rows.push(
      row(AUGUST_25, "Ada Lovelace", "ada@example.com", "Ada_00000001"),
      row(AUGUST_25 + MINUTE, "Grace Hopper", "grace@example.com", "Grace_000001"),
    )

    await quietly(() => expect(runNightlySync(env, token)).rejects.toThrow("1 synced, 1 failed"))
    expect(notion.events[0].attendees).toEqual([notion.members.find((member) => member.memberId === "Grace_000001")!.pageId])
    expect(notion.members).toHaveLength(3)
  })

  it("syncs a night with more than 100 attendees", async () => {
    const { sheets, notion } = useFakes()
    for (let index = 0; index < 120; index += 1) {
      const id = `Dancer${String(index).padStart(6, "0")}`
      notion.addMember({ memberId: id, name: `Dancer ${index}`, email: `dancer${index}@example.com`, affiliation: "Community Member" })
      sheets.rows.push(row(AUGUST_25 + index * MINUTE / 10, `Dancer ${index}`, `dancer${index}@example.com`, id))
    }

    expect(await runNightlySync(env, token)).toEqual({ synced: 120, failed: 0 })
    expect(new Set(notion.events[0].attendees).size).toBe(120)
    expect(await runNightlySync(env, token)).toEqual({ synced: 0, failed: 0 })
  })
})

describe("failures and rate limits", () => {
  it("keeps a night's attendance while a row fails temporarily, then syncs it on the next run", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows.push(row(AUGUST_25, "Ada Lovelace", "ada@example.com", "Ada_00000001"))
    await runNightlySync(env, token)
    const ada = notion.members[0].pageId

    sheets.rows.push(row(AUGUST_25 + MINUTE, "Grace Hopper", "grace@example.com", "Grace_000001"))
    notion.createFailure = { kind: "member", committed: false }
    await quietly(() => expect(runNightlySync(env, token)).rejects.toThrow("0 synced, 1 failed"))
    expect(notion.events[0].attendees).toEqual([ada])

    // An unresolved create waits for Notion's queries to catch up before trying again.
    await runInDurableObject(env.ATTENDANCE_SYNC.getByName("nightly"), async (_instance, state) => {
      await state.storage.put("notion-creation:member:Grace_000001", Date.now() - 2 * 60 * 60 * 1000)
    })
    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.events[0].attendees).toHaveLength(2)
    expect(notion.members).toHaveLength(2)
  })

  it("paces Notion requests to the configured rate and waits out a rate limit", async () => {
    const { notion } = useFakes()
    for (let index = 0; index < 4000; index += 1) {
      notion.addMember({ memberId: `Filler${String(index).padStart(6, "0")}`, name: `Filler ${index}`, email: `filler${index}@example.com` })
    }
    notion.rateLimitNext = 1
    const rate = 20

    await runInDurableObject(env.ATTENDANCE_SYNC.getByName("nightly"), async (_instance, state) => {
      const sync = new AttendanceSync(state, { ...env, NOTION_REQUESTS_PER_SECOND: String(rate) } as Env)
      expect(await sync.run("test-access-token")).toEqual({ synced: 0, failed: 0 })
    })

    // 40 roster pages plus one retry after the rate limit's one-second Retry-After.
    const times = notion.requestTimes
    expect(times).toHaveLength(41)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000)
    for (const [index, time] of times.entries()) {
      const inWindow = times.filter((other) => other >= time && other < time + 1000).length
      expect(inWindow, `requests in the second after request ${index}`).toBeLessThanOrEqual(10 + rate)
    }
  }, 15_000)
})

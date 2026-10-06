import { env } from "cloudflare:workers"
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"

import { AttendanceSync, runNightlySync } from "../worker"
import { timestampForSheet } from "../worker/google"
import { ATTENDANCE_SYNC_STATE_KEY, ATTENDANCE_SYNC_STATE_VERSION } from "../worker/sync-state"
import { FakeNotion, FakeSheets } from "./fakes"
import { network } from "./network"

const MEMBER_ID = "Ada_00000001"
const token = async () => "test-access-token"
const timestamp = timestampForSheet(Date.parse("2026-08-25T23:00:00Z"), "America/New_York")

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
  sheets.rows.push([timestamp, "Ada Lovelace", "ada@example.com", "Community Member", MEMBER_ID])
  network.use(...sheets.handlers(), ...notion.handlers())
  return { sheets, notion }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe("attendance sync creation safety", () => {
  for (const kind of ["member", "event"] as const) {
    for (const networkFailure of [false, true]) {
      it(`reconciles a committed ${kind} after ${networkFailure ? "a lost response" : "a 503"}`, async () => {
        const { notion } = useFakes()
        notion.createFailure = { kind, committed: true, network: networkFailure }

        expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })

        expect(notion.memberCreates).toBe(1)
        expect(notion.eventCreates).toBe(1)
        expect(notion.members).toHaveLength(1)
        expect(notion.events).toHaveLength(1)
        expect(notion.members[0].events).toEqual([notion.events[0].pageId])
        expect(notion.events[0].attendees).toEqual([notion.members[0].pageId])
      })
    }

    it(`holds an unresolved ${kind} creation for an hour, then creates it once`, async () => {
      const { sheets, notion } = useFakes()
      // A second check-in seconds later on the same day.
      sheets.rows.push([timestamp + 0.0001, "Ada Lovelace", "ada@example.com", "Community Member", MEMBER_ID])
      notion.createFailure = { kind, committed: false }
      const creates = () => kind === "member" ? notion.memberCreates : notion.eventCreates
      const checkpoint = await env.MEMBER_CACHE.get(ATTENDANCE_SYNC_STATE_KEY)

      await expect(runNightlySync(env, token)).rejects.toThrow("0 synced, 2 failed")
      expect(creates()).toBe(1)
      await expect(runNightlySync(env, token)).rejects.toThrow("0 synced, 2 failed")
      expect(creates()).toBe(1)
      expect(await env.MEMBER_CACHE.get(ATTENDANCE_SYNC_STATE_KEY)).toBe(checkpoint)

      // Once queries have caught up, a page that is still missing was never created.
      const key = `notion-creation:${kind === "member" ? `member:${MEMBER_ID}` : "event:2026-08-25"}`
      await runInDurableObject(env.ATTENDANCE_SYNC.getByName("nightly"), async (_instance, state) => {
        await state.storage.put(key, Date.now() - 2 * 60 * 60 * 1000)
      })
      expect(await runNightlySync(env, token)).toEqual({ synced: 2, failed: 0 })
      expect(creates()).toBe(2)
      expect(notion.members).toHaveLength(1)
      expect(notion.events).toHaveLength(1)
    })
  }

  it("shares an active run between concurrent callers", async () => {
    const { sheets, notion } = useFakes()
    const entered = deferred()
    const release = deferred()
    notion.beforeCreate = async () => {
      entered.resolve()
      await release.promise
    }

    const first = runNightlySync(env, token)
    await entered.promise
    const second = runInDurableObject(env.ATTENDANCE_SYNC.getByName("nightly"), (instance) => {
      const concurrent = instance.run("test-access-token")
      release.resolve()
      return concurrent
    })
    const results = await Promise.all([first, second])

    expect(results).toEqual([{ synced: 1, failed: 0 }, { synced: 1, failed: 0 }])
    expect(sheets.reads).toBe(2) // one run: the check-ins and the waiver log
    expect(notion.memberCreates).toBe(1)
    expect(notion.eventCreates).toBe(1)
  })

  it("releases a failed run so a later run can succeed", async () => {
    const { sheets, notion } = useFakes()
    sheets.failSort = true
    await expect(runNightlySync(env, token)).rejects.toThrow("403")

    sheets.failSort = false
    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.memberCreates).toBe(1)
    expect(notion.eventCreates).toBe(1)
    expect(sheets.sorts).toBe(1)
  })

  it("retains a generated ID across coordinator restart, failed Sheet write, and stale Notion queries", async () => {
    const { sheets, notion } = useFakes()
    sheets.rows[0][4] = ""
    sheets.failUpdates = true
    await expect(runNightlySync(env, token)).rejects.toThrow("1 failed")
    const createdId = notion.members[0].memberId
    expect(sheets.rows[0][4]).toBe("")

    sheets.failUpdates = false
    notion.hideMembers = true
    await runInDurableObject(env.ATTENDANCE_SYNC.getByName("nightly"), async (_instance, state) => {
      // A fresh coordinator has no in-memory state, only the persisted page IDs, which it reads directly.
      const restarted = new AttendanceSync(state, env)
      expect(await restarted.run("test-access-token")).toEqual({ synced: 1, failed: 0 })
    })
    expect(sheets.rows[0][4]).toBe(createdId)
    expect(notion.memberCreates).toBe(1)
  })

  it("recreates a member whose Notion page was deleted after the sync created it", async () => {
    const { sheets, notion } = useFakes()
    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    notion.members = []
    sheets.rows.push([timestamp + 0.0001, "Ada Lovelace", "ada@example.com", "Community Member", MEMBER_ID])

    expect(await runNightlySync(env, token)).toEqual({ synced: 1, failed: 0 })
    expect(notion.memberCreates).toBe(2)
    expect(notion.members).toHaveLength(1)
  })
})

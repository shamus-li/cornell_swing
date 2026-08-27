import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"

import { searchCachedMembers } from "../worker/cache"

beforeEach(async () => {
  await env.MEMBER_CACHE.delete("members:v2")
})

describe("interactive member search", () => {
  it("serves the cached roster immediately even when its refresh time is old", async () => {
    await env.MEMBER_CACHE.put(
      "members:v2",
      JSON.stringify({
        refreshedAt: Date.now() - 24 * 60 * 60 * 1000,
        members: [
          {
            id: "Stale_000001",
            name: "Stale Sam",
            email: "sam@example.com",
            affiliation: "Staff",
          },
        ],
      }),
    )

    const results = await searchCachedMembers(env, "sam", { allowStale: true })

    expect(results.map((member) => member.id)).toEqual(["Stale_000001"])
  })
})

import { isAffiliation, type Member } from "../src/lib/checkin"
import { searchMembers, type CheckinStats } from "../src/lib/member-search"
import { listMembers } from "./notion"
import { isRecord } from "./util"

const MEMBER_CACHE_KEY = "members:v2"
const CHECKIN_STATS_KEY = "checkin-stats:v1"

type MemberSnapshot = {
  members: Member[]
}

function isMember(value: unknown): value is Member {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    typeof value.phone === "string" &&
    (value.affiliation === "" || isAffiliation(value.affiliation))
  )
}

function isMemberSnapshot(value: unknown): value is MemberSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.members) &&
    value.members.every(isMember)
  )
}

export async function refreshMemberCache(env: Env): Promise<MemberSnapshot> {
  return storeMemberCache(env, await listMembers(env))
}

export async function storeMemberCache(env: Env, members: Member[]): Promise<MemberSnapshot> {
  const snapshot = { members }
  await env.MEMBER_CACHE.put(MEMBER_CACHE_KEY, JSON.stringify(snapshot))
  return snapshot
}

async function currentMemberSnapshot(env: Env): Promise<MemberSnapshot> {
  const cached: unknown = await env.MEMBER_CACHE.get(MEMBER_CACHE_KEY, "json")
  return isMemberSnapshot(cached) ? cached : refreshMemberCache(env)
}

function isCheckinStats(value: unknown): value is CheckinStats {
  return isRecord(value) && Object.values(value).every((entry) =>
    isRecord(entry) && typeof entry.nights === "number" && typeof entry.last === "string",
  )
}

// Only the nightly sync writes the stats, so rebuilding the member list never clears them. They are
// empty until the first sync after they are introduced.
export async function storeCheckinStats(env: Env, stats: CheckinStats): Promise<void> {
  await env.MEMBER_CACHE.put(CHECKIN_STATS_KEY, JSON.stringify(stats))
}

export async function searchCachedMembers(
  env: Env,
  query: string,
): Promise<Member[]> {
  const [snapshot, stats] = await Promise.all([
    currentMemberSnapshot(env),
    env.MEMBER_CACHE.get(CHECKIN_STATS_KEY, "json"),
  ])
  return searchMembers(snapshot.members, query, isCheckinStats(stats) ? stats : {})
}

export async function cachedMembers(env: Env): Promise<Member[]> {
  return (await currentMemberSnapshot(env)).members
}

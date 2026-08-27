import { isAffiliation, type Member } from "../src/lib/checkin"
import { listMembers } from "./notion"

const MEMBER_CACHE_KEY = "members:v2"
const MEMBER_CACHE_MAX_AGE_MS = 15 * 60 * 1000

type MemberSnapshot = {
  refreshedAt: number
  members: Member[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMember(value: unknown): value is Member {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.email === "string" &&
    (value.affiliation === "" || isAffiliation(value.affiliation))
  )
}

function isMemberSnapshot(value: unknown): value is MemberSnapshot {
  return (
    isRecord(value) &&
    typeof value.refreshedAt === "number" &&
    Number.isFinite(value.refreshedAt) &&
    Array.isArray(value.members) &&
    value.members.every(isMember)
  )
}

export async function refreshMemberCache(env: Env, refreshedAt = Date.now()): Promise<MemberSnapshot> {
  const snapshot = { refreshedAt, members: await listMembers(env) }
  await env.MEMBER_CACHE.put(MEMBER_CACHE_KEY, JSON.stringify(snapshot))
  return snapshot
}

async function currentMemberSnapshot(env: Env): Promise<MemberSnapshot> {
  const cached: unknown = await env.MEMBER_CACHE.get(MEMBER_CACHE_KEY, "json")
  if (isMemberSnapshot(cached) && Date.now() - cached.refreshedAt < MEMBER_CACHE_MAX_AGE_MS) {
    return cached
  }
  return refreshMemberCache(env)
}

export async function searchCachedMembers(env: Env, query: string): Promise<Member[]> {
  const normalizedQuery = query.toLocaleLowerCase()
  const snapshot = await currentMemberSnapshot(env)
  return snapshot.members
    .filter(
      (member) =>
        member.name.toLocaleLowerCase().includes(normalizedQuery) || member.email.includes(normalizedQuery),
    )
    .slice(0, 8)
}

export async function findCachedMemberById(env: Env, memberId: string): Promise<Member | null> {
  const snapshot = await currentMemberSnapshot(env)
  return snapshot.members.find((member) => member.id === memberId) ?? null
}

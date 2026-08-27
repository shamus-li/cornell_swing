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
  const normalizedQuery = normalizeSearchValue(query)
  const snapshot = await currentMemberSnapshot(env)
  return snapshot.members
    .map((member) => ({ member, score: memberSearchScore(member, normalizedQuery) }))
    .filter((result): result is { member: Member; score: number } => result.score !== null)
    .sort((left, right) => left.score - right.score || left.member.name.localeCompare(right.member.name))
    .slice(0, 8)
    .map(({ member }) => member)
}

function normalizeSearchValue(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
}

function memberSearchScore(member: Member, query: string): number | null {
  const name = normalizeSearchValue(member.name)
  const email = normalizeSearchValue(member.email)
  if (name === query || email === query) return 0
  if (email.startsWith(query)) return 1
  if (name.startsWith(query)) return 2
  if (name.split(/\s+/).some((part) => part.startsWith(query))) return 3
  if (name.includes(query) || email.includes(query)) return 4
  return null
}

export async function findCachedMemberById(env: Env, memberId: string): Promise<Member | null> {
  const snapshot = await currentMemberSnapshot(env)
  return snapshot.members.find((member) => member.id === memberId) ?? null
}

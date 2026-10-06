import Fuse from "fuse.js"

import { isAffiliation, type Member } from "../src/lib/checkin"
import { listMembers } from "./notion"
import { isRecord } from "./util"

const MEMBER_CACHE_KEY = "members:v2"

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

// Typo-tolerant name search; people type their name first, so emails aren't searched.
export async function searchCachedMembers(
  env: Env,
  query: string,
): Promise<Member[]> {
  const snapshot = await currentMemberSnapshot(env)
  return new Fuse(snapshot.members, { keys: ["name"], threshold: 0.3, ignoreDiacritics: true })
    .search(query, { limit: 8 })
    .map(({ item }) => item)
}

export async function cachedMembers(env: Env): Promise<Member[]> {
  return (await currentMemberSnapshot(env)).members
}

export async function findCachedMemberById(
  env: Env,
  memberId: string,
): Promise<Member | null> {
  const snapshot = await currentMemberSnapshot(env)
  return snapshot.members.find((member) => member.id === memberId) ?? null
}

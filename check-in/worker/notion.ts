import { isAffiliation, type Affiliation, type Member } from "../src/lib/checkin"
import { createMemberId } from "./member-id"

const NOTION_API = "https://api.notion.com/v1"
const NOTION_VERSION = "2026-03-11"
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_RELATION_ITEMS = 100

type NotionPage = {
  id: string
  properties: Record<string, unknown>
}

type QueryResult = {
  pages: NotionPage[]
  nextCursor: string | null
}

export type MemberRecord = Member & { pageId: string }

export type MemberRoster = {
  records: MemberRecord[]
  byId: Map<string, MemberRecord>
  byEmail: Map<string, MemberRecord[]>
}

export type AttendanceEvent = {
  id: string
  attendeePageIds: string[]
}

type AttendanceDetails = {
  memberId: string | null
  name: string
  email: string
  affiliation: Affiliation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asPage(value: unknown): NotionPage | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.properties)) return null
  return { id: value.id, properties: value.properties }
}

function property(page: NotionPage, name: string): Record<string, unknown> | null {
  const value = page.properties[name]
  return isRecord(value) ? value : null
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .map((item) => (isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("")
    .trim()
}

function pageToMemberRecord(page: NotionPage): MemberRecord {
  const memberId = plainText(property(page, "Member ID")?.rich_text)
  if (!memberId) throw new Error("Notion member is missing Member ID")
  const emailProperty = property(page, "Email")
  const affiliationProperty = property(page, "Affiliation")
  const select = affiliationProperty && isRecord(affiliationProperty.select) ? affiliationProperty.select : null
  const affiliation = select?.name

  return {
    pageId: page.id,
    id: memberId,
    name: plainText(property(page, "Name")?.title),
    email: typeof emailProperty?.email === "string" ? emailProperty.email.trim().toLowerCase() : "",
    affiliation: isAffiliation(affiliation) ? affiliation : "",
  }
}

function memberFromRecord(record: MemberRecord): Member {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    affiliation: record.affiliation,
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function notionRequest(env: Env, path: string, init: RequestInit): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${NOTION_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...init.headers,
      },
    })

    if (response.ok) return response.json()
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 3) {
      throw new Error(`Notion request failed with ${response.status}`)
    }

    const retryAfter = Number.parseFloat(response.headers.get("Retry-After") ?? "")
    const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 300 * 2 ** attempt
    await wait(Math.min(delay, 10_000))
  }
  throw new Error("Notion request failed")
}

async function queryPages(
  env: Env,
  dataSourceId: string,
  body: Record<string, unknown>,
  filterProperties: string[],
): Promise<QueryResult> {
  const query = new URLSearchParams()
  for (const name of filterProperties) query.append("filter_properties[]", name)
  const payload = await notionRequest(
    env,
    `/data_sources/${encodeURIComponent(dataSourceId)}/query?${query.toString()}`,
    {
      method: "POST",
      body: JSON.stringify({ ...body, result_type: "page" }),
    },
  )
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("Notion returned an invalid query response")
  }
  const nextCursor =
    payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : null
  return {
    pages: payload.results.map(asPage).filter((page): page is NotionPage => page !== null),
    nextCursor,
  }
}

function addEmailIndex(roster: MemberRoster, record: MemberRecord): void {
  if (!record.email) return
  const matches = roster.byEmail.get(record.email) ?? []
  matches.push(record)
  roster.byEmail.set(record.email, matches)
}

function removeEmailIndex(roster: MemberRoster, record: MemberRecord, email: string): void {
  if (!email) return
  const matches = (roster.byEmail.get(email) ?? []).filter((candidate) => candidate !== record)
  if (matches.length > 0) roster.byEmail.set(email, matches)
  else roster.byEmail.delete(email)
}

function addRosterRecord(roster: MemberRoster, record: MemberRecord): void {
  if (roster.byId.has(record.id)) {
    throw new Error(`More than one Notion member has Member ID ${record.id}`)
  }
  roster.records.push(record)
  roster.byId.set(record.id, record)
  addEmailIndex(roster, record)
}

export async function loadMemberRoster(env: Env): Promise<MemberRoster> {
  const pages: NotionPage[] = []
  let startCursor: string | null = null

  do {
    const result = await queryPages(
      env,
      env.NOTION_MEMBERS_DATA_SOURCE_ID,
      {
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      },
      ["Name", "Email", "Affiliation", "Member ID"],
    )
    pages.push(...result.pages)
    startCursor = result.nextCursor
  } while (startCursor)

  const roster: MemberRoster = { records: [], byId: new Map(), byEmail: new Map() }
  for (const page of pages) addRosterRecord(roster, pageToMemberRecord(page))
  return roster
}

export async function listMembers(env: Env): Promise<Member[]> {
  const roster = await loadMemberRoster(env)
  return roster.records
    .filter((record) => record.name || record.email)
    .map(memberFromRecord)
}

function inlineRelation(
  page: NotionPage,
  name: string,
): { propertyId: string; relationIds: string[]; hasMore: boolean } {
  const relationProperty = property(page, name)
  if (!relationProperty || typeof relationProperty.id !== "string" || !Array.isArray(relationProperty.relation)) {
    throw new Error(`Notion page is missing the ${name} relation`)
  }
  return {
    propertyId: relationProperty.id,
    relationIds: relationProperty.relation.flatMap((item) =>
      isRecord(item) && typeof item.id === "string" ? [item.id] : [],
    ),
    hasMore: relationProperty.has_more === true,
  }
}

async function retrieveRelationIds(env: Env, pageId: string, propertyId: string): Promise<string[]> {
  const relationIds: string[] = []
  let cursor: string | null = null
  const encodedPropertyId = encodeURIComponent(decodeURIComponent(propertyId))

  do {
    const query = new URLSearchParams({ page_size: "100" })
    if (cursor) query.set("start_cursor", cursor)
    const payload = await notionRequest(
      env,
      `/pages/${encodeURIComponent(pageId)}/properties/${encodedPropertyId}?${query.toString()}`,
      { method: "GET" },
    )
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error("Notion returned an invalid relation response")
    }
    for (const item of payload.results) {
      if (isRecord(item) && isRecord(item.relation) && typeof item.relation.id === "string") {
        relationIds.push(item.relation.id)
      }
    }
    cursor = payload.has_more === true && typeof payload.next_cursor === "string" ? payload.next_cursor : null
  } while (cursor)

  return relationIds
}

export async function findOrCreateEventForDate(env: Env, date: string): Promise<AttendanceEvent> {
  const result = await queryPages(
    env,
    env.NOTION_EVENTS_DATA_SOURCE_ID,
    {
      page_size: 2,
      filter: { property: "Date", date: { equals: date } },
    },
    ["Name", "Date", "Attendees"],
  )
  if (result.pages.length > 1) {
    throw new Error(`Expected at most one Notion event for ${date}, found ${result.pages.length}`)
  }
  if (result.pages.length === 1) {
    const page = result.pages[0]
    const relation = inlineRelation(page, "Attendees")
    return {
      id: page.id,
      attendeePageIds: relation.hasMore
        ? await retrieveRelationIds(env, page.id, relation.propertyId)
        : relation.relationIds,
    }
  }

  const created = await notionRequest(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: env.NOTION_EVENTS_DATA_SOURCE_ID },
      properties: {
        Name: { title: [{ type: "text", text: { content: date } }] },
        Date: { date: { start: date } },
      },
    }),
  })
  if (!isRecord(created) || typeof created.id !== "string") {
    throw new Error("Notion returned an invalid created event")
  }
  return { id: created.id, attendeePageIds: [] }
}

async function createMember(
  env: Env,
  attendee: { memberId: string; name: string; email: string; affiliation: Affiliation },
  date: string,
  eventId: string,
): Promise<MemberRecord> {
  const created = await notionRequest(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: env.NOTION_MEMBERS_DATA_SOURCE_ID },
      properties: {
        Name: attendee.name
          ? { title: [{ type: "text", text: { content: attendee.name } }] }
          : { title: [] },
        Email: { email: attendee.email },
        "Member ID": {
          rich_text: [{ type: "text", text: { content: attendee.memberId } }],
        },
        Affiliation: { select: { name: attendee.affiliation } },
        "Member Since": { date: { start: date } },
        "Events Attended": { relation: [{ id: eventId }] },
      },
    }),
  })
  if (!isRecord(created) || typeof created.id !== "string") {
    throw new Error("Notion returned an invalid created member")
  }
  return {
    pageId: created.id,
    id: attendee.memberId,
    name: attendee.name,
    email: attendee.email,
    affiliation: attendee.affiliation,
  }
}

async function updateMemberDetails(
  env: Env,
  pageId: string,
  details: { name: string; email: string; affiliation: Affiliation },
): Promise<void> {
  await notionRequest(env, `/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        Name: details.name
          ? { title: [{ type: "text", text: { content: details.name } }] }
          : { title: [] },
        Email: { email: details.email },
        Affiliation: { select: { name: details.affiliation } },
      },
    }),
  })
}

function conflictingEmailRecords(
  roster: MemberRoster,
  email: string,
  expected: MemberRecord | null,
): MemberRecord[] {
  return (roster.byEmail.get(email) ?? []).filter((record) => record !== expected)
}

export async function syncMemberAttendance(
  env: Env,
  roster: MemberRoster,
  attendee: AttendanceDetails,
  date: string,
  eventId: string,
): Promise<MemberRecord> {
  let member: MemberRecord | null = null

  if (attendee.memberId) {
    member = roster.byId.get(attendee.memberId) ?? null
    if (conflictingEmailRecords(roster, attendee.email, member).length > 0) {
      throw new Error("Check-in member ID and email refer to different Notion members")
    }
  } else {
    const matches = roster.byEmail.get(attendee.email) ?? []
    if (matches.length > 1) throw new Error("More than one Notion member has this email")
    member = matches[0] ?? null
  }

  if (!member) {
    const memberId = attendee.memberId ?? createMemberId()
    const created = await createMember(env, { ...attendee, memberId }, date, eventId)
    addRosterRecord(roster, created)
    return created
  }

  const detailsDiffer =
    member.name !== attendee.name ||
    member.email !== attendee.email ||
    member.affiliation !== attendee.affiliation
  if (detailsDiffer) {
    await updateMemberDetails(env, member.pageId, attendee)
    const previousEmail = member.email
    removeEmailIndex(roster, member, previousEmail)
    member.name = attendee.name
    member.email = attendee.email
    member.affiliation = attendee.affiliation
    addEmailIndex(roster, member)
  }
  return member
}

export async function syncEventAttendance(
  env: Env,
  event: AttendanceEvent,
  attendeePageIds: Iterable<string>,
): Promise<void> {
  const relationIds = [...new Set(attendeePageIds)]
  const existingIds = new Set(event.attendeePageIds)
  if (relationIds.length === existingIds.size && relationIds.every((id) => existingIds.has(id))) return
  if (relationIds.length > MAX_RELATION_ITEMS) {
    throw new Error(`Notion event attendance exceeds the ${MAX_RELATION_ITEMS}-member relation limit`)
  }

  await notionRequest(env, `/pages/${encodeURIComponent(event.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        Attendees: { relation: relationIds.map((id) => ({ id })) },
      },
    }),
  })
  event.attendeePageIds = relationIds
}

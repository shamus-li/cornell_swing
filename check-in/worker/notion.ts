import { isAffiliation, type Affiliation, type Member } from "../src/lib/checkin"
import { timestampForSheet } from "./google"
import { createMemberId } from "./member-id"

const NOTION_API = "https://api.notion.com/v1"
const NOTION_VERSION = "2026-03-11"
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

type NotionPage = {
  id: string
  lastEditedTime: string | null
  properties: Record<string, unknown>
}

type QueryResult = {
  pages: NotionPage[]
  nextCursor: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asPage(value: unknown): NotionPage | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.properties)) return null
  return {
    id: value.id,
    lastEditedTime: typeof value.last_edited_time === "string" ? value.last_edited_time : null,
    properties: value.properties,
  }
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

function pageToMember(page: NotionPage): Member {
  const memberId = plainText(property(page, "Member ID")?.rich_text)
  if (!memberId) throw new Error("Notion member is missing Member ID")
  const emailProperty = property(page, "Email")
  const affiliationProperty = property(page, "Affiliation")
  const select = affiliationProperty && isRecord(affiliationProperty.select) ? affiliationProperty.select : null
  const affiliation = select?.name

  return {
    id: memberId,
    name: plainText(property(page, "Name")?.title),
    email: typeof emailProperty?.email === "string" ? emailProperty.email.trim().toLowerCase() : "",
    affiliation: isAffiliation(affiliation) ? affiliation : "",
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

export async function listMembers(env: Env): Promise<Member[]> {
  const members: Member[] = []
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
    members.push(...result.pages.map(pageToMember).filter((member) => member.name || member.email))
    startCursor = result.nextCursor
  } while (startCursor)

  return members
}

async function findMemberById(env: Env, memberId: string): Promise<NotionPage | null> {
  const pages = await queryPages(
    env,
    env.NOTION_MEMBERS_DATA_SOURCE_ID,
    {
      page_size: 2,
      filter: { property: "Member ID", rich_text: { equals: memberId } },
    },
    ["Name", "Email", "Affiliation", "Member ID", "Events Attended"],
  )
  if (pages.pages.length > 1) throw new Error("More than one Notion member has this Member ID")
  return pages.pages[0] ?? null
}

async function findMemberByEmail(env: Env, email: string): Promise<NotionPage | null> {
  const pages = await queryPages(
    env,
    env.NOTION_MEMBERS_DATA_SOURCE_ID,
    {
      page_size: 2,
      filter: { property: "Email", email: { equals: email } },
    },
    ["Name", "Email", "Affiliation", "Member ID", "Events Attended"],
  )
  if (pages.pages.length > 1) throw new Error("More than one Notion member has this email")
  return pages.pages[0] ?? null
}

export async function findOrCreateEventForDate(env: Env, date: string): Promise<string> {
  const pages = await queryPages(
    env,
    env.NOTION_EVENTS_DATA_SOURCE_ID,
    {
      page_size: 2,
      filter: { property: "Date", date: { equals: date } },
    },
    ["Name", "Date"],
  )
  if (pages.pages.length > 1) {
    throw new Error(`Expected at most one Notion event for ${date}, found ${pages.pages.length}`)
  }
  if (pages.pages.length === 1) return pages.pages[0].id

  const created: unknown = await notionRequest(env, "/pages", {
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
  return created.id
}

async function createMember(
  env: Env,
  attendee: { memberId: string; name: string; email: string; affiliation: Affiliation },
  date: string,
  eventId: string,
): Promise<void> {
  await notionRequest(env, "/pages", {
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
}

function inlineRelation(page: NotionPage): {
  propertyId: string
  relationIds: string[]
  hasMore: boolean
} {
  const relationProperty = property(page, "Events Attended")
  if (!relationProperty || typeof relationProperty.id !== "string" || !Array.isArray(relationProperty.relation)) {
    throw new Error("Notion member is missing the Events Attended relation")
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

  do {
    const query = new URLSearchParams({ page_size: "100" })
    if (cursor) query.set("start_cursor", cursor)
    const payload = await notionRequest(
      env,
      `/pages/${encodeURIComponent(pageId)}/properties/${encodeURIComponent(propertyId)}?${query.toString()}`,
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

async function updateMember(
  env: Env,
  page: NotionPage,
  eventId: string,
  details: { name: string; email: string; affiliation: Affiliation } | null,
): Promise<void> {
  const relation = inlineRelation(page)
  const relationIds = relation.hasMore
    ? await retrieveRelationIds(env, page.id, relation.propertyId)
    : relation.relationIds
  const properties: Record<string, unknown> = {}

  if (details) {
    properties.Name = details.name
      ? { title: [{ type: "text", text: { content: details.name } }] }
      : { title: [] }
    properties.Affiliation = { select: { name: details.affiliation } }
    properties.Email = { email: details.email }
  }
  if (!relationIds.includes(eventId)) {
    properties["Events Attended"] = { relation: [...relationIds, eventId].map((id) => ({ id })) }
  }
  if (Object.keys(properties).length === 0) return

  await notionRequest(env, `/pages/${encodeURIComponent(page.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  })
}

export async function syncMemberAttendance(
  env: Env,
  attendee: { memberId: string | null; name: string; email: string; affiliation: Affiliation },
  date: string,
  eventId: string,
  sheetTimestamp: number,
): Promise<Member> {
  const member = attendee.memberId
    ? await findMemberById(env, attendee.memberId)
    : await findMemberByEmail(env, attendee.email)
  if (!member) {
    const created = { ...attendee, memberId: attendee.memberId ?? createMemberId() }
    await createMember(env, created, date, eventId)
    return { id: created.memberId, name: created.name, email: created.email, affiliation: created.affiliation }
  }

  const notionMember = pageToMember(member)
  if (attendee.memberId) {
    const canonical = {
      id: notionMember.id,
      name: attendee.name,
      email: attendee.email,
      affiliation: attendee.affiliation,
    }
    const notionDetailsDiffer =
      notionMember.name !== canonical.name ||
      notionMember.email !== canonical.email ||
      notionMember.affiliation !== canonical.affiliation
    await updateMember(env, member, eventId, notionDetailsDiffer ? canonical : null)
    return canonical
  }

  if (!member.lastEditedTime) throw new Error("Notion member is missing last_edited_time")
  const notionEditedAt = Date.parse(member.lastEditedTime)
  if (!Number.isFinite(notionEditedAt)) throw new Error("Notion member has an invalid last_edited_time")

  const notionIsNewer = timestampForSheet(notionEditedAt, env.TIME_ZONE) > sheetTimestamp
  const notionName =
    notionMember.name.toLowerCase() === attendee.email ? "" : notionMember.name
  const name =
    notionName && (!attendee.name || notionIsNewer) ? notionName : attendee.name
  const affiliation =
    notionIsNewer && isAffiliation(notionMember.affiliation)
      ? notionMember.affiliation
      : attendee.affiliation
  const canonical = { id: notionMember.id, name, email: attendee.email, affiliation }
  const notionDetailsDiffer =
    notionMember.name !== name ||
    notionMember.email !== attendee.email ||
    notionMember.affiliation !== affiliation

  await updateMember(
    env,
    member,
    eventId,
    notionDetailsDiffer ? canonical : null,
  )
  return canonical
}

import { isAffiliation, type Affiliation, type Member } from "../src/lib/checkin"
import { createMemberId } from "./member-id"
import { isRecord, RETRYABLE_STATUSES, wait } from "./util"

const NOTION_API = "https://api.notion.com/v1"
const NOTION_VERSION = "2026-03-11"
const MAX_RELATION_ITEMS = 100

type NotionPage = {
  id: string
  properties: Record<string, unknown>
}

type QueryResult = {
  pages: NotionPage[]
  nextCursor: string | null
}

const unresolvedCreation = (identity: string) =>
  new Error(`Notion creation for ${identity} is unresolved; refusing to create another page`)

// A problem with a row's data or the matching Notion pages that needs an officer to fix it. It fails
// only that row; the rest of the night's attendance still syncs.
export class RowProblem extends Error {}

class NotionRequestError extends Error {
  constructor(readonly status: number) {
    super(`Notion request failed with ${status}`)
  }
}

// generalRiskWaiver is the academic year of the member's Cornell General Risk waiver, e.g. "AY 26/27".
type MemberRecord = Member & { pageId: string; generalRiskWaiver: string }

export type MemberRoster = {
  records: MemberRecord[]
  byId: Map<string, MemberRecord>
  byEmail: Map<string, MemberRecord[]>
  duplicateIds: Set<string>
}

type MemberDetails = { name: string; email: string; affiliation: Affiliation; phone: string }

export type AttendanceEvent = {
  id: string
  attendeePageIds: string[]
  waiverPageIds: string[]
}

type AttendanceDetails = {
  memberId: string | null
  name: string
  email: string
  affiliation: Affiliation
  phone: string
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
  const emailProperty = property(page, "Email")
  const phoneProperty = property(page, "Phone")
  const affiliationProperty = property(page, "Affiliation")
  const select = affiliationProperty && isRecord(affiliationProperty.select) ? affiliationProperty.select : null
  const generalRiskProperty = property(page, "General Risk Waiver")
  const generalRisk = generalRiskProperty && isRecord(generalRiskProperty.select) ? generalRiskProperty.select.name : null
  const affiliation = select?.name

  return {
    pageId: page.id,
    id: memberId,
    name: plainText(property(page, "Name")?.title),
    email: typeof emailProperty?.email === "string" ? emailProperty.email.trim().toLowerCase() : "",
    phone: typeof phoneProperty?.phone_number === "string" ? phoneProperty.phone_number.trim() : "",
    affiliation: isAffiliation(affiliation) ? affiliation : "",
    generalRiskWaiver: typeof generalRisk === "string" ? generalRisk : "",
  }
}


// Notion limits each integration to an average request rate (NOTION_REQUESTS_PER_SECOND). Requests
// spend from a small burst allowance that refills at that rate, so a long sync never outpaces it.
const REQUEST_BURST = 10
let requestAllowance = REQUEST_BURST
let allowanceUpdatedAt = 0

async function waitForRequestSlot(env: Env): Promise<void> {
  const rate = Number(env.NOTION_REQUESTS_PER_SECOND)
  const now = Date.now()
  requestAllowance = Math.min(REQUEST_BURST, requestAllowance + ((now - allowanceUpdatedAt) / 1000) * rate)
  allowanceUpdatedAt = now
  if (requestAllowance < 1) {
    await wait(((1 - requestAllowance) / rate) * 1000)
    requestAllowance = 1
    allowanceUpdatedAt = Date.now()
  }
  requestAllowance -= 1
}

async function notionRequest(env: Env, path: string, init: RequestInit): Promise<unknown> {
  // A create that fails may still have committed, so it is retried only after a rate limit,
  // which Notion rejects without processing.
  const isCreate = path === "/pages" && init.method === "POST"
  for (let attempt = 0; ; attempt += 1) {
    await waitForRequestSlot(env)
    let response: Response
    try {
      response = await fetch(`${NOTION_API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
          ...init.headers,
        },
      })
    } catch (error) {
      if (isCreate || attempt === 4) throw error
      await wait(500 * 2 ** attempt)
      continue
    }

    if (response.ok) return response.json()
    const retryable = RETRYABLE_STATUSES.has(response.status) && (response.status === 429 || !isCreate)
    if (!retryable || attempt === 4) throw new NotionRequestError(response.status)

    // Wait as long as Notion asks before sending anything else.
    const retryAfter = Number.parseFloat(response.headers.get("Retry-After") ?? "")
    await wait(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 60_000) : 500 * 2 ** attempt)
  }
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

// Notion creates have no idempotency key, so each created page is recorded in Durable Object storage:
// the time a create started while its outcome is unknown, then the created page's ID.
const CREATION_SETTLE_MS = 60 * 60 * 1000

async function retrievePage(env: Env, pageId: string): Promise<NotionPage | null> {
  try {
    const page = await notionRequest(env, `/pages/${pageId}`, { method: "GET" })
    return isRecord(page) && !page.in_trash && !page.archived ? asPage(page) : null
  } catch (error) {
    if (error instanceof NotionRequestError && error.status === 404) return null
    throw error
  }
}

async function createPageOnce(
  env: Env,
  storage: DurableObjectStorage,
  identity: string,
  lookup: () => Promise<NotionPage | null>,
  body: Record<string, unknown>,
): Promise<{ id: string; recovered: NotionPage | null }> {
  const key = `notion-creation:${identity}`
  const reconcile = async () => {
    let page: NotionPage | null
    try {
      page = await lookup()
    } catch {
      throw unresolvedCreation(identity)
    }
    if (!page) return null
    await storage.put(key, page.id)
    return { id: page.id, recovered: page }
  }

  const marker = await storage.get<string | number>(key)
  if (typeof marker === "string") {
    // Read the page directly; database queries can briefly miss a new page.
    const page = await retrievePage(env, marker)
    if (page) return { id: page.id, recovered: page }
    // Someone deleted the page in Notion, so create it again.
  } else if (typeof marker === "number") {
    const found = await reconcile()
    if (found) return found
    // Queries catch up within minutes; a page still missing after that was never created.
    if (Date.now() - marker < CREATION_SETTLE_MS) throw unresolvedCreation(identity)
  }

  // Persist before sending so a restart cannot repeat an uncertain creation.
  await storage.put(key, Date.now())
  let created: unknown
  try {
    created = await notionRequest(env, "/pages", { method: "POST", body: JSON.stringify(body) })
  } catch (error) {
    if (error instanceof NotionRequestError && error.status >= 400 && error.status < 500 && error.status !== 408) {
      await storage.delete(key)
      throw error
    }
    const found = await reconcile()
    if (found) return found
    throw unresolvedCreation(identity)
  }
  if (!isRecord(created) || typeof created.id !== "string" || !created.id) {
    const found = await reconcile()
    if (found) return found
    throw unresolvedCreation(identity)
  }
  await storage.put(key, created.id)
  return { id: created.id, recovered: null }
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
  roster.records.push(record)
  if (roster.byId.has(record.id)) roster.duplicateIds.add(record.id)
  else roster.byId.set(record.id, record)
  addEmailIndex(roster, record)
}

// Members added by hand in Notion have no Member ID; give them one so check-ins can match them.
async function assignMemberId(env: Env, record: MemberRecord): Promise<MemberRecord> {
  const id = createMemberId()
  await notionRequest(env, `/pages/${encodeURIComponent(record.pageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { "Member ID": { rich_text: [{ type: "text", text: { content: id } }] } } }),
  })
  return { ...record, id }
}

export async function loadMemberRoster(env: Env, { assignMissingIds = false } = {}): Promise<MemberRoster> {
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
      ["Name", "Email", "Phone", "Affiliation", "Member ID", "General Risk Waiver"],
    )
    pages.push(...result.pages)
    startCursor = result.nextCursor
  } while (startCursor)

  const roster: MemberRoster = { records: [], byId: new Map(), byEmail: new Map(), duplicateIds: new Set() }
  for (const page of pages) {
    const record = pageToMemberRecord(page)
    if (record.id) addRosterRecord(roster, record)
    else if (assignMissingIds) addRosterRecord(roster, await assignMemberId(env, record))
  }
  return roster
}

// The members the kiosk can search: anyone with a name or email.
export function rosterMembers(roster: MemberRoster): Member[] {
  return roster.records
    .filter((record) => record.name || record.email)
    .map(({ id, name, email, phone, affiliation }) => ({ id, name, email, phone, affiliation }))
}

export async function listMembers(env: Env): Promise<Member[]> {
  return rosterMembers(await loadMemberRoster(env))
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

function eventLookup(env: Env, date: string): () => Promise<NotionPage | null> {
  return async () => {
    const result = await queryPages(
      env,
      env.NOTION_EVENTS_DATA_SOURCE_ID,
      {
        page_size: 2,
        filter: { property: "Date", date: { equals: date } },
      },
      ["Name", "Date", "Attendees", "Waivers Signed"],
    )
    if (result.pages.length > 1) {
      throw new RowProblem(`Expected at most one Notion event for ${date}, found ${result.pages.length}`)
    }
    return result.pages[0] ?? null
  }
}

async function attendanceEvent(env: Env, page: NotionPage): Promise<AttendanceEvent> {
  const relationIds = async (name: string) => {
    const relation = inlineRelation(page, name)
    return relation.hasMore ? retrieveRelationIds(env, page.id, relation.propertyId) : relation.relationIds
  }
  return { id: page.id, attendeePageIds: await relationIds("Attendees"), waiverPageIds: await relationIds("Waivers Signed") }
}

export async function findEventForDate(env: Env, date: string): Promise<AttendanceEvent | null> {
  const page = await eventLookup(env, date)()
  return page ? attendanceEvent(env, page) : null
}

export async function findOrCreateEventForDate(
  env: Env,
  date: string,
  storage: DurableObjectStorage,
): Promise<AttendanceEvent> {
  const lookup = eventLookup(env, date)
  const existing = await lookup()
  if (existing) return attendanceEvent(env, existing)
  const created = await createPageOnce(env, storage, `event:${date}`, lookup, {
    parent: { type: "data_source_id", data_source_id: env.NOTION_EVENTS_DATA_SOURCE_ID },
    properties: {
      Name: { title: [{ type: "text", text: { content: date } }] },
      Date: { date: { start: date } },
    },
  })
  return created.recovered ? attendanceEvent(env, created.recovered) : { id: created.id, attendeePageIds: [], waiverPageIds: [] }
}

async function createMember(
  env: Env,
  attendee: { memberId: string } & MemberDetails,
  date: string,
  eventId: string,
  storage: DurableObjectStorage,
): Promise<MemberRecord> {
  const lookup = async (): Promise<NotionPage | null> => {
    const result = await queryPages(env, env.NOTION_MEMBERS_DATA_SOURCE_ID, {
      page_size: 2,
      filter: { property: "Member ID", rich_text: { equals: attendee.memberId } },
    }, ["Name", "Email", "Phone", "Affiliation", "Member ID", "General Risk Waiver"])
    if (result.pages.length > 1) throw new Error(`More than one Notion member has Member ID ${attendee.memberId}`)
    return result.pages[0] ?? null
  }
  const created = await createPageOnce(env, storage, `member:${attendee.memberId}`, lookup, {
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
      Phone: { phone_number: attendee.phone || null },
      "Member Since": { date: { start: date } },
      "Events Attended": { relation: [{ id: eventId }] },
    },
  })
  if (created.recovered) return pageToMemberRecord(created.recovered)
  return {
    pageId: created.id,
    id: attendee.memberId,
    name: attendee.name,
    email: attendee.email,
    phone: attendee.phone,
    affiliation: attendee.affiliation,
    generalRiskWaiver: "",
  }
}

async function updateMemberDetails(
  env: Env,
  pageId: string,
  details: MemberDetails,
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
        Phone: { phone_number: details.phone || null },
      },
    }),
  })
}

export async function syncMemberAttendance(
  env: Env,
  roster: MemberRoster,
  attendee: AttendanceDetails,
  details: MemberDetails,
  date: string,
  eventId: string,
  storage: DurableObjectStorage,
): Promise<MemberRecord> {
  const emailMatches = roster.byEmail.get(attendee.email) ?? []
  let member = attendee.memberId ? roster.byId.get(attendee.memberId) ?? null : null
  if (member) {
    if (emailMatches.some((record) => record !== member)) {
      throw new RowProblem("Check-in member ID and email refer to different Notion members")
    }
  } else {
    // A new check-in gets a fresh Member ID before the person reaches Notion; email identifies them,
    // as it does at the kiosk.
    if (emailMatches.length > 1) throw new RowProblem("More than one Notion member has this email")
    member = emailMatches[0] ?? null
  }
  const memberId = member?.id ?? attendee.memberId
  if (memberId && roster.duplicateIds.has(memberId)) {
    throw new RowProblem(`More than one Notion member has Member ID ${memberId}`)
  }

  if (!member) {
    // Keep the generated identity stable when a create response is lost.
    const generatedIdKey = `notion-member-id:${attendee.email}`
    const newId = attendee.memberId ?? await storage.get<string>(generatedIdKey) ?? createMemberId()
    if (!attendee.memberId) await storage.put(generatedIdKey, newId)
    member = await createMember(env, { ...details, memberId: newId }, date, eventId, storage)
    addRosterRecord(roster, member)
  }

  if (
    member.name !== details.name ||
    member.email !== details.email ||
    member.affiliation !== details.affiliation ||
    member.phone !== details.phone
  ) {
    await updateMemberDetails(env, member.pageId, details)
    removeEmailIndex(roster, member, member.email)
    member.name = details.name
    member.email = details.email
    member.affiliation = details.affiliation
    member.phone = details.phone
    addEmailIndex(roster, member)
  }
  return member
}

// Notion sets at most 100 related pages per request, and each write replaces the whole list. A larger
// event sets its first 100 attendees, then adds the rest through each member's two-way relation.
async function addEventToMember(env: Env, memberPageId: string, eventId: string): Promise<void> {
  const page = await retrievePage(env, memberPageId)
  if (!page) throw new Error(`Notion member page ${memberPageId} is missing`)
  const relation = inlineRelation(page, "Events Attended")
  const eventIds = relation.hasMore ? await retrieveRelationIds(env, page.id, relation.propertyId) : relation.relationIds
  if (eventIds.includes(eventId)) return
  if (eventIds.length >= MAX_RELATION_ITEMS) {
    throw new RowProblem(`A member has attended ${eventIds.length} events, more than Notion can update in one request`)
  }
  await notionRequest(env, `/pages/${encodeURIComponent(memberPageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { "Events Attended": { relation: [...eventIds, eventId].map((id) => ({ id })) } } }),
  })
}

export async function syncEventAttendance(
  env: Env,
  event: AttendanceEvent,
  attendeePageIds: Iterable<string>,
): Promise<void> {
  const relationIds = [...new Set(attendeePageIds)]
  const existingIds = new Set(event.attendeePageIds)
  if (relationIds.length === existingIds.size && relationIds.every((id) => existingIds.has(id))) return
  await notionRequest(env, `/pages/${encodeURIComponent(event.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        Attendees: { relation: relationIds.slice(0, MAX_RELATION_ITEMS).map((id) => ({ id })) },
      },
    }),
  })
  for (const memberPageId of relationIds.slice(MAX_RELATION_ITEMS)) await addEventToMember(env, memberPageId, event.id)
  event.attendeePageIds = relationIds
}

// Each event lists the members who signed the non-Cornell participant waiver that night.
export async function syncEventWaivers(env: Env, event: AttendanceEvent, memberPageIds: Iterable<string>): Promise<void> {
  const relationIds = [...new Set(memberPageIds)]
  const existingIds = new Set(event.waiverPageIds)
  if (relationIds.length === existingIds.size && relationIds.every((id) => existingIds.has(id))) return
  if (relationIds.length > MAX_RELATION_ITEMS) throw new RowProblem(`More than ${MAX_RELATION_ITEMS} waivers on one night`)
  await notionRequest(env, `/pages/${encodeURIComponent(event.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { "Waivers Signed": { relation: relationIds.map((id) => ({ id })) } } }),
  })
  event.waiverPageIds = relationIds
}

export async function setGeneralRiskWaiver(env: Env, member: MemberRecord, academicYear: string): Promise<void> {
  if (member.generalRiskWaiver === academicYear) return
  await notionRequest(env, `/pages/${encodeURIComponent(member.pageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { "General Risk Waiver": { select: { name: academicYear } } } }),
  })
  member.generalRiskWaiver = academicYear
}

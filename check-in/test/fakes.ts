import { env } from "cloudflare:workers"
import { HttpResponse, http } from "msw"

// Stateful in-memory stand-ins for the Google Sheets and Notion APIs.
// Tests seed state, run the worker, and assert on the resulting state
// instead of hand-writing canned responses per request.

type Cell = string | number | boolean | null

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"
const NOTION_API = "https://api.notion.com/v1"

export class FakeSheets {
  rows: Cell[][] = []
  waivers: Cell[][] = []
  reads = 0
  appends = 0
  updates = 0
  sorts = 0
  transientFailures = 0
  failAppends = false
  failSort = false
  failUpdates = false
  // Runs before a single-row read, to simulate someone editing the Sheet mid-sync.
  beforeRowRead: (() => void) | null = null

  handlers() {
    return [
      http.get(/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values:batchGet/, () => {
        this.reads += 1
        if (this.transientFailures > 0) {
          this.transientFailures -= 1
          return new HttpResponse(null, { status: 503 })
        }
        return HttpResponse.json({
          valueRanges: [0, 2, 5].map((column) => ({
            values: this.rows.map((row) => row[column] == null ? [] : [row[column]]),
          })),
        })
      }),
      http.get(`${SHEETS_API}/:spreadsheetId/values/:range`, ({ params }) => {
        this.reads += 1
        if (this.transientFailures > 0) {
          this.transientFailures -= 1
          return new HttpResponse(null, { status: 503 })
        }
        if (String(params.range).startsWith("'Waivers'!")) return HttpResponse.json({ values: this.waivers.map((row) => [...row]) })
        const singleRow = String(params.range).match(/!A(\d+):F\1$/)
        if (singleRow) {
          this.beforeRowRead?.()
          this.beforeRowRead = null
          const row = this.rows[Number(singleRow[1]) - 2]
          return HttpResponse.json({ values: row ? [[...row]] : [] })
        }
        return HttpResponse.json({ values: this.rows.map((row) => [...row]) })
      }),
      http.post(`${SHEETS_API}/:spreadsheetId/values/:range`, async ({ params, request }) => {
        if (!String(params.range).endsWith(":append")) return new HttpResponse(null, { status: 400 })
        if (this.failAppends) return new HttpResponse(null, { status: 503 })
        const body = (await request.json()) as { values: Cell[][] }
        if (String(params.range).startsWith("'Waivers'!")) {
          this.waivers.push(...body.values)
          return HttpResponse.json({ updates: { updatedRows: body.values.length } })
        }
        this.rows.push(...body.values)
        this.appends += 1
        return HttpResponse.json({ updates: { updatedRows: body.values.length } })
      }),
      http.put(`${SHEETS_API}/:spreadsheetId/values/:range`, async ({ params, request }) => {
        if (this.failUpdates) return new HttpResponse(null, { status: 403 })
        const body = (await request.json()) as { values: Cell[][] }
        this.applyUpdate(String(params.range), body.values)
        this.updates += 1
        return HttpResponse.json({ updatedRows: body.values.length })
      }),
      http.get(`${SHEETS_API}/:spreadsheetId`, () =>
        HttpResponse.json({
          sheets: [{ properties: { sheetId: 123, title: env.GOOGLE_SHEET_NAME } }],
        }),
      ),
      http.post(/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+:batchUpdate/, () => {
        if (this.failSort) return new HttpResponse(null, { status: 403 })
        this.rows.sort((left, right) => Number(right[0] ?? 0) - Number(left[0] ?? 0))
        this.sorts += 1
        return HttpResponse.json({ replies: [{}] })
      }),
    ]
  }

  private applyUpdate(range: string, values: Cell[][]) {
    const match = range.match(/!([A-Z])(\d+)(?::[A-Z]\d+)?$/)
    if (!match) throw new Error(`FakeSheets cannot parse range ${range}`)
    const startColumn = match[1].charCodeAt(0) - "A".charCodeAt(0)
    const row = this.rows[Number(match[2]) - 2]
    if (!row) throw new Error(`FakeSheets has no row for range ${range}`)
    for (const [offset, cell] of values[0].entries()) row[startColumn + offset] = cell
  }
}

export type FakeMember = {
  pageId: string
  memberId: string
  name: string
  email: string | null
  phone?: string | null
  affiliation: string | null
  generalRiskWaiver?: string | null
  memberSince: string | null
  events: string[]
  lastEditedTime: string
}

export type FakeEvent = {
  pageId: string
  name: string
  date: string
  attendees: string[]
  waivers?: string[]
}

function richText(items: unknown): string {
  if (!Array.isArray(items)) return ""
  return items
    .map((item) => {
      const record = item as { plain_text?: string; text?: { content?: string } }
      return record?.plain_text ?? record?.text?.content ?? ""
    })
    .join("")
}

export class FakeNotion {
  members: FakeMember[] = []
  events: FakeEvent[] = []
  queries = 0
  writes = 0
  requests = 0
  memberCreates = 0
  eventCreates = 0
  createFailure: { kind: "member" | "event"; committed: boolean; network?: boolean } | null = null
  beforeCreate: (() => Promise<void>) | null = null
  hideMembers = false
  requestTimes: number[] = []
  rateLimitNext = 0

  // Counts a request and answers it with a rate limit while rateLimitNext is positive.
  private track() {
    this.requests += 1
    this.requestTimes.push(Date.now())
    if (this.rateLimitNext <= 0) return null
    this.rateLimitNext -= 1
    return new HttpResponse(null, { status: 429, headers: { "Retry-After": "1" } })
  }

  addMember(member: Partial<FakeMember> & { memberId: string }): FakeMember {
    const full: FakeMember = {
      pageId: `member-page-${this.members.length + 1}`,
      name: "",
      email: null,
      affiliation: null,
      memberSince: null,
      events: [],
      lastEditedTime: "2026-01-01T00:00:00.000Z",
      ...member,
    }
    this.members.push(full)
    return full
  }

  addEvent(date: string): FakeEvent {
    const event = { pageId: `event-page-${this.events.length + 1}`, name: date, date, attendees: [] }
    this.events.push(event)
    return event
  }

  handlers() {
    return [
      http.post(`${NOTION_API}/data_sources/:dataSourceId/query`, async ({ params, request }) => {
        const limited = this.track()
        if (limited) return limited
        this.queries += 1
        const body = ((await request.json()) ?? {}) as Record<string, any>
        if (params.dataSourceId === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          const date = body.filter?.date?.equals
          const matches = this.events.filter((event) => !date || event.date === date)
          return HttpResponse.json({
            object: "list",
            has_more: false,
            next_cursor: null,
            results: matches.map((event) => this.eventPage(event)),
          })
        }

        let matches = this.hideMembers ? [] : this.members
        const filter = body.filter as Record<string, any> | undefined
        if (filter?.property === "Member ID") {
          matches = matches.filter((member) => member.memberId === filter.rich_text?.equals)
        } else if (filter?.property === "Email") {
          matches = matches.filter((member) => member.email === filter.email?.equals)
        }
        const pageSize = typeof body.page_size === "number" ? body.page_size : 100
        const start = body.start_cursor ? Number(body.start_cursor) : 0
        const hasMore = start + pageSize < matches.length
        return HttpResponse.json({
          object: "list",
          has_more: hasMore,
          next_cursor: hasMore ? String(start + pageSize) : null,
          results: matches.slice(start, start + pageSize).map((member) => this.memberPage(member)),
        })
      }),
      http.post(`${NOTION_API}/pages`, async ({ request }) => {
        const limited = this.track()
        if (limited) return limited
        this.writes += 1
        const body = (await request.json()) as Record<string, any>
        const properties = body.properties ?? {}
        const kind = body.parent?.data_source_id === env.NOTION_EVENTS_DATA_SOURCE_ID ? "event" : "member"
        if (kind === "event") this.eventCreates += 1
        else this.memberCreates += 1
        await this.beforeCreate?.()
        const failure = this.createFailure?.kind === kind ? this.createFailure : null
        if (failure) this.createFailure = null
        const failedResponse = () => failure?.network
          ? HttpResponse.error()
          : new HttpResponse(null, { status: 503 })
        if (failure && !failure.committed) return failedResponse()
        if (kind === "event") {
          const event = {
            pageId: `event-page-${this.events.length + 1}`,
            name: richText(properties.Name?.title),
            date: String(properties.Date?.date?.start ?? ""),
            attendees: [],
          }
          this.events.push(event)
          if (failure) return failedResponse()
          return HttpResponse.json({ object: "page", id: event.pageId, properties: {} })
        }

        const member: FakeMember = {
          pageId: `member-page-${this.members.length + 1}`,
          memberId: richText(properties["Member ID"]?.rich_text),
          name: richText(properties.Name?.title),
          email: properties.Email?.email ?? null,
          phone: properties.Phone?.phone_number ?? null,
          affiliation: properties.Affiliation?.select?.name ?? null,
          memberSince: properties["Member Since"]?.date?.start ?? null,
          events: (properties["Events Attended"]?.relation ?? []).map((item: { id: string }) => item.id),
          lastEditedTime: new Date().toISOString(),
        }
        this.members.push(member)
        for (const eventId of member.events) {
          const event = this.events.find((candidate) => candidate.pageId === eventId)
          if (event && !event.attendees.includes(member.pageId)) event.attendees.push(member.pageId)
        }
        if (failure) return failedResponse()
        return HttpResponse.json({ object: "page", id: member.pageId, properties: {} })
      }),
      http.patch(`${NOTION_API}/pages/:pageId`, async ({ params, request }) => {
        const limited = this.track()
        if (limited) return limited
        this.writes += 1
        const properties = ((await request.json()) as Record<string, any>).properties ?? {}
        const event = this.events.find((candidate) => candidate.pageId === params.pageId)
        if (event) {
          if (properties.Attendees?.relation?.length > 100) return new HttpResponse(null, { status: 400 })
          if ("Waivers Signed" in properties) {
            event.waivers = properties["Waivers Signed"].relation.map((item: { id: string }) => item.id)
          }
          if ("Attendees" in properties) {
            event.attendees = properties.Attendees.relation.map((item: { id: string }) => item.id)
            for (const member of this.members) {
              member.events = member.events.filter((eventId) => eventId !== event.pageId)
              if (event.attendees.includes(member.pageId)) member.events.push(event.pageId)
            }
          }
          return HttpResponse.json({ object: "page", id: event.pageId, properties: {} })
        }

        const member = this.members.find((candidate) => candidate.pageId === params.pageId)
        if (!member) return new HttpResponse(null, { status: 404 })
        if ("Name" in properties) member.name = richText(properties.Name.title)
        if ("Member ID" in properties) member.memberId = richText(properties["Member ID"].rich_text)
        if ("Email" in properties) member.email = properties.Email.email
        if ("Phone" in properties) member.phone = properties.Phone.phone_number
        if ("Affiliation" in properties) member.affiliation = properties.Affiliation.select?.name ?? null
        if ("General Risk Waiver" in properties) member.generalRiskWaiver = properties["General Risk Waiver"].select?.name ?? null
        if ("Events Attended" in properties) {
          if (properties["Events Attended"].relation.length > 100) return new HttpResponse(null, { status: 400 })
          member.events = properties["Events Attended"].relation.map((item: { id: string }) => item.id)
          // Events Attended and Attendees are two sides of one relation.
          for (const event of this.events) {
            const related = member.events.includes(event.pageId)
            if (related && !event.attendees.includes(member.pageId)) event.attendees.push(member.pageId)
            if (!related) event.attendees = event.attendees.filter((id) => id !== member.pageId)
          }
        }
        member.lastEditedTime = new Date().toISOString()
        return HttpResponse.json({ object: "page", id: member.pageId, properties: {} })
      }),
      http.get(`${NOTION_API}/pages/:pageId`, ({ params }) => {
        const limited = this.track()
        if (limited) return limited
        const member = this.members.find((candidate) => candidate.pageId === params.pageId)
        if (member) return HttpResponse.json(this.memberPage(member))
        const event = this.events.find((candidate) => candidate.pageId === params.pageId)
        if (event) return HttpResponse.json(this.eventPage(event))
        return new HttpResponse(null, { status: 404 })
      }),
      http.get(`${NOTION_API}/pages/:pageId/properties/:propertyId`, ({ params, request }) => {
        const limited = this.track()
        if (limited) return limited
        const event = this.events.find((candidate) => candidate.pageId === params.pageId)
        if (!event || params.propertyId !== "VmW{") {
          return new HttpResponse(null, { status: 404 })
        }
        const url = new URL(request.url)
        const pageSize = Number(url.searchParams.get("page_size") ?? 100)
        const start = Number(url.searchParams.get("start_cursor") ?? 0)
        const hasMore = start + pageSize < event.attendees.length
        return HttpResponse.json({
          object: "list",
          has_more: hasMore,
          next_cursor: hasMore ? String(start + pageSize) : null,
          results: event.attendees.slice(start, start + pageSize).map((id) => ({ relation: { id } })),
        })
      }),
    ]
  }

  private memberPage(member: FakeMember) {
    return {
      object: "page",
      id: member.pageId,
      last_edited_time: member.lastEditedTime,
      properties: {
        Name: { title: member.name ? [{ plain_text: member.name }] : [] },
        Email: { email: member.email },
        Phone: { phone_number: member.phone ?? null },
        Affiliation: { select: member.affiliation ? { name: member.affiliation } : null },
        "General Risk Waiver": { select: member.generalRiskWaiver ? { name: member.generalRiskWaiver } : null },
        "Member ID": { rich_text: [{ plain_text: member.memberId }] },
        "Events Attended": {
          id: "events-attended-property",
          type: "relation",
          relation: member.events.map((id) => ({ id })),
          has_more: false,
        },
      },
    }
  }

  private eventPage(event: FakeEvent) {
    return {
      object: "page",
      id: event.pageId,
      properties: {
        Name: { title: [{ plain_text: event.name }] },
        Date: { date: { start: event.date } },
        Attendees: {
          id: "VmW%7B",
          type: "relation",
          relation: event.attendees.slice(0, 25).map((id) => ({ id })),
          has_more: event.attendees.length > 25,
        },
        "Waivers Signed": {
          id: "waivers-signed-property",
          type: "relation",
          relation: (event.waivers ?? []).map((id) => ({ id })),
          has_more: false,
        },
      },
    }
  }
}

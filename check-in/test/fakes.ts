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
  reads = 0
  appends = 0
  updates = 0
  sorts = 0
  transientFailures = 0
  failSort = false

  handlers() {
    return [
      http.get(`${SHEETS_API}/:spreadsheetId/values/:range`, () => {
        this.reads += 1
        if (this.transientFailures > 0) {
          this.transientFailures -= 1
          return new HttpResponse(null, { status: 503 })
        }
        return HttpResponse.json({ values: this.rows.map((row) => [...row]) })
      }),
      http.post(`${SHEETS_API}/:spreadsheetId/values/:range`, async ({ params, request }) => {
        if (!String(params.range).endsWith(":append")) return new HttpResponse(null, { status: 400 })
        const body = (await request.json()) as { values: Cell[][] }
        this.rows.push(...body.values)
        this.appends += 1
        return HttpResponse.json({ updates: { updatedRows: body.values.length } })
      }),
      http.put(`${SHEETS_API}/:spreadsheetId/values/:range`, async ({ params, request }) => {
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
  affiliation: string | null
  memberSince: string | null
  events: string[]
  lastEditedTime: string
}

export type FakeEvent = {
  pageId: string
  name: string
  date: string
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
    const event = { pageId: `event-page-${this.events.length + 1}`, name: date, date }
    this.events.push(event)
    return event
  }

  handlers() {
    return [
      http.post(`${NOTION_API}/data_sources/:dataSourceId/query`, async ({ params, request }) => {
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

        let matches = this.members
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
        this.writes += 1
        const body = (await request.json()) as Record<string, any>
        const properties = body.properties ?? {}
        if (body.parent?.data_source_id === env.NOTION_EVENTS_DATA_SOURCE_ID) {
          const event = {
            pageId: `event-page-${this.events.length + 1}`,
            name: richText(properties.Name?.title),
            date: String(properties.Date?.date?.start ?? ""),
          }
          this.events.push(event)
          return HttpResponse.json({ object: "page", id: event.pageId, properties: {} })
        }

        const member: FakeMember = {
          pageId: `member-page-${this.members.length + 1}`,
          memberId: richText(properties["Member ID"]?.rich_text),
          name: richText(properties.Name?.title),
          email: properties.Email?.email ?? null,
          affiliation: properties.Affiliation?.select?.name ?? null,
          memberSince: properties["Member Since"]?.date?.start ?? null,
          events: (properties["Events Attended"]?.relation ?? []).map((item: { id: string }) => item.id),
          lastEditedTime: new Date().toISOString(),
        }
        this.members.push(member)
        return HttpResponse.json({ object: "page", id: member.pageId, properties: {} })
      }),
      http.patch(`${NOTION_API}/pages/:pageId`, async ({ params, request }) => {
        this.writes += 1
        const member = this.members.find((candidate) => candidate.pageId === params.pageId)
        if (!member) return new HttpResponse(null, { status: 404 })
        const properties = ((await request.json()) as Record<string, any>).properties ?? {}
        if ("Name" in properties) member.name = richText(properties.Name.title)
        if ("Email" in properties) member.email = properties.Email.email
        if ("Affiliation" in properties) member.affiliation = properties.Affiliation.select?.name ?? null
        if ("Events Attended" in properties) {
          member.events = properties["Events Attended"].relation.map((item: { id: string }) => item.id)
        }
        member.lastEditedTime = new Date().toISOString()
        return HttpResponse.json({ object: "page", id: member.pageId, properties: {} })
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
        Affiliation: { select: member.affiliation ? { name: member.affiliation } : null },
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
      },
    }
  }
}

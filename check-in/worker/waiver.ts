import type { WaiverBlock } from "../src/lib/checkin"
import { dateKeyInTimeZone } from "./google"
import { isRecord } from "./util"

// Cornell's non-Cornell participant waiver on CampusGroups. CampusGroups doesn't allow embedding its
// pages, so the kiosk shows the waiver text and this module submits the form the way a browser would.
const CAMPUSGROUPS_ORIGIN = "https://cornell.campusgroups.com"
const SURVEY_URL = `${CAMPUSGROUPS_ORIGIN}/RMI/survey?survey_uid=cbbab8ae-db1d-11ee-bde0-0a80ef5ee5f9`
const FIELDS = {
  name: "free_text_e1c243dd-db1d-11ee-bde0-0a80ef5ee5f9",
  phone: "free_text_f75a7f17-db1d-11ee-bde0-0a80ef5ee5f9",
  event: "free_text_919c0e74-e2d4-11ee-bde0-0a80ef5ee5f9",
  host: "42137b64-e2d5-11ee-bde0-0a80ef5ee5f9",
  signature: "free_text_49c9efdc-e2d4-11ee-bde0-0a80ef5ee5f9",
}
const SWING_SYNDICATE_GROUP_ID = "26742"
const QUESTION_IDS = "703202,703203,703357,703358,703356"

export class WaiverFormChanged extends Error {}

type WaiverForm = {
  cookies: Map<string, string>
  hidden: Record<string, string>
  endpoint: string
  blocks: WaiverBlock[]
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…",
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
    return ENTITIES[code.toLowerCase()] ?? entity
  })
}

function storeCookies(cookies: Map<string, string>, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";")
    const separator = pair.indexOf("=")
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
}

export const WAIVER_FORM_URL = SURVEY_URL

// Throws WaiverFormChanged when the fields this module fills in are gone.
export async function loadWaiverForm(): Promise<WaiverForm> {
  const cookies = new Map<string, string>()
  const response = await fetch(SURVEY_URL, { redirect: "manual" })
  if (!response.ok) throw new Error(`Waiver form request failed with ${response.status}`)
  storeCookies(cookies, response)
  const html = await response.text()

  const hidden: Record<string, string> = {}
  const fieldNames = new Set<string>()
  // The waiver's paragraphs and bullets, with bold and italic text kept as CampusGroups shows it.
  const blocks: WaiverBlock[] = []
  const startBlock = (list: boolean) => blocks.push({ list, runs: [] })
  let skipped = 0
  let bold = 0
  let italic = 0
  await new HTMLRewriter()
    .on("#survey input, #survey select", {
      element(element) {
        const name = element.getAttribute("name")
        if (!name) return
        fieldNames.add(name)
        if (element.getAttribute("type") === "hidden") hidden[name] = decodeEntities(element.getAttribute("value") ?? "")
      },
    })
    .on(".page_intro style, .page_intro title, .page_intro script", {
      element(element) {
        skipped += 1
        element.onEndTag(() => { skipped -= 1 })
      },
    })
    .on(".page_intro p, .page_intro div, .page_intro h1, .page_intro h2, .page_intro h3, .page_intro h4", {
      element() { startBlock(false) },
    })
    // A line break continues a bullet as another bullet and a paragraph as another paragraph.
    .on(".page_intro li, .page_intro br", {
      element(element) { startBlock(element.tagName === "li" || blocks.at(-1)?.list === true) },
    })
    .on(".page_intro b, .page_intro strong", {
      element(element) {
        bold += 1
        element.onEndTag(() => { bold -= 1 })
      },
    })
    .on(".page_intro i, .page_intro em", {
      element(element) {
        italic += 1
        element.onEndTag(() => { italic -= 1 })
      },
    })
    .on(".page_intro", {
      text(text) {
        if (skipped || !text.text) return
        if (blocks.length === 0) startBlock(false)
        blocks.at(-1)!.runs.push({ text: text.text, bold: bold > 0, italic: italic > 0 })
      },
    })
    .transform(new Response(html))
    .arrayBuffer()

  const endpoint = html.match(/\/survey_submission_endpoint\?[^`"'\s]+/)?.[0]
  const waiver = blocks.map(tidyBlock).filter((block) => block.runs.length > 0)
  if (!endpoint || !hidden._csrf || waiver.length === 0 || !Object.values(FIELDS).every((name) => fieldNames.has(name))) {
    throw new WaiverFormChanged("The CampusGroups waiver form changed")
  }
  return { cookies, hidden, endpoint, blocks: waiver }
}

// Joins neighboring text with the same style, then decodes it and collapses whitespace like a browser.
function tidyBlock(block: WaiverBlock): WaiverBlock {
  const merged: WaiverBlock["runs"] = []
  for (const run of block.runs) {
    const previous = merged.at(-1)
    if (previous && previous.bold === run.bold && previous.italic === run.italic) previous.text += run.text
    else merged.push({ ...run })
  }
  const runs: WaiverBlock["runs"] = []
  for (const run of merged) {
    let text = decodeEntities(run.text).replace(/\s+/g, " ")
    if (runs.length === 0 || runs[runs.length - 1].text.endsWith(" ")) text = text.trimStart()
    if (text) runs.push({ ...run, text })
  }
  const last = runs.at(-1)
  if (last) last.text = last.text.trimEnd()
  return { list: block.list, runs: runs.filter((run) => run.text) }
}

// One event per day: a special event uses its title, and a weekly lesson is "<date> Swing Dance".
export async function waiverEventName(env: Env, timestamp = Date.now()): Promise<string> {
  const date = dateKeyInTimeZone(timestamp, env.TIME_ZONE)
  const event = await env.EVENTS_DB.prepare("SELECT kind, title FROM events WHERE date = ?").bind(date).first<{ kind: string; title: string }>()
  if (event?.kind === "special") return event.title
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(`${date}T00:00:00Z`))
  return `${day} Swing Dance`
}

export async function readWaiver(env: Env): Promise<{ blocks: WaiverBlock[]; eventName: string }> {
  const [form, eventName] = await Promise.all([loadWaiverForm(), waiverEventName(env)])
  return { blocks: form.blocks, eventName }
}

// Returns CampusGroups' ID for the saved response.
export async function submitWaiver(
  signer: { name: string; phone: string; signature: string },
  eventName: string,
): Promise<string> {
  const form = await loadWaiverForm()
  const headers = () => ({ Cookie: cookieHeader(form.cookies), Referer: SURVEY_URL, Origin: CAMPUSGROUPS_ORIGIN })

  const check = await fetch(`${CAMPUSGROUPS_ORIGIN}${form.endpoint}`, { headers: headers(), redirect: "manual" })
  storeCookies(form.cookies, check)
  const status: unknown = JSON.parse(await check.text())
  if (!check.ok || !isRecord(status) || status.canSubmit !== true) {
    throw new Error(`CampusGroups refused the waiver: ${isRecord(status) ? String(status.message) : check.status}`)
  }

  const body = new URLSearchParams({
    ...form.hidden,
    draft: "0",
    send_notification: "1",
    visible_question_ids: QUESTION_IDS,
    [FIELDS.name]: signer.name,
    [FIELDS.phone]: signer.phone,
    [FIELDS.event]: eventName,
    [FIELDS.host]: SWING_SYNDICATE_GROUP_ID,
    [FIELDS.signature]: signer.signature,
  })
  const response = await fetch(`${CAMPUSGROUPS_ORIGIN}/survey`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  })
  // A saved submission redirects to CampusGroups' confirmation page, which names the response in
  // type_uid2; anything else means it wasn't saved.
  const location = response.headers.get("Location") ?? ""
  const confirmation = new URL(location, CAMPUSGROUPS_ORIGIN)
  const responseId = confirmation.searchParams.get("type_uid2")
  if (
    response.status !== 302 ||
    confirmation.pathname !== "/confirmation" ||
    confirmation.searchParams.get("type") !== "survey_submission" ||
    !responseId
  ) {
    throw new Error(`Waiver submission was not confirmed: ${response.status} ${location}`)
  }
  return responseId
}

import { importPKCS8, SignJWT } from "jose"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
const ACCESS_TOKEN_CACHE_MS = 50 * 60 * 1000
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

export type SheetValue = string | number | boolean | null

export type CheckinRow = {
  rowNumber: number
  timestamp: SheetValue
  name: string
  email: string
  affiliation: string
  memberId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function sheetValue(value: unknown): SheetValue {
  if (value === "") return null
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  return null
}

export async function getGoogleAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const key = await importPKCS8(env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), "RS256")
  const assertion = await new SignJWT({ scope: SHEETS_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  const payload: unknown = await response.json()
  if (!response.ok || !isRecord(payload) || typeof payload.access_token !== "string") {
    throw new Error(`Google authentication failed with ${response.status}`)
  }
  return payload.access_token
}

export function createCachedGoogleAccessTokenProvider(
  fetchAccessToken: (env: Env) => Promise<string> = getGoogleAccessToken,
  now: () => number = Date.now,
): (env: Env) => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null
  let refresh: Promise<string> | null = null

  return async (env) => {
    if (cached && cached.expiresAt > now()) return cached.token

    refresh ??= fetchAccessToken(env)
      .then((token) => {
        cached = { token, expiresAt: now() + ACCESS_TOKEN_CACHE_MS }
        return token
      })
      .finally(() => {
        refresh = null
      })
    return refresh
  }
}

function quoteSheetTitle(title: string): string {
  return `'${title.replaceAll("'", "''")}'`
}

function sheetRange(env: Env, a1Range: string): string {
  return `${quoteSheetTitle(env.GOOGLE_SHEET_NAME)}!${a1Range}`
}

function valuesUrl(env: Env, range: string, suffix = ""): URL {
  return new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}${suffix}`,
  )
}

function spreadsheetUrl(env: Env): URL {
  return new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}`,
  )
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function sheetsRequest(url: URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, init)
    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === 3) return response

    const retryAfter = Number.parseFloat(response.headers.get("Retry-After") ?? "")
    const delay = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 300 * 2 ** attempt + Math.random() * 300
    await wait(Math.min(delay, 10_000))
  }
  throw new Error("Google Sheets request failed")
}

export async function readCheckins(env: Env, accessToken: string): Promise<CheckinRow[]> {
  const url = valuesUrl(env, sheetRange(env, "A2:E"))
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE")
  url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER")

  const response = await sheetsRequest(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload: unknown = await response.json()
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Google Sheets read failed with ${response.status}`)
  }

  const values = Array.isArray(payload.values) ? payload.values : []
  return values.map((row, index) => {
    const source = Array.isArray(row) ? row : []
    return {
      rowNumber: index + 2,
      timestamp: sheetValue(source[0]),
      name: stringValue(source[1]).trim(),
      email: stringValue(source[2]).trim().toLowerCase(),
      affiliation: stringValue(source[3]),
      memberId: stringValue(source[4]).trim(),
    }
  })
}

function columnValues(valueRange: unknown): SheetValue[] {
  if (!isRecord(valueRange) || !Array.isArray(valueRange.values)) return []
  return valueRange.values.map((row) => sheetValue(Array.isArray(row) ? row[0] : null))
}

export async function readCheckinKeys(
  env: Env,
  accessToken: string,
  dateKey: string,
): Promise<string[]> {
  const url = new URL(`${spreadsheetUrl(env)}/values:batchGet`)
  for (const range of ["A2:A", "C2:C", "E2:E"]) {
    url.searchParams.append("ranges", sheetRange(env, range))
  }
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE")
  url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER")

  const response = await sheetsRequest(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload: unknown = await response.json()
  if (!response.ok || !isRecord(payload) || !Array.isArray(payload.valueRanges)) {
    throw new Error(`Google Sheets key read failed with ${response.status}`)
  }

  const [timestamps, emails, memberIds] = payload.valueRanges.map(columnValues)
  const rowCount = Math.max(timestamps?.length ?? 0, emails?.length ?? 0, memberIds?.length ?? 0)
  const keys = new Set<string>()
  for (let index = 0; index < rowCount; index += 1) {
    if (dateKeyForSheetTimestamp(timestamps?.[index] ?? null) !== dateKey) continue
    const email = stringValue(emails?.[index]).trim().toLowerCase()
    const memberId = stringValue(memberIds?.[index]).trim()
    if (email) keys.add(`email:${email}`)
    if (memberId) {
      keys.add(`id:${memberId}`)
    } else if (email) {
      keys.add(`legacy-email:${email}`)
    }
  }
  return [...keys]
}

async function updateValues(
  env: Env,
  accessToken: string,
  a1Range: string,
  values: SheetValue[][],
): Promise<void> {
  const url = valuesUrl(env, sheetRange(env, a1Range))
  url.searchParams.set("valueInputOption", "RAW")
  const response = await sheetsRequest(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ majorDimension: "ROWS", values }),
  })
  if (!response.ok) {
    throw new Error(`Google Sheets update failed with ${response.status}`)
  }
}

async function appendRows(
  env: Env,
  accessToken: string,
  sheetTitle: string,
  values: SheetValue[][],
): Promise<void> {
  const url = valuesUrl(env, `${quoteSheetTitle(sheetTitle)}!A1:E1`, ":append")
  url.searchParams.set("valueInputOption", "RAW")
  url.searchParams.set("insertDataOption", "INSERT_ROWS")
  const response = await sheetsRequest(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ majorDimension: "ROWS", values }),
  })
  if (!response.ok) {
    throw new Error(`Google Sheets append failed with ${response.status}`)
  }
}

type SheetProperties = { sheetId: number; title: string }

async function listSheets(env: Env, accessToken: string): Promise<SheetProperties[]> {
  const url = spreadsheetUrl(env)
  url.searchParams.set("fields", "sheets.properties(sheetId,title)")
  const response = await sheetsRequest(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const metadata: unknown = await response.json()
  if (!response.ok || !isRecord(metadata) || !Array.isArray(metadata.sheets)) {
    throw new Error(`Google Sheets metadata read failed with ${response.status}`)
  }
  return metadata.sheets.flatMap((value) =>
    isRecord(value) &&
    isRecord(value.properties) &&
    typeof value.properties.sheetId === "number" &&
    typeof value.properties.title === "string"
      ? [{ sheetId: value.properties.sheetId, title: value.properties.title }]
      : [],
  )
}

async function batchUpdate(env: Env, accessToken: string, requests: unknown[]): Promise<void> {
  const response = await sheetsRequest(new URL(`${spreadsheetUrl(env)}:batchUpdate`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  })
  if (!response.ok) {
    throw new Error(`Google Sheets batch update failed with ${response.status}`)
  }
}

export async function sortCheckins(env: Env, accessToken: string): Promise<void> {
  const sheets = await listSheets(env, accessToken)
  const sheet = sheets.find((candidate) => candidate.title === env.GOOGLE_SHEET_NAME)
  if (!sheet) throw new Error(`Google Sheet ${env.GOOGLE_SHEET_NAME} was not found`)

  await batchUpdate(env, accessToken, [
    {
      sortRange: {
        range: {
          sheetId: sheet.sheetId,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        sortSpecs: [{ dimensionIndex: 0, sortOrder: "DESCENDING" }],
      },
    },
  ])
}

function timeZoneParts(timestamp: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp)

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number.parseInt(part.value, 10)]),
  )
}

export function timestampForSheet(timestamp: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = timeZoneParts(timestamp, timeZone)
  return Date.UTC(year, month - 1, day, hour, minute, second) / 86_400_000 + 25_569
}

export function dateKeyForSheetTimestamp(timestamp: SheetValue): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null
  return new Date((timestamp - 25_569) * 86_400_000).toISOString().slice(0, 10)
}

export function dateKeyInTimeZone(timestamp: number, timeZone: string): string {
  const { year, month, day } = timeZoneParts(timestamp, timeZone)
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
}

export async function appendCheckin(
  env: Env,
  accessToken: string,
  attendee: { memberId: string; name: string; email: string; affiliation: string },
  timestamp: number,
): Promise<void> {
  await appendRows(env, accessToken, env.GOOGLE_SHEET_NAME, [
    [
      timestampForSheet(timestamp, env.TIME_ZONE),
      attendee.name,
      attendee.email,
      attendee.affiliation,
      attendee.memberId,
    ],
  ])
}

export async function updateCheckinMemberDetails(
  env: Env,
  accessToken: string,
  rowNumber: number,
  member: { name: string; email: string; affiliation: string },
): Promise<void> {
  await updateValues(env, accessToken, `B${rowNumber}:D${rowNumber}`, [
    [member.name, member.email, member.affiliation],
  ])
}

export async function updateCheckinMemberId(
  env: Env,
  accessToken: string,
  rowNumber: number,
  memberId: string,
): Promise<void> {
  await updateValues(env, accessToken, `E${rowNumber}`, [[memberId]])
}

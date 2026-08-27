import { importPKCS8, SignJWT } from "jose"

import { createMemberId } from "./member-id"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
const SHEET_ROW_COUNT = 999
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

type SheetValue = string | number | boolean | null

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

function sheetRange(env: Env, a1Range: string): string {
  return `'${env.GOOGLE_SHEET_NAME.replaceAll("'", "''")}'!${a1Range}`
}

function sheetsUrl(env: Env, a1Range: string): URL {
  return new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SPREADSHEET_ID)}/values/${encodeURIComponent(sheetRange(env, a1Range))}`,
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
  const url = sheetsUrl(env, "A2:E1000")
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
  return Array.from({ length: SHEET_ROW_COUNT }, (_, index) => {
    const source = Array.isArray(values[index]) ? values[index] : []
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

async function updateValues(
  env: Env,
  accessToken: string,
  a1Range: string,
  values: SheetValue[][],
): Promise<void> {
  const url = sheetsUrl(env, a1Range)
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

async function sortCheckins(env: Env, accessToken: string): Promise<void> {
  const metadataUrl = spreadsheetUrl(env)
  metadataUrl.searchParams.set("fields", "sheets.properties(sheetId,title)")
  const metadataResponse = await sheetsRequest(metadataUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const metadata: unknown = await metadataResponse.json()
  if (!metadataResponse.ok || !isRecord(metadata) || !Array.isArray(metadata.sheets)) {
    throw new Error(`Google Sheets metadata read failed with ${metadataResponse.status}`)
  }
  const sheet = metadata.sheets.find(
    (value) =>
      isRecord(value) &&
      isRecord(value.properties) &&
      value.properties.title === env.GOOGLE_SHEET_NAME &&
      typeof value.properties.sheetId === "number",
  )
  const properties = isRecord(sheet) && isRecord(sheet.properties) ? sheet.properties : null
  if (!properties || typeof properties.sheetId !== "number") {
    throw new Error(`Google Sheet ${env.GOOGLE_SHEET_NAME} was not found`)
  }

  const sortResponse = await sheetsRequest(new URL(`${spreadsheetUrl(env)}:batchUpdate`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          sortRange: {
            range: {
              sheetId: properties.sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 5,
            },
            sortSpecs: [{ dimensionIndex: 0, sortOrder: "DESCENDING" }],
          },
        },
      ],
    }),
  })
  if (!sortResponse.ok) {
    throw new Error(`Google Sheets sort failed with ${sortResponse.status}`)
  }
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

export async function recordCheckin(
  env: Env,
  accessToken: string,
  attendee: { memberId: string | null; name: string; email: string; affiliation: string },
  timestamp: number,
): Promise<"created" | "duplicate"> {
  const rows = await readCheckins(env, accessToken)
  const dateKey = dateKeyInTimeZone(timestamp, env.TIME_ZONE)
  const duplicate = rows.some(
    (row) =>
      dateKeyForSheetTimestamp(row.timestamp) === dateKey &&
      (attendee.memberId
        ? row.memberId === attendee.memberId || (!row.memberId && row.email === attendee.email)
        : row.email === attendee.email),
  )
  if (duplicate) return "duplicate"

  const target = rows.find((row) => row.timestamp === null && !row.name && !row.email)
  if (!target) throw new Error("The Check-ins sheet has no empty rows")

  await updateValues(env, accessToken, `A${target.rowNumber}:E${target.rowNumber}`, [
    [
      timestampForSheet(timestamp, env.TIME_ZONE),
      attendee.name,
      attendee.email,
      attendee.affiliation,
      attendee.memberId ?? createMemberId(),
    ],
  ])
  await sortCheckins(env, accessToken)
  return "created"
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

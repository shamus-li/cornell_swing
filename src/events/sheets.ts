import { getGoogleAccessToken } from '../../check-in/worker/google'
import { validateRSVP, todayInNewYork, type EventRecord } from './model'

type Connection = { spreadsheetId: string; sheetId: number; tabTitle: string; error: string | null }
type Participant = { eventId: string; title: string; name: string; email: string; row: number }
const failure = 'Could not update Google Sheets. Check spreadsheet sharing and try again.'
const endpoint = (id: string) => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`
const titleKey = (title: string) => title.trim().toLocaleLowerCase('en-US')
const participantKey = (eventId: string, email: string) => JSON.stringify([eventId, email])
export class SheetError extends Error {}

let googleToken: { email: string; key: string; token: string; expiresAt: number } | undefined
async function sheetAccessToken(env: Env, signal: AbortSignal): Promise<string> {
  if (googleToken && googleToken.email === env.GOOGLE_SERVICE_ACCOUNT_EMAIL && googleToken.key === env.GOOGLE_PRIVATE_KEY && googleToken.expiresAt > Date.now()) return googleToken.token
  const requestedAt = Date.now()
  const token = await getGoogleAccessToken(env, signal)
  // Service-account tokens last one hour; refresh early and never share pending request I/O.
  googleToken = { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: env.GOOGLE_PRIVATE_KEY, token, expiresAt: requestedAt + 50 * 60 * 1000 }
  return token
}

async function connectionFor(env: Env): Promise<Connection | null> {
  return env.EVENTS_DB.prepare('SELECT spreadsheetId, sheetId, tabTitle, error FROM rsvp_sheet_connection WHERE id = 1').first<Connection>()
}
async function request(url: string, token: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<Response> {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal })
  if (!response.ok) throw new SheetError(failure, { cause: new Error(`Google Sheets ${method} failed with HTTP ${response.status}`) })
  return response
}
const range = (connection: Connection) => `'${connection.tabTitle.replaceAll("'", "''")}'!A:D`
const registryTitle = (connection: Connection) => `_Swing events ${connection.sheetId}`
const quoted = (title: string) => `'${title.replaceAll("'", "''")}'`

async function ensureRegistry(connection: Connection, token: string, signal: AbortSignal): Promise<string[][]> {
  const response = await request(`${endpoint(connection.spreadsheetId)}?fields=sheets(properties(sheetId,title,hidden,gridProperties(columnCount,rowCount)),basicFilter,data(startColumn,columnMetadata.hiddenByUser))`, token, signal)
  const metadata = await response.json() as { sheets: { basicFilter?: { range?: { startRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number; endRowIndex?: number } }; data?: { startColumn?: number; columnMetadata?: { hiddenByUser?: boolean }[] }[]; properties: { sheetId: number; title: string; hidden?: boolean; gridProperties?: { columnCount?: number; rowCount?: number } } }[] }
  const sourceSheet = metadata.sheets.find(sheet => sheet.properties.sheetId === connection.sheetId)
  const source = sourceSheet?.properties
  if (!source) throw new SheetError('The connected RSVP tab was deleted. Connect an existing RSVP tab.')
  connection.tabTitle = source.title
  const registry = metadata.sheets.find(sheet => sheet.properties.title === registryTitle(connection))?.properties
  const filter = sourceSheet?.basicFilter
  const stored = registry ? await registryRows(connection, token, signal) : []
  if (registry) {
    if (stored.length && JSON.stringify(stored[0]?.slice(0, 3)) !== JSON.stringify(['Event ID', 'Event', 'Date'])) throw new SheetError('The hidden event registry header must be Event ID, Event, Date.')
  }
  const requests: unknown[] = []
  if ((source.gridProperties?.columnCount ?? 0) < 4) requests.push({ appendDimension: { sheetId: connection.sheetId, dimension: 'COLUMNS', length: 4 - (source.gridProperties?.columnCount ?? 0) } })
  if (!filter?.range || (filter.range.startRowIndex ?? 0) !== 0 || (filter.range.startColumnIndex ?? 0) !== 0 || filter.range.endColumnIndex !== 4 || (filter.range.endRowIndex !== undefined && filter.range.endRowIndex !== source.gridProperties?.rowCount)) requests.push({ setBasicFilter: { filter: { ...filter, range: { sheetId: connection.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 4 } } } })
  if (!sourceSheet?.data?.some(grid => grid.columnMetadata?.[3 - (grid.startColumn ?? 0)]?.hiddenByUser)) requests.push({ updateDimensionProperties: { range: { sheetId: connection.sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } })
  if (!registry) requests.push({ addSheet: { properties: { title: registryTitle(connection), hidden: true, gridProperties: { columnCount: 3 } } } })
  else if (!registry.hidden) requests.push({ updateSheetProperties: { properties: { sheetId: registry.sheetId, hidden: true }, fields: 'hidden' } })
  if (requests.length) await request(`${endpoint(connection.spreadsheetId)}:batchUpdate`, token, signal, 'POST', { requests })
  return stored
}

async function registryRows(connection: Connection, token: string, signal: AbortSignal): Promise<string[][]> {
  const response = await request(`${endpoint(connection.spreadsheetId)}/values/${encodeURIComponent(`${quoted(registryTitle(connection))}!A:C`)}`, token, signal)
  return (await response.json() as { values?: string[][] }).values ?? []
}

async function refreshRegistry(env: Env, connection: Connection, token: string, signal: AbortSignal, stored?: string[][]): Promise<void> {
  const previous = (stored ?? await registryRows(connection, token, signal)).map(row => [row[0] ?? '', row[1] ?? '', row[2] ?? ''])
  while (previous.length && previous.at(-1)!.every(cell => cell === '')) previous.pop()
  const events = (await env.EVENTS_DB.prepare("SELECT id,title,date FROM events WHERE kind = 'special' ORDER BY date,id").all<{ id: string; title: string; date: string }>()).results
  const values = [['Event ID', 'Event', 'Date'], ...events.map(event => [event.id, event.title, event.date])]
  if (JSON.stringify(values) === JSON.stringify(previous)) return
  while (values.length < previous.length) values.push(['', '', ''])
  await request(`${endpoint(connection.spreadsheetId)}/values:batchUpdate`, token, signal, 'POST', { valueInputOption: 'RAW', data: [{ range: `${quoted(registryTitle(connection))}!A1:C${values.length}`, values }] })
}

async function readParticipants(env: Env, connection: Connection, token: string, signal: AbortSignal): Promise<Participant[]> {
  const storedRegistry = await ensureRegistry(connection, token, signal)
  const response = await request(`${endpoint(connection.spreadsheetId)}/values/${encodeURIComponent(range(connection))}?valueRenderOption=UNFORMATTED_VALUE`, token, signal)
  const { values = [] } = await response.json() as { values?: unknown[][] }
  if (!Array.isArray(values) || values.length > 10000) throw new SheetError('The RSVP sheet must contain at most 10,000 rows.')
  if (JSON.stringify(values[0]?.slice(0, 3)) !== JSON.stringify(['Event', 'Name', 'Email'])) throw new SheetError('The RSVP sheet header must be Event, Name, Email.')
  if (values[0]?.[3] && values[0][3] !== 'Event ID') throw new SheetError('Column D is needed for hidden Event IDs. Move its existing data before connecting.')
  const events = (await env.EVENTS_DB.prepare("SELECT id, title FROM events WHERE kind = 'special'").all<{ id: string; title: string }>()).results
  const byId = new Map(events.map(event => [event.id, event]))
  const byTitle = new Map<string, Set<string>>()
  const addTitle = (title: string, id: string) => {
    if (byId.has(id)) byTitle.set(titleKey(title), new Set([...(byTitle.get(titleKey(title)) ?? []), id]))
  }
  for (const event of events) addTitle(event.title, event.id)
  for (const row of storedRegistry.slice(1)) if (typeof row[0] === 'string' && typeof row[1] === 'string') addTitle(row[1], row[0])
  const participants: Participant[] = []
  const backfill: { range: string; values: string[][] }[] = []
  if (values[0]?.[3] !== 'Event ID') backfill.push({ range: `${quoted(connection.tabTitle)}!D1`, values: [['Event ID']] })
  for (let index = 1; index < values.length; index++) {
    const row = values[index]
    if (!Array.isArray(row) || row.every(cell => cell === '' || cell === null)) continue
    if ([row[0], row[1], row[2]].every(cell => cell === undefined || cell === null || cell === '')) {
      backfill.push({ range: `${quoted(connection.tabTitle)}!D${index + 1}`, values: [['']] })
      continue
    }
    const title = typeof row[0] === 'string' ? row[0].trim() : ''
    const storedId = typeof row[3] === 'string' ? row[3].trim() : ''
    let eventId = storedId
    if (!eventId) {
      const matches = [...(byTitle.get(titleKey(title)) ?? [])]
      if (matches.length !== 1) throw new SheetError(`Sheet row ${index + 1} has an unknown or ambiguous event title. Use the hidden Event ID to identify it.`)
      eventId = matches[0]
      backfill.push({ range: `${quoted(connection.tabTitle)}!D${index + 1}`, values: [[eventId]] })
    }
    const event = byId.get(eventId)
    if (!event) throw new SheetError(`Sheet row ${index + 1} refers to an event that no longer exists. Remove or correct that row.`)
    let participant
    try { participant = validateRSVP({ name: row[1], email: row[2] }) }
    catch { throw new SheetError(`Check the name and email in sheet row ${index + 1}.`) }
    participants.push({ ...participant, eventId, title: event.title, row: index + 1 })
  }
  if (backfill.length) await request(`${endpoint(connection.spreadsheetId)}/values:batchUpdate`, token, signal, 'POST', { valueInputOption: 'RAW', data: backfill })
  await refreshRegistry(env, connection, token, signal, storedRegistry)
  return participants
}

async function withSheet<T>(env: Env, action: (connection: Connection, token: string, signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const connection = await connectionFor(env)
  if (!connection) return null
  const lockToken = crypto.randomUUID()
  const lock = await env.EVENTS_DB.prepare('UPDATE rsvp_sheet_connection SET lockToken = ?, lockUntil = ? WHERE id = 1 AND lockUntil < ? AND spreadsheetId = ? AND sheetId = ?').bind(lockToken, Date.now() + 30000, Date.now(), connection.spreadsheetId, connection.sheetId).run()
  if (!lock.meta.changes) throw new SheetError('Another RSVP update is in progress. Please try again.')
  let errorMessage: string | null = null
  try {
    const signal = AbortSignal.timeout(15000)
    const token = await sheetAccessToken(env, signal)
    return await action(connection, token, signal)
  } catch (error) {
    errorMessage = error instanceof SheetError ? error.message : failure
    throw error instanceof SheetError ? error : new SheetError(errorMessage, { cause: error })
  } finally {
    await env.EVENTS_DB.prepare('UPDATE rsvp_sheet_connection SET error = ?, lockToken = NULL, lockUntil = 0 WHERE id = 1 AND lockToken = ?').bind(errorMessage, lockToken).run()
  }
}

export async function getSheetStatus(env: Env) {
  const connection = await connectionFor(env)
  return { connection: connection ? { url: `https://docs.google.com/spreadsheets/d/${connection.spreadsheetId}/edit#gid=${connection.sheetId}`, error: connection.error } : null, serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '' }
}

export async function linkSheet(env: Env, value: string): Promise<void> {
  let url: URL
  try { url = new URL(value) } catch { throw new SheetError('Enter a Google Sheets spreadsheet link.') }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/)
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match || url.username || url.password || url.port) throw new SheetError('Enter a Google Sheets spreadsheet link.')
  const existing = await connectionFor(env)
  if (existing) {
    if (existing.spreadsheetId !== match[1]) throw new SheetError('Disconnect the current spreadsheet before connecting another.')
    return
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) throw new SheetError('Google Sheets sync is not configured.')
  const gid = Number(url.hash.match(/(?:^#|&)gid=(\d+)/)?.[1])
  if (!Number.isInteger(gid)) throw new SheetError('Open the RSVP tab and paste its link including gid.')
  const signal = AbortSignal.timeout(15000)
  const token = await sheetAccessToken(env, signal)
  const response = await request(`${endpoint(match[1])}?fields=sheets.properties(sheetId,title)`, token, signal)
  const metadata = await response.json() as { sheets?: { properties: { sheetId: number; title: string } }[] }
  const properties = metadata.sheets?.find(sheet => sheet.properties.sheetId === gid)?.properties
  if (!properties) throw new SheetError('The linked spreadsheet tab was not found.')
  const connection = { spreadsheetId: match[1], sheetId: gid, tabTitle: properties.title, error: null }
  await readParticipants(env, connection, token, signal)
  await env.EVENTS_DB.prepare('INSERT INTO rsvp_sheet_connection (id, spreadsheetId, sheetId, tabTitle) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(connection.spreadsheetId, gid, properties.title).run()
}

export async function disconnectSheet(env: Env): Promise<void> {
  const result = await env.EVENTS_DB.prepare('DELETE FROM rsvp_sheet_connection WHERE id = 1 AND lockUntil < ?').bind(Date.now()).run()
  if (!result.meta.changes && await connectionFor(env)) throw new SheetError('An RSVP update is in progress. Please try again.')
}

export async function saveRSVP(env: Env, event: EventRecord, attendee: { name: string; email: string }): Promise<void> {
  const save = async (participant: { name: string; email: string }, authoritative = false) => {
    await env.EVENTS_DB.prepare("INSERT INTO rsvps (eventId, name, email, createdAt) SELECT id, ?, ?, ? FROM events WHERE id = ? AND kind = 'special' ON CONFLICT(eventId,email) DO UPDATE SET name = excluded.name WHERE ?").bind(participant.name, participant.email, new Date().toISOString(), event.id, authoritative ? 1 : 0).run()
  }
  const connected = await withSheet(env, async (connection, token, signal) => {
    const current = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(event.id).first<EventRecord>()
    if (!current || current.kind !== 'special' || (current.date && current.date < todayInNewYork())) throw new SheetError('RSVPs are closed for this event.')
    event = current
    const rows = await readParticipants(env, connection, token, signal)
    const existing = rows.find(row => row.eventId === event.id && row.email === attendee.email)
    if (!existing) await request(`${endpoint(connection.spreadsheetId)}/values/${encodeURIComponent(range(connection))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, signal, 'POST', { values: [[event.title, attendee.name, attendee.email, event.id]] })
    await save(existing ?? attendee, true)
    return true
  })
  if (!connected) await save(attendee)
}

export async function removeRSVP(env: Env, eventId: string, email: string): Promise<void> {
  const remove = () => env.EVENTS_DB.prepare('DELETE FROM rsvps WHERE eventId = ? AND email = ?').bind(eventId, email).run()
  const connected = await withSheet(env, async (connection, token, signal) => {
    const rows = (await readParticipants(env, connection, token, signal)).filter(row => row.eventId === eventId && row.email === email).sort((a, b) => b.row - a.row)
    if (rows.length) await request(`${endpoint(connection.spreadsheetId)}:batchUpdate`, token, signal, 'POST', { requests: rows.map(row => ({ deleteDimension: { range: { sheetId: connection.sheetId, dimension: 'ROWS', startIndex: row.row - 1, endIndex: row.row } } })) })
    await remove()
    return true
  })
  if (!connected) await remove()
}

export async function importSheet(env: Env): Promise<void> {
  const connected = await withSheet(env, async (connection, token, signal) => {
    const rows = await readParticipants(env, connection, token, signal)
    const participants = new Map<string, Participant>()
    for (const row of rows) {
      const key = participantKey(row.eventId, row.email)
      if (participants.has(key) && participants.get(key)!.name !== row.name) throw new SheetError(`Sheet row ${row.row} duplicates an RSVP with a different name.`)
      participants.set(key, row)
    }
    const statements = [...participants.values()].map(row => env.EVENTS_DB.prepare('INSERT INTO rsvps (eventId, name, email, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(eventId,email) DO UPDATE SET name = excluded.name WHERE rsvps.name != excluded.name').bind(row.eventId, row.name, row.email, new Date().toISOString()))
    const existing = (await env.EVENTS_DB.prepare("SELECT rsvps.eventId, rsvps.email FROM rsvps JOIN events ON events.id = rsvps.eventId WHERE events.kind = 'special'").all<{ eventId: string; email: string }>()).results
    for (const row of existing) if (!participants.has(participantKey(row.eventId, row.email))) statements.push(env.EVENTS_DB.prepare('DELETE FROM rsvps WHERE eventId = ? AND email = ?').bind(row.eventId, row.email))
    if (statements.length) await env.EVENTS_DB.batch(statements)
    return true
  })
  if (!connected) throw new SheetError('Connect an RSVP spreadsheet first.')
}

export async function changeEventWithSheet(env: Env, event: EventRecord, newTitle: string | null, change: () => Promise<void>, newKind?: string): Promise<void> {
  const connected = await withSheet(env, async (connection, token, signal) => {
    const current = await env.EVENTS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(event.id).first<EventRecord>()
    if (!current || current.updatedAt !== event.updatedAt) throw new SheetError('The event changed. Refresh before saving.')
    if (newKind === 'normal' && await env.EVENTS_DB.prepare('SELECT 1 FROM rsvps WHERE eventId = ? LIMIT 1').bind(event.id).first()) throw new SheetError('An event with RSVPs cannot become a normal event.')
    if (newTitle !== null && newTitle !== event.title && newKind !== 'normal') {
      const duplicate = await env.EVENTS_DB.prepare("SELECT 1 FROM events WHERE kind = 'special' AND id != ? AND lower(trim(title)) = lower(trim(?)) LIMIT 1").bind(event.id, newTitle).first()
      if (duplicate) throw new SheetError('Special events must have unique titles.')
    }
    const rows = (await readParticipants(env, connection, token, signal)).filter(row => row.eventId === event.id)
    if (rows.length && newKind === 'normal') throw new SheetError('An event with sheet RSVPs cannot become a normal event.')
    if (rows.length && newTitle !== null && newTitle !== event.title) {
      await request(`${endpoint(connection.spreadsheetId)}/values:batchUpdate`, token, signal, 'POST', { valueInputOption: 'RAW', data: rows.map(row => ({ range: `'${connection.tabTitle.replaceAll("'", "''")}'!A${row.row}`, values: [[newTitle]] })) })
    } else if (rows.length && newTitle === null) {
      await request(`${endpoint(connection.spreadsheetId)}:batchUpdate`, token, signal, 'POST', { requests: rows.sort((a, b) => b.row - a.row).map(row => ({ deleteDimension: { range: { sheetId: connection.sheetId, dimension: 'ROWS', startIndex: row.row - 1, endIndex: row.row } } })) })
    }
    try {
      await change()
    }
    catch (error) {
      if (rows.length && newTitle !== null && newTitle !== event.title) {
        try {
          await request(`${endpoint(connection.spreadsheetId)}/values:batchUpdate`, token, AbortSignal.timeout(8000), 'POST', { valueInputOption: 'RAW', data: rows.map(row => ({ range: `'${connection.tabTitle.replaceAll("'", "''")}'!A${row.row}`, values: [[event.title]] })) })
        } catch {
          throw new SheetError(`The event could not be saved or restored. Change the spreadsheet event title from “${newTitle}” back to “${event.title}”, then refresh.`)
        }
      }
      throw error
    }
    await refreshRegistry(env, connection, token, signal)
    return true
  })
  if (!connected) {
    if (newTitle !== null && newTitle !== event.title && newKind !== 'normal' && await env.EVENTS_DB.prepare("SELECT 1 FROM events WHERE kind = 'special' AND id != ? AND lower(trim(title)) = lower(trim(?)) LIMIT 1").bind(event.id, newTitle).first()) throw new SheetError('Special events must have unique titles.')
    await change()
  }
}

export async function createEventWithSheet(env: Env, title: string, create: () => Promise<void>): Promise<void> {
  const checkAndCreate = async () => {
    if (await env.EVENTS_DB.prepare("SELECT 1 FROM events WHERE kind = 'special' AND lower(trim(title)) = lower(trim(?)) LIMIT 1").bind(title).first()) throw new SheetError('Special events must have unique titles.')
    await create()
    return true
  }
  if (!await withSheet(env, async (connection, token, signal) => {
    const stored = await ensureRegistry(connection, token, signal)
    await checkAndCreate()
    await refreshRegistry(env, connection, token, signal, stored)
    return true
  })) await checkAndCreate()
}

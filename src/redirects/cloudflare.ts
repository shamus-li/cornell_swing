import { canonicalSource, isRecord, parseRedirect, type Redirect } from './redirect'

// Redirects live in a Cloudflare Bulk Redirect List, which Cloudflare applies before the Worker runs.
// Each redirect is stored as two list items, with and without a trailing slash.
export class RedirectError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

type Config = { accountId: string; token: string; hostname: string; listId: string }
type Item = { id: string; redirect: Redirect }

function configFor(env: Env): Config {
  return { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.REDIRECT_API_TOKEN, hostname: env.REDIRECT_HOSTNAME, listId: env.REDIRECT_LIST_ID }
}

export async function listRedirects(env: Env): Promise<Redirect[]> {
  const redirects = new Map<string, Redirect>()
  for (const { redirect } of await readItems(configFor(env))) {
    const existing = redirects.get(redirect.source)
    if (existing && (existing.destination !== redirect.destination || existing.code !== redirect.code)) throw new RedirectError(409, `Conflicting stored redirects for ${redirect.source}`)
    redirects.set(redirect.source, redirect)
  }
  return [...redirects.values()]
}

export async function createRedirect(env: Env, redirect: Redirect): Promise<void> {
  const config = configFor(env)
  rejectDuplicate(await readItems(config), redirect.source)
  await addItems(config, redirect)
}

export async function updateRedirect(env: Env, source: string, redirect: Redirect): Promise<void> {
  const config = configFor(env)
  const items = await readItems(config)
  const previous = itemsFor(items, source)
  const renamed = redirect.source !== canonicalSource(source)
  if (renamed) rejectDuplicate(items, redirect.source)
  // Adding replaces items with the same source URL. A renamed redirect is added before the old one is
  // deleted, so a failure between the two steps never loses it.
  await addItems(config, redirect)
  if (renamed) await runOperation(config, 'DELETE', { items: previous.map(({ id }) => ({ id })) })
}

export async function deleteRedirect(env: Env, source: string): Promise<void> {
  const config = configFor(env)
  await runOperation(config, 'DELETE', { items: itemsFor(await readItems(config), source).map(({ id }) => ({ id })) })
}

function itemsFor(items: Item[], source: string): Item[] {
  const canonical = canonicalSource(source)
  const matches = items.filter(item => item.redirect.source === canonical)
  if (!matches.length) throw new RedirectError(404, `No redirect exists for ${canonical}`)
  return matches
}

function rejectDuplicate(items: Item[], source: string): void {
  if (items.some(item => item.redirect.source === source)) throw new RedirectError(409, `A redirect for ${source} already exists`)
}

function addItems(config: Config, redirect: Redirect): Promise<void> {
  return runOperation(config, 'POST', [redirect.source, `${redirect.source}/`].map(source => ({
    redirect: { source_url: `${config.hostname}${source}`, target_url: redirect.destination, status_code: redirect.code, preserve_query_string: false, preserve_path_suffix: false, subpath_matching: false, include_subdomains: false },
  })))
}

// Items for other hostnames are skipped, so the list can be shared.
async function readItems(config: Config): Promise<Item[]> {
  const items: Item[] = []
  let cursor = ''
  do {
    const query = new URLSearchParams({ per_page: '500' })
    if (cursor) query.set('cursor', cursor)
    const { result, resultInfo } = await cloudflare(config, `/rules/lists/${config.listId}/items?${query}`)
    if (!Array.isArray(result)) throw new RedirectError(502, 'Cloudflare returned invalid redirect-list items')
    for (const item of result) {
      const redirect = isRecord(item) && isRecord(item.redirect) ? item.redirect : null
      const url = typeof redirect?.source_url === 'string' ? redirect.source_url.replace(/^https?:\/\//, '') : ''
      if (!redirect || !url.startsWith(`${config.hostname}/`)) continue
      if (typeof item.id !== 'string') throw new RedirectError(502, 'Cloudflare returned a redirect item without an id')
      try { items.push({ id: item.id, redirect: parseRedirect({ source: url.slice(config.hostname.length), destination: redirect.target_url, code: redirect.status_code ?? 301 }) }) }
      catch (error) { throw new RedirectError(502, (error as Error).message) }
    }
    cursor = isRecord(resultInfo) && isRecord(resultInfo.cursors) && typeof resultInfo.cursors.after === 'string' ? resultInfo.cursors.after : ''
  } while (cursor)
  return items
}

// List changes are asynchronous; wait until Cloudflare reports the operation finished.
async function runOperation(config: Config, method: 'POST' | 'DELETE', body: unknown): Promise<void> {
  const { result } = await cloudflare(config, `/rules/lists/${config.listId}/items`, method, body)
  if (!isRecord(result) || typeof result.operation_id !== 'string') throw new RedirectError(502, 'Cloudflare redirect update did not return an operation_id')
  for (let attempt = 0; attempt < 20; attempt++) {
    const { result: operation } = await cloudflare(config, `/rules/lists/bulk_operations/${result.operation_id}`)
    if (!isRecord(operation)) throw new RedirectError(502, 'Cloudflare returned an invalid bulk-operation response')
    if (operation.status === 'completed') return
    if (operation.status === 'failed') throw new RedirectError(502, typeof operation.error === 'string' ? operation.error : 'Cloudflare redirect update failed')
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new RedirectError(504, 'Cloudflare redirect update did not finish in time')
}

async function cloudflare(config: Config, path: string, method = 'GET', body?: unknown): Promise<{ result: unknown; resultInfo: unknown }> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data: unknown = await response.json().catch(() => null)
  const status = response.ok ? 502 : response.status
  if (!isRecord(data)) throw new RedirectError(status, response.ok ? 'Cloudflare returned an invalid response' : `${response.status} ${response.statusText}`)
  if (!response.ok || data.success === false) {
    const messages = Array.isArray(data.errors) ? data.errors.map(error => isRecord(error) && typeof error.message === 'string' ? error.message : '').filter(Boolean) : []
    throw new RedirectError(status, messages.join('; ') || `${response.status} ${response.statusText}`)
  }
  return { result: data.result, resultInfo: data.result_info }
}

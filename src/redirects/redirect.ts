export type RedirectCode = 301 | 302
export type Redirect = { source: string; destination: string; code: RedirectCode }

// Bulk Redirects run before the Worker, so a redirect on these paths would hide the site or lock out managers.
const reserved = ['/manage', '/redirects', '/check-in', '/api', '/assets', '/cdn-cgi']

export function canonicalSource(source: string): string {
  const normalized = source.trim().replace(/^\/*/, '/')
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

export function parseRedirect(value: unknown): Redirect {
  if (!isRecord(value)) throw new Error('Redirects must be objects')
  const { source, destination, code } = value
  if (typeof source !== 'string' || !source.trim().startsWith('/')) throw new Error('Redirect sources must start with /')
  const canonical = canonicalSource(source)
  if (canonical === '/' || reserved.some(path => canonical === path || canonical.startsWith(`${path}/`))) throw new Error(`${canonical} is used by the website`)
  if (typeof destination !== 'string' || !isHttpUrl(destination.trim())) throw new Error('Redirect destinations must be absolute HTTP(S) URLs')
  if (code !== 301 && code !== 302) throw new Error('Redirect code must be 301 or 302')
  return { source: canonical, destination: destination.trim(), code }
}

export function parseRedirects(value: unknown): Redirect[] {
  if (!Array.isArray(value)) throw new Error('Redirects must be an array')
  const redirects = new Map<string, Redirect>()
  for (const redirect of value.map(parseRedirect)) {
    if (redirects.has(redirect.source)) throw new Error(`Duplicate redirect source ${redirect.source}`)
    redirects.set(redirect.source, redirect)
  }
  return [...redirects.values()]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) }
  catch { return false }
}

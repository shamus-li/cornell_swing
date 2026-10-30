// The officer who gets check-in alerts. Cloudflare only delivers to verified Email Routing destination
// addresses, so saving an address asks Cloudflare to send it a verification email.
export class AlertEmailError extends Error {}

type Address = { email: string; verified: string | null }
type CloudflareResult<T> = { result: T; result_info?: { total_pages?: number } }

export async function readAlertEmail(env: Env): Promise<string> {
  return (await env.EVENTS_DB.prepare('SELECT alertEmail FROM settings WHERE id = 1').first<string>('alertEmail'))!
}

export async function sendAlert(env: Env, subject: string, paragraphs: string[]): Promise<void> {
  await env.ALERT_EMAIL.send({
    to: await readAlertEmail(env),
    from: { email: "check-in@swingsyndicate.club", name: "Swing Syndicate check-in" },
    subject,
    text: paragraphs.join("\n\n"),
  })
}

async function cloudflare<T>(env: Env, path: string, init?: RequestInit): Promise<CloudflareResult<T>> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/routing/addresses${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.REDIRECT_API_TOKEN}`, 'content-type': 'application/json' },
  })
  const data = await response.json().catch(() => null) as (CloudflareResult<T> & { success?: boolean; errors?: { message?: string }[] }) | null
  if (!response.ok || !data?.success) throw new AlertEmailError(data?.errors?.map(error => error.message).filter(Boolean).join('; ') || `Cloudflare returned ${response.status}`)
  return data
}

async function findAddress(env: Env, email: string): Promise<Address | undefined> {
  for (let page = 1; ; page++) {
    const { result, result_info } = await cloudflare<Address[]>(env, `?per_page=50&page=${page}`)
    const match = result.find(address => address.email.toLowerCase() === email)
    if (match || page >= (result_info?.total_pages ?? 1)) return match
  }
}

export async function alertEmailStatus(env: Env): Promise<{ email: string; verified: boolean }> {
  const email = await readAlertEmail(env)
  return { email, verified: !!(await findAddress(env, email))?.verified }
}

export async function saveAlertEmail(env: Env, email: string): Promise<{ email: string; verified: boolean }> {
  const address = await findAddress(env, email) ?? (await cloudflare<Address>(env, '', { method: 'POST', body: JSON.stringify({ email }) })).result
  await env.EVENTS_DB.prepare('UPDATE settings SET alertEmail = ? WHERE id = 1').bind(email).run()
  return { email, verified: !!address.verified }
}

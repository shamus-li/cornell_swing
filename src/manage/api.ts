export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again."

export async function api<T>(path: string, init?: RequestInit, failureMessage = "Changes could not be saved. Please try again."): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/manage/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    throw new Error("Check your connection and try again.")
  }
  // Cloudflare Access redirects an expired session to its sign-in page.
  if (response.redirected) throw new Error("Your session has expired. Reload this page to sign in again.")
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok || !data) throw new Error(data?.error || failureMessage)
  return data
}

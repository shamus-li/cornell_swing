export class ApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

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
  const data = await response.json().catch(() => null) as (T & { error?: string; code?: string }) | null
  if (!response.ok || !data) throw new ApiError(data?.error || failureMessage, data?.code)
  return data
}

const SHEET_FRESH_MS = 60_000
// How long the worker gets to reread Google's sheets in the background.
const SHEET_REFRESH_WAIT_MS = 4_000

// Shows the saved copy of the club's sheets right away, then the new read if that copy was old.
export async function loadSheetData<T extends { sheetReadAt: string }>(path: string, failureMessage: string, onData: (data: T) => void, signal?: AbortSignal): Promise<void> {
  const data = await api<T>(path, { signal }, failureMessage)
  onData(data)
  if (Date.now() - Date.parse(data.sheetReadAt) < SHEET_FRESH_MS) return
  await new Promise(resolve => setTimeout(resolve, SHEET_REFRESH_WAIT_MS))
  if (!signal?.aborted) onData(await api<T>(path, { signal }, failureMessage))
}

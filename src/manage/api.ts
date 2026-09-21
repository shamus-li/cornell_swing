export async function api<T>(path: string, init?: RequestInit, failureMessage = "Changes could not be saved. Please try again."): Promise<T> {
  const response = await fetch(`/manage/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } })
  if (response.redirected || response.headers.get("content-type")?.includes("text/html")) throw new Error("Your session has expired. Reload this page to sign in again.")
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || failureMessage)
  return data
}

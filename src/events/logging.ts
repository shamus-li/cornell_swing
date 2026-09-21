function details(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return { message: 'Non-Error exception' }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined && depth < 3 ? { cause: details(error.cause, depth + 1) } : {}),
  }
}

export function logError(message: string, error: unknown): void {
  console.error(JSON.stringify({ message, error: details(error) }))
}

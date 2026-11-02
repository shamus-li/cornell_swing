import { env } from "cloudflare:workers"

const migrations = import.meta.glob<string>("../../migrations/events/*.sql", { query: "?raw", import: "default", eager: true })

// A fresh events database with every migration applied, as in production.
export async function resetEventsDb(): Promise<void> {
  const { results } = await env.EVENTS_DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC")
    .all<{ name: string }>()
  for (const { name } of results) await env.EVENTS_DB.exec(`DROP TABLE IF EXISTS "${name}"`)
  for (const path of Object.keys(migrations).sort()) {
    await env.EVENTS_DB.exec(migrations[path].replace(/--.*$/gm, "").replaceAll("\n", " "))
  }
}

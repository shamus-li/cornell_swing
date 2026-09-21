import { DurableObject } from "cloudflare:workers"

import {
  appendCheckin,
  createCachedGoogleAccessTokenProvider,
  dateKeyInTimeZone,
  readCheckinKeys,
} from "./google"
import { createMemberId } from "./member-id"

type CheckinAttendee = {
  memberId: string | null
  name: string
  email: string
  affiliation: string
}

export class CheckinGuard extends DurableObject<Env> {
  private initialization: Promise<void> | null = null
  private readonly getAccessToken = createCachedGoogleAccessTokenProvider()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS checkin_keys (key TEXT PRIMARY KEY)")
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS guard_state (name TEXT PRIMARY KEY)")
  }

  private isInitialized(): boolean {
    return Array.from(
      this.ctx.storage.sql.exec("SELECT name FROM guard_state WHERE name = 'initialized'"),
    ).length > 0
  }

  private async seed(dateKey: string, accessToken: string): Promise<void> {
    const keys = await readCheckinKeys(this.env, accessToken, dateKey)
    this.ctx.storage.transactionSync(() => {
      for (const key of keys) {
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO checkin_keys (key) VALUES (?)", key)
      }
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO guard_state (name) VALUES ('initialized')")
    })
  }

  private async ensureInitialized(dateKey: string, accessToken: string): Promise<void> {
    if (this.isInitialized()) return
    this.initialization ??= this.seed(dateKey, accessToken).finally(() => {
      this.initialization = null
    })
    await this.initialization
  }

  private reserve(checkKeys: string[], keys: string[]): string[] | null {
    return this.ctx.storage.transactionSync(() => {
      for (const key of checkKeys) {
        const found = Array.from(
          this.ctx.storage.sql.exec("SELECT key FROM checkin_keys WHERE key = ?", key),
        ).length > 0
        if (found) return null
      }
      const reservedKeys: string[] = []
      for (const key of keys) {
        const found = Array.from(
          this.ctx.storage.sql.exec("SELECT key FROM checkin_keys WHERE key = ?", key),
        ).length > 0
        if (found) continue
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO checkin_keys (key) VALUES (?)", key)
        reservedKeys.push(key)
      }
      return reservedKeys
    })
  }

  private release(keys: string[]): void {
    this.ctx.storage.transactionSync(() => {
      for (const key of keys) {
        this.ctx.storage.sql.exec("DELETE FROM checkin_keys WHERE key = ?", key)
      }
    })
  }

  async checkin(
    attendee: CheckinAttendee,
    timestamp: number,
    accessToken?: string,
  ): Promise<"created" | "duplicate" | "failed"> {
    const dateKey = dateKeyInTimeZone(timestamp, this.env.TIME_ZONE)
    let token: string
    try {
      token = accessToken ?? await this.getAccessToken(this.env)
      await this.ensureInitialized(dateKey, token)
    } catch (error) {
      console.error(JSON.stringify({ message: "check-in guard initialization failed", error: String(error) }))
      return "failed"
    }

    const memberId = attendee.memberId ?? createMemberId()
    const emailKey = `email:${attendee.email}`
    const memberKey = `id:${memberId}`
    const checkKeys = attendee.memberId
      ? [memberKey, `legacy-email:${attendee.email}`]
      : [emailKey]
    const reservedKeys = this.reserve(checkKeys, [memberKey, emailKey])
    if (!reservedKeys) return "duplicate"

    try {
      await appendCheckin(this.env, token, { ...attendee, memberId }, timestamp)
      return "created"
    } catch (error) {
      this.release(reservedKeys)
      console.error(JSON.stringify({ message: "check-in append failed", error: String(error) }))
      return "failed"
    }
  }
}

import { DurableObject } from "cloudflare:workers"

import {
  appendCheckins,
  type CheckinEntry,
  checkinId,
  createCachedGoogleAccessTokenProvider,
  getGoogleAccessToken,
  readCheckinIds,
} from "./google"
import { sendAlert } from "../../src/events/alert-email"
import { createMemberId } from "./member-id"

type CheckinAttendee = {
  memberId: string | null
  name: string
  email: string
  affiliation: string
  phone: string
}

// How long to wait before copying check-ins to the Sheet again after a failure.
const RETRY_MS = 60_000
// How long copying can keep failing before an officer is emailed, once per outage.
const ALERT_AFTER_MS = 30 * 60_000

// A returning member is matched by member ID; a new attendee by email. Each event is checked into separately.
function duplicateKeys(attendee: CheckinAttendee, eventId: string): string[] {
  return [attendee.memberId ? `${eventId}|id:${attendee.memberId}` : `${eventId}|email:${attendee.email}`]
}

// One guard per night. It records each check-in in its own storage and confirms it right away, then
// copies check-ins to the Sheet in the background, retrying until Google accepts them.
export class CheckinGuard extends DurableObject<Env> {
  private readonly getAccessToken = createCachedGoogleAccessTokenProvider(getGoogleAccessToken)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS checkin_keys (key TEXT PRIMARY KEY)")
    // attempts counts appends sent; one that failed may still have reached the Sheet.
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS pending (seq INTEGER PRIMARY KEY AUTOINCREMENT, entry TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)",
    )
    // Guards used to seed themselves from the Sheet; that state is no longer needed.
    ctx.storage.sql.exec("DROP TABLE IF EXISTS guard_state")
  }

  private hasKey(key: string): boolean {
    return Array.from(this.ctx.storage.sql.exec("SELECT key FROM checkin_keys WHERE key = ?", key)).length > 0
  }

  // Whether this attendee already checked into the event. The kiosk asks before showing the
  // participant waiver, so nobody signs a second waiver only to be told they're already checked in.
  async isCheckedIn(attendee: CheckinAttendee, eventId: string): Promise<boolean> {
    return duplicateKeys(attendee, eventId).some((key) => this.hasKey(key))
  }

  async checkin(attendee: CheckinAttendee, eventId: string, timestamp: number): Promise<"created" | "duplicate"> {
    const memberId = attendee.memberId ?? createMemberId()
    const entry: CheckinEntry = { ...attendee, memberId, eventId, timestamp }
    const created = this.ctx.storage.transactionSync(() => {
      if (duplicateKeys(attendee, eventId).some((key) => this.hasKey(key))) return false
      for (const key of [`${eventId}|id:${memberId}`, `${eventId}|email:${attendee.email}`]) {
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO checkin_keys (key) VALUES (?)", key)
      }
      this.ctx.storage.sql.exec("INSERT INTO pending (entry) VALUES (?)", JSON.stringify(entry))
      return true
    })
    if (!created) return "duplicate"
    await this.ctx.storage.setAlarm(Date.now())
    return "created"
  }

  async alarm(): Promise<void> {
    await this.flush()
  }

  // Copies pending check-ins to the Sheet. Tests pass an access token.
  async flush(accessToken?: string): Promise<void> {
    const pending = Array.from(this.ctx.storage.sql.exec<{ seq: number; entry: string; attempts: number }>(
      "SELECT seq, entry, attempts FROM pending ORDER BY seq",
    ))
    if (!pending.length) return
    const lastSeq = pending.at(-1)!.seq
    try {
      const token = accessToken ?? await this.getAccessToken(this.env)
      let entries = pending.map(({ entry }) => JSON.parse(entry) as CheckinEntry)
      if (pending.some(({ attempts }) => attempts > 0)) {
        const present = await readCheckinIds(this.env, token)
        entries = entries.filter((entry) => !present.has(checkinId(entry.timestamp, entry.memberId)))
      }
      if (entries.length) {
        this.ctx.storage.sql.exec("UPDATE pending SET attempts = attempts + 1 WHERE seq <= ?", lastSeq)
        await appendCheckins(this.env, token, entries)
      }
      this.ctx.storage.sql.exec("DELETE FROM pending WHERE seq <= ?", lastSeq)
      await this.ctx.storage.delete(["failingSince", "alerted"])
    } catch (error) {
      console.error(JSON.stringify({ message: "check-in copy to Sheet failed", pending: pending.length, error: String(error) }))
      await this.ctx.storage.setAlarm(Date.now() + RETRY_MS)
      const failingSince = await this.ctx.storage.get<number>("failingSince") ?? Date.now()
      await this.ctx.storage.put("failingSince", failingSince)
      if (Date.now() - failingSince >= ALERT_AFTER_MS && !await this.ctx.storage.get("alerted")) {
        await this.alertStuck(pending.length, failingSince, error)
      }
    }
  }

  private async alertStuck(count: number, failingSince: number, error: unknown): Promise<void> {
    const since = new Intl.DateTimeFormat("en-US", { timeZone: this.env.TIME_ZONE, hour: "numeric", minute: "2-digit" })
      .format(failingSince)
    try {
      await sendAlert(this.env, "Check-ins aren't reaching the Google Sheet", [
        `The kiosk is still accepting check-ins and keeps them until the Sheet takes them. Copying them has failed since ${since}, and ${count} ${count === 1 ? "check-in is" : "check-ins are"} waiting.`,
        `Google's last error: ${String(error)}`,
        `Check that the Sheet still exists and is shared with ${this.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as an editor. The kiosk tries again every minute.`,
      ])
      await this.ctx.storage.put("alerted", true)
    } catch (alertError) {
      console.error(JSON.stringify({ message: "stuck check-in alert failed", error: String(alertError) }))
    }
  }
}

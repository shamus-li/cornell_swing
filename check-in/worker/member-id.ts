import { nanoid } from "nanoid"

export const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/

export function createMemberId(): string {
  return nanoid(12)
}

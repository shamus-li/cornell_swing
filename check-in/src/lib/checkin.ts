import { parsePhoneNumberFromString } from "libphonenumber-js"

export { isValidEmail } from "../../../src/lib/email"

export const AFFILIATIONS = [
  "Graduate/Professional Student",
  "Undergraduate Student",
  "Postdoc",
  "Faculty",
  "Staff",
  "Alumni",
  "Community Member",
] as const

// "Student" is a legacy tag: hidden from the form, but still valid so old
// Sheet rows keep syncing and existing Notion members keep resolving.
export type Affiliation = (typeof AFFILIATIONS)[number] | "Student"

// Form wording; Notion and the Sheet keep the shorter stored values.
export const AFFILIATION_LABELS: Record<Affiliation, string> = {
  "Graduate/Professional Student": "Cornell Graduate/Professional Student",
  "Undergraduate Student": "Cornell Undergraduate Student",
  Postdoc: "Cornell Postdoc",
  Faculty: "Cornell Faculty",
  Staff: "Cornell Staff",
  Alumni: "Cornell Alumni",
  "Community Member": "Community Member",
  Student: "Cornell Student",
}

export type Member = {
  id: string
  name: string
  email: string
  phone: string
  affiliation: Affiliation | ""
}

// Alumni no longer have Cornell accounts, so they sign the non-Cornell participant waiver like
// community members, before their check-in is recorded.
export const PARTICIPANT_WAIVER_AFFILIATIONS: Affiliation[] = ["Community Member", "Alumni"]

// A paragraph or bullet of the CampusGroups waiver, with its bold and italic text.
export type WaiverBlock = { list: boolean; runs: { text: string; bold: boolean; italic: boolean }[] }

// What a Cornell affiliate still needs to do after checking in.
export type NextSteps = { waiver: "cornell" | null; joinCampusGroups: boolean }

// Saves US numbers as (607) 555-1234 and others as +44 7911 123456; returns "" when the number
// can't exist.
export function normalizePhone(value: string): string {
  const phone = parsePhoneNumberFromString(value, "US")
  if (!phone?.isValid()) return ""
  return phone.country === "US" ? phone.formatNational() : phone.formatInternational()
}

// The phone field works in +16075550100 form, so a saved "(607) 555-0100" is converted to fill it in.
export function phoneNumberForInput(saved: string): string {
  return parsePhoneNumberFromString(saved, "US")?.number ?? ""
}

export function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ")
}

export function isValidName(value: string): boolean {
  const name = normalizeName(value)
  return name.length <= 160 && /\p{L}/u.test(name) && !/[\p{Cc}\p{Cs}]/u.test(name)
}

// A waiver signature must be the attendee's name, ignoring capitalization, spacing, and accents.
export function signatureMatchesName(signature: string, name: string): boolean {
  const simplify = (value: string) =>
    normalizeName(value).normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
  return simplify(signature) !== "" && simplify(signature) === simplify(name)
}

export function hasUnusualNameCapitalization(value: string): boolean {
  const casedLetters = [...normalizeName(value)]
    .filter((character) => character.toLowerCase() !== character.toUpperCase())
    .join("")
  return Boolean(casedLetters) && (
    casedLetters === casedLetters.toLowerCase() ||
    casedLetters === casedLetters.toUpperCase()
  )
}

export function isAffiliation(value: unknown): value is Affiliation {
  return value === "Student" || AFFILIATIONS.some((affiliation) => affiliation === value)
}

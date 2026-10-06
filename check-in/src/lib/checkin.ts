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

// What an attendee still needs to do after checking in.
export type NextSteps =
  | { waiver: "non-cornell" }
  | { waiver: "cornell" | null; joinCampusGroups: boolean }

// Formats US numbers as (607) 555-1234 and others as +<digits>; returns "" when it isn't a phone number.
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "")
  const us = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (!value.trim().startsWith("+") && us.length === 10) return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : ""
}

export function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ")
}

export function isValidName(value: string): boolean {
  const name = normalizeName(value)
  return name.length <= 160 && /\p{L}/u.test(name) && !/[\p{Cc}\p{Cs}]/u.test(name)
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

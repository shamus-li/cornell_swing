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

export type Member = {
  id: string
  name: string
  email: string
  affiliation: Affiliation | ""
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

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

export function isAffiliation(value: unknown): value is Affiliation {
  return value === "Student" || AFFILIATIONS.some((affiliation) => affiliation === value)
}

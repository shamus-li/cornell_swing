import Fuse from "fuse.js"

import type { Member } from "./checkin"

// By Member ID: how many nights the member came in the last four months, and the date they last came.
export type CheckinStats = Record<string, { nights: number; last: string }>

function nameWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const firstName = (member: Member) => member.name.split(" ")[0]

// Typo-tolerant name search; people type their name first, so emails aren't searched. Names with a
// word starting with each typed word come before typo matches. Within each group, the people who came
// most nights come first, then the most recent, then by first name.
export function searchMembers(members: Member[], query: string, stats: CheckinStats): Member[] {
  const typed = nameWords(query)
  const ranked = new Fuse(members, { keys: ["name"], threshold: 0.3, ignoreDiacritics: true })
    .search(query)
    .map(({ item }) => {
      const words = nameWords(item.name)
      const startsWithTyped = typed.every((word) => words.some((part) => part.startsWith(word)))
      return { member: item, startsWithTyped, ...(stats[item.id] ?? { nights: 0, last: "" }) }
    })
  return ranked
    .sort((left, right) =>
      Number(right.startsWithTyped) - Number(left.startsWithTyped) ||
      right.nights - left.nights ||
      right.last.localeCompare(left.last) ||
      firstName(left.member).localeCompare(firstName(right.member), undefined, { sensitivity: "base" }) ||
      left.member.name.localeCompare(right.member.name, undefined, { sensitivity: "base" }),
    )
    .slice(0, 8)
    .map(({ member }) => member)
}

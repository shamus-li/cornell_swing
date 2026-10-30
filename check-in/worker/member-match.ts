type Identity = { memberId: string | null; email: string; name: string }
type Candidate = { id: string; email: string; name: string }

// A check-in or waiver that could belong to more than one member. The message is shown at the kiosk.
export class MemberConflict extends Error {}

const sameName = (left: string, right: string) => left.toLocaleLowerCase() === right.toLocaleLowerCase()

// The one rule for linking a check-in or waiver to a member, used at the kiosk and by the nightly sync:
// 1. The member with this Member ID, unless the email belongs only to other members.
// 2. Otherwise the member with this email. Members who share an email are told apart by name.
// 3. Otherwise the one member with this name and no email, such as someone added by hand in Notion.
// Returns null for someone new.
export function matchMember<T extends Candidate>(members: T[], who: Identity): T | null {
  const emailMatches = members.filter((member) => member.email === who.email)
  const byId = who.memberId ? members.find((member) => member.id === who.memberId) : undefined
  if (byId) {
    if (emailMatches.length && !emailMatches.includes(byId)) {
      throw new MemberConflict("That email belongs to another member.")
    }
    return byId
  }
  if (emailMatches.length === 1) return emailMatches[0]
  if (emailMatches.length > 1) {
    const named = emailMatches.filter((member) => sameName(member.name, who.name))
    if (named.length === 1) return named[0]
    throw new MemberConflict("More than one member uses that email. Pick your name from the list.")
  }
  if (!who.name) return null
  const emailless = members.filter((member) => !member.email && sameName(member.name, who.name))
  if (emailless.length > 1) throw new MemberConflict("More than one member has that name. Pick your name from the list.")
  return emailless[0] ?? null
}

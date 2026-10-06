// The CampusGroups member export, stored for the check-in kiosk. The check-in worker reads this key and shape.
export const campusGroupsKey = 'campusgroups:v1'
export type CampusGroupsPerson = { member: boolean; generalRisk: boolean }
export type CampusGroupsData = { uploadedAt: string; people: Record<string, CampusGroupsPerson> }
export type CampusGroupsSummary = { uploadedAt: string | null; count: number | null; members: number | null; generalRisk: number | null }

// Academic years run August through July in Ithaca, so on 2026-10-06 the waiver tag is "AY 26/27 - General Risk".
export function generalRiskTag(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' }).formatToParts(now)
  const year = Number(parts.find(part => part.type === 'year')!.value)
  const start = Number(parts.find(part => part.type === 'month')!.value) >= 8 ? year : year - 1
  const short = (value: number) => String(value % 100).padStart(2, '0')
  return `AY ${short(start)}/${short(start + 1)} - General Risk`
}

export function buildCampusGroups(body: unknown, now = new Date()): CampusGroupsData {
  const rows = (body as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows) || rows.length > 20000) throw new Error('Upload a CampusGroups member export.')
  const tag = generalRiskTag(now)
  const people: Record<string, CampusGroupsPerson> = {}
  for (const row of rows as Record<string, unknown>[]) {
    if (typeof row?.email !== 'string' || typeof row.memberType !== 'string' || typeof row.tags !== 'string') throw new Error('Upload a CampusGroups member export.')
    const email = row.email.trim().toLowerCase()
    if (!email) continue
    const previous = people[email]
    people[email] = {
      member: row.memberType.trim() === 'Member' || !!previous?.member,
      generalRisk: row.tags.split('|').some(value => value.trim() === tag) || !!previous?.generalRisk,
    }
  }
  if (!Object.keys(people).length) throw new Error('The file has no member emails.')
  return { uploadedAt: now.toISOString(), people }
}

export function summarizeCampusGroups(data: CampusGroupsData | null): CampusGroupsSummary {
  if (!data) return { uploadedAt: null, count: null, members: null, generalRisk: null }
  const people = Object.values(data.people)
  return { uploadedAt: data.uploadedAt, count: people.length, members: people.filter(person => person.member).length, generalRisk: people.filter(person => person.generalRisk).length }
}

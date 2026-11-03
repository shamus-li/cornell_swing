// Shared by the worker and /manage.
// square is the connected Square account's business name.
export type SquareFeed = { square: string | null }

// The Balance Sheet's numbers, in dollars. check is another record of the account, and how much more it shows.
export type FinanceAccount = { name: string; start: number; moneyIn: number; moneyOut: number; balance: number; check: { source: string; difference: number } | null }
// grant is the part of spent paid from GPSA.
export type FinanceEvent = { id: string | null; name: string; date: string; earned: number; spent: number; grant: number }
// How a GPSA or Outside Funding row compares with the latest CampusGroups export. only-campusgroups rows aren't on the Balance Sheet.
export type TransactionStatus = "in-campusgroups" | "not-in-campusgroups" | "after-export" | "only-campusgroups"
// One movement of money, in dollars: money in is positive, and fee is what Square kept.
export type Transaction = { id: string; date: string; description: string; account: string; eventId: string | null; eventName: string | null; amount: number; fee: number; status: TransactionStatus | null }
export type FinanceOverview = { accounts: FinanceAccount[]; events: FinanceEvent[]; transactions: Transaction[]; campusGroupsUploadedAt: string | null }
export type CampusGroupsRow = { source: string; amount: string; paymentStatus: string; item: string; date: string }

// One event's money and who came. attendance is a headcount for events from before check-ins named their event.
export type EventActivity = {
  attendance: number | null
  tickets: { name: string; count: number; amount: number }[]
  transactions: Transaction[]
  checkins: { name: string; email: string; time: string; ticket: string | null }[]
}

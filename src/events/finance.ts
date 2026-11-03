// Shared by the worker and /manage.
export type SquarePayment = {
  id: string
  paidAt: string
  // Cents, net of refunds.
  amount: number
  cash: boolean
  note: string
  // The title of the event the payment was taken at.
  event: string | null
}

// square is the connected Square account's business name.
export type SquareFeed = { square: string | null; payments: SquarePayment[] }

// The Balance Sheet's numbers, in dollars. check is what another record says, and how far the sheet is from it.
export type FinanceAccount = { name: string; note: string; start: number; moneyIn: number; moneyOut: number; balance: number; check: { source: string; amount: number; difference: number } | null }
// people counts settled door tickets, which only exist for events that charged through check-in. grant is the part of spent paid from GPSA.
export type FinanceEvent = { name: string; date: string; people: number | null; earned: number; spent: number; grant: number }
// unassigned is expenses on the sheet with no account, which no balance includes.
export type FinanceOverview = { accounts: FinanceAccount[]; events: FinanceEvent[]; unassigned: { count: number; amount: number }; grantExpires: string; campusGroupsUploadedAt: string | null }

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

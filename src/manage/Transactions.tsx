import { useState } from "react"
import { Check, TriangleAlert } from "lucide-react"
import { Input } from "../../check-in/src/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../check-in/src/components/ui/select"
import { Card } from "../components/ui/card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table"
import type { Transaction, TransactionStatus } from "../events/finance"
import { todayInNewYork } from "../events/model"
import { money } from "./money"

const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const statusLabels: Record<TransactionStatus, string> = { "in-campusgroups": "In CampusGroups", "not-in-campusgroups": "Not in CampusGroups", "after-export": "After last export", "only-campusgroups": "Only in CampusGroups" }
const number = "text-right tabular-nums"
const wide = "hidden sm:table-cell"

// What the Balance Sheet holds: a row only in CampusGroups isn't counted.
export const onSheet = (item: Transaction) => item.status !== "only-campusgroups"

function daysAgo(days: number): string {
  const date = new Date(`${todayInNewYork()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
// The club's year starts Aug 1.
function clubYearStart(yearsAgo: number): string {
  const [year, month] = todayInNewYork().split("-").map(Number)
  return `${year - (month < 8 ? 1 : 0) - yearsAgo}-08-01`
}
const periods: { value: string; label: string; range: () => [string, string] }[] = [
  { value: "year", label: "This club year", range: () => [clubYearStart(0), "9999"] },
  { value: "last-year", label: "Last club year", range: () => [clubYearStart(1), clubYearStart(0)] },
  { value: "30", label: "Last 30 days", range: () => [daysAgo(30), "9999"] },
  { value: "all", label: "All time", range: () => ["", "9999"] },
]

export function TransactionsTable({ transactions, showEvent = true }: { transactions: Transaction[]; showEvent?: boolean }) {
  const counted = transactions.filter(onSheet)
  const total = (pick: (item: Transaction) => number) => counted.reduce((sum, item) => sum + pick(item), 0)
  return <Card><Table>
    <TableHeader><TableRow>
      <TableHead>Date</TableHead>
      <TableHead>Description</TableHead>
      {showEvent && <TableHead className={wide}>Event</TableHead>}
      <TableHead className={wide}>Account</TableHead>
      <TableHead className={wide}>CampusGroups</TableHead>
      <TableHead className={`${wide} text-right`}>Square fee</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow></TableHeader>
    <TableBody>{transactions.map(item => <TableRow key={item.id}>
      <TableCell className="whitespace-nowrap">{dateLabel.format(new Date(`${item.date}T00:00:00Z`))}</TableCell>
      <TableCell>{item.description}</TableCell>
      {showEvent && <TableCell className={wide}>{item.eventId ? <a href={`/manage/?event=${item.eventId}`}>{item.eventName}</a> : item.eventName}</TableCell>}
      <TableCell className={`${wide} whitespace-nowrap`}>{item.account}</TableCell>
      <TableCell className={wide}>{item.status && <span className={`finance-check${item.status === "in-campusgroups" || item.status === "after-export" ? "" : " is-off"}`}>{item.status === "in-campusgroups" ? <Check aria-hidden="true" /> : item.status !== "after-export" && <TriangleAlert aria-hidden="true" />}{statusLabels[item.status]}</span>}</TableCell>
      <TableCell className={`${wide} ${number}`}>{item.fee ? money(item.fee) : ""}</TableCell>
      <TableCell className={number}>{money(item.amount)}</TableCell>
    </TableRow>)}</TableBody>
    <TableFooter><TableRow>
      <TableCell colSpan={2} className="sm:hidden">Total on the Balance Sheet</TableCell>
      <TableCell colSpan={showEvent ? 5 : 4} className={wide}>Total on the Balance Sheet, {transactions.length} {transactions.length === 1 ? "row" : "rows"}</TableCell>
      <TableCell className={`${wide} ${number}`}>{money(total(item => item.fee))}</TableCell>
      <TableCell className={number}>{money(total(item => item.amount))}</TableCell>
    </TableRow></TableFooter>
  </Table></Card>
}

// Every transaction, narrowed by typing an event or description, the time period and the account.
export function Transactions({ transactions }: { transactions: Transaction[] }) {
  const [search, setSearch] = useState("")
  const [period, setPeriod] = useState("year")
  const [account, setAccount] = useState("all")
  const [from, to] = periods.find(item => item.value === period)!.range()
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = transactions.filter(item => {
    const text = `${item.description} ${item.eventName ?? ""} ${item.account}`.toLowerCase()
    return item.date >= from && item.date < to && (account === "all" || item.account === account) && words.every(word => text.includes(word))
  })
  const accounts = [...new Set(transactions.map(item => item.account))].sort()
  return <section aria-labelledby="finance-transactions-title">
    <div className="finance-heading">
      <h2 id="finance-transactions-title">Transactions</h2>
      <div className="finance-actions">
        <Input className="finance-search" type="search" aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={e => setSearch(e.target.value)} />
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger aria-label="Time period"><SelectValue /></SelectTrigger>
          <SelectContent>{periods.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={account} onValueChange={setAccount}>
          <SelectTrigger aria-label="Account"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All accounts</SelectItem>{accounts.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
    {shown.length ? <TransactionsTable transactions={shown} /> : <p className="event-muted">No transactions match.</p>}
  </section>
}

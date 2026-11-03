import { useState } from "react"
import { Check, TriangleAlert } from "lucide-react"
import { Input } from "../components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Card } from "../components/ui/card"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../components/ui/table"
import { clubYear, type Transaction, type TransactionStatus } from "../events/finance"
import { todayInNewYork } from "../events/model"
import { money } from "./money"

const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const statuses: Record<TransactionStatus, { word: string; title: string }> = {
  "in-campusgroups": { word: "", title: "In CampusGroups" },
  "not-in-campusgroups": { word: "Missing", title: "Not in CampusGroups" },
  "after-export": { word: "Newer", title: "Newer than the last CampusGroups export" },
  "only-campusgroups": { word: "Not on sheet", title: "In CampusGroups but not on the Balance Sheet" },
}
const number = "text-right tabular-nums"
const wide = "hidden sm:table-cell"

// What the Balance Sheet holds: a row only in CampusGroups isn't counted.
export const onSheet = (item: Transaction) => item.status !== "only-campusgroups"

function daysAgo(days: number): string {
  const date = new Date(`${todayInNewYork()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
export function TransactionsTable({ transactions, showEvent = true }: { transactions: Transaction[]; showEvent?: boolean }) {
  const counted = transactions.filter(onSheet)
  const total = (pick: (item: Transaction) => number) => counted.reduce((sum, item) => sum + pick(item), 0)
  // These columns only appear when a row has something to show: no export means no CampusGroups column.
  const showStatus = transactions.some(item => item.status)
  const showFee = transactions.some(item => item.fee)
  const rowCount = `${transactions.length} ${transactions.length === 1 ? "row" : "rows"}`
  const leading = 2 + (showEvent ? 1 : 0) + (showStatus ? 1 : 0)
  return <Card><Table>
    <TableHeader><TableRow>
      <TableHead>Date</TableHead>
      <TableHead>Description</TableHead>
      {showEvent && <TableHead className={wide}>Event</TableHead>}
      <TableHead className={wide}>Account</TableHead>
      {showStatus && <TableHead className={wide}>CampusGroups</TableHead>}
      {showFee && <TableHead className={`${wide} text-right`}>Square fee</TableHead>}
      <TableHead className="text-right">Amount</TableHead>
    </TableRow></TableHeader>
    <TableBody>{transactions.map(item => <TableRow key={item.id}>
      <TableCell className="whitespace-nowrap tabular-nums">{dateLabel.format(new Date(`${item.date}T00:00:00Z`))}</TableCell>
      <TableCell>{item.description}</TableCell>
      {showEvent && <TableCell className={wide}>{item.eventId ? <a href={`/manage/?event=${item.eventId}`}>{item.eventName}</a> : item.eventName}</TableCell>}
      <TableCell className={`${wide} whitespace-nowrap`}>{item.account}</TableCell>
      {showStatus && <TableCell className={wide}>{item.status && <span title={statuses[item.status].title} className={`finance-check${item.status === "in-campusgroups" || item.status === "after-export" ? "" : " is-off"}`}>{item.status === "in-campusgroups" ? <><Check aria-hidden="true" /><span className="sr-only">{statuses[item.status].title}</span></> : item.status !== "after-export" && <TriangleAlert aria-hidden="true" />}{statuses[item.status].word}</span>}</TableCell>}
      {showFee && <TableCell className={`${wide} ${number}`}>{item.fee ? money(item.fee) : ""}</TableCell>}
      <TableCell className={number}>{money(item.amount)}</TableCell>
    </TableRow>)}</TableBody>
    <TableFooter><TableRow>
      <TableCell colSpan={2} className="sm:hidden">{rowCount}</TableCell>
      <TableCell colSpan={leading + 1} className={wide}>{rowCount}</TableCell>
      {showFee && <TableCell className={`${wide} ${number}`}>{money(total(item => item.fee))}</TableCell>}
      <TableCell className={number}>{money(total(item => item.amount))}</TableCell>
    </TableRow></TableFooter>
  </Table></Card>
}

// Every transaction, narrowed by typing an event or description, the time period and the account.
export function Transactions({ transactions }: { transactions: Transaction[] }) {
  const [search, setSearch] = useState("")
  const [period, setPeriod] = useState(() => clubYear(todayInNewYork()))
  const [account, setAccount] = useState("all")
  const years = [...new Set([clubYear(todayInNewYork()), ...transactions.map(item => clubYear(item.date))])].sort().reverse()
  const recent = daysAgo(30)
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = transactions.filter(item => {
    const text = `${item.description} ${item.eventName ?? ""} ${item.account}`.toLowerCase()
    return (period === "all" || (period === "30" ? item.date >= recent : clubYear(item.date) === period)) && (account === "all" || item.account === account) && words.every(word => text.includes(word))
  })
  const accounts = [...new Set(transactions.map(item => item.account))].sort()
  return <section aria-labelledby="finance-transactions-title">
    <div className="finance-heading">
      <h2 id="finance-transactions-title">Transactions</h2>
      <div className="finance-actions">
        <Input className="finance-search" type="search" aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={e => setSearch(e.target.value)} />
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger aria-label="Time period"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All years</SelectItem>{years.map(year => <SelectItem key={year} value={year}>{year}</SelectItem>)}<SelectItem value="30">Last 30 days</SelectItem></SelectContent>
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

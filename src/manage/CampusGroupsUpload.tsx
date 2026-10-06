import { useEffect, useState, type ChangeEvent } from "react"
import Papa from "papaparse"
import { api, errorMessage } from "./api"
import { Input } from "../../check-in/src/components/ui/input"
import type { CampusGroupsSummary } from "../events/campusgroups"

const uploadedDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
const columns = ["Email", "Member Type", "User Tags"]

export function CampusGroupsUpload() {
  const [summary, setSummary] = useState<CampusGroupsSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    void api<CampusGroupsSummary>("/campusgroups", { signal: controller.signal }, "The member list could not be loaded.").then(setSummary).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [])

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setBusy(true); setError("")
    try {
      const { data, meta } = await new Promise<Papa.ParseResult<Record<string, string>>>((complete, error) => Papa.parse<Record<string, string>>(file, { header: true, skipEmptyLines: true, complete, error }))
      if (!columns.every(column => meta.fields?.includes(column))) throw new Error("Upload the member export CSV from CampusGroups.")
      const rows = data.map(row => ({ email: row.Email ?? "", memberType: row["Member Type"] ?? "", tags: row["User Tags"] ?? "" }))
      setSummary(await api<CampusGroupsSummary>("/campusgroups", { method: "PUT", body: JSON.stringify({ rows }) }, "The member list could not be uploaded. Please try again."))
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false); input.value = "" }
  }

  return <section className="sheet-connection" aria-labelledby="campusgroups-title">
    <h2 id="campusgroups-title">CampusGroups members</h2>
    <ol className="event-note campusgroups-steps">
      <li>Open <a href="https://cornell.campusgroups.com/members_list" target="_blank" rel="noreferrer">Members</a> in CampusGroups.</li>
      <li>Filter to all members and select all.</li>
      <li>Click Get Report and upload the CSV here.</li>
    </ol>
    {error && <p role="alert" className="event-error">{error}</p>}
    {!summary && !error && <p role="status" className="event-muted">Loading member list…</p>}
    {busy && <p role="status" className="event-muted">Uploading…</p>}
    {summary && <p className="event-note">{summary.uploadedAt ? `Uploaded ${uploadedDate.format(new Date(summary.uploadedAt))} · ${summary.count} people · ${summary.members} members · ${summary.generalRisk} General Risk waivers` : "No member list uploaded."}</p>}
    <div className="sheet-connection-form">
      <label>Member export CSV<Input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void upload(e)} /></label>
    </div>
  </section>
}

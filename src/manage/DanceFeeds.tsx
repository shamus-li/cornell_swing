import { useEffect, useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../check-in/src/components/ui/select"
import { danceStyles } from "../events/model"
import type { DanceFeed } from "../events/feeds"
import { ConfirmButton } from "./ConfirmButton"
import { api, errorMessage } from "./api"

const blank: DanceFeed = { id: "", name: "", style: "Contra", city: "Ithaca", siteUrl: "", feedUrl: "", skipTitles: "", eventPages: "", checkedAt: null, feedError: null }
const checked = (feed: DanceFeed) => feed.checkedAt ? `Checked ${new Date(feed.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not checked yet"

// Other groups' calendars, read each morning into the Special events list.
export function DanceFeeds() {
  const [feeds, setFeeds] = useState<DanceFeed[] | null>(null)
  const [error, setError] = useState("")
  // The id of the feed being edited, "" for a new one.
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api<{ feeds: DanceFeed[] }>("/dance-feeds", { signal: controller.signal }, "The calendar feeds could not be loaded.").then(data => setFeeds(data.feeds)).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(err))
    })
    return () => controller.abort()
  }, [])

  function accept(saved: DanceFeed) {
    setFeeds(current => [...current!.filter(feed => feed.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)))
    setEditing(null)
  }
  const form = (feed: DanceFeed) => <FeedForm key={feed.id || "new"} feed={feed} onSave={accept} onCancel={() => setEditing(null)} onRemove={() => { setFeeds(current => current!.filter(item => item.id !== feed.id)); setEditing(null) }} />

  return <section className="sheet-connection" aria-labelledby="dance-feeds-title">
    <div className="dance-feeds-title"><h2 id="dance-feeds-title">Calendar feeds</h2><Button variant="outline" disabled={!feeds || editing !== null} onClick={() => setEditing("")}>Add feed</Button></div>
    {error && <p role="alert" className="event-error">{error}</p>}
    {!feeds && !error && <p role="status" className="event-muted">Loading calendar feeds…</p>}
    {feeds && <div className="manage-list">
      {editing === "" && form(blank)}
      {feeds.map(feed => editing === feed.id ? form(feed) : <Button key={feed.id} variant="ghost" className="event-row-button" disabled={editing !== null} onClick={() => setEditing(feed.id)}>
        <span className="event-row-text"><strong>{feed.name}</strong><span className={feed.feedError ? "event-error" : "event-muted"}>{feed.feedError ?? checked(feed)}</span></span>
      </Button>)}
    </div>}
  </section>
}

function FeedForm({ feed, onSave, onCancel, onRemove }: { feed: DanceFeed; onSave: (feed: DanceFeed) => void; onCancel: () => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(feed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const change = (key: keyof DanceFeed, value: string) => setDraft(current => ({ ...current, [key]: value }))
  async function save() {
    setBusy(true); setError("")
    try {
      const { feed: saved } = await api<{ feed: DanceFeed }>(`/dance-feeds${feed.id ? `/${feed.id}` : ""}`, { method: feed.id ? "PUT" : "POST", body: JSON.stringify(draft) })
      onSave(saved)
    } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }
  return <form className="normal-event-edit" aria-label={feed.id ? `Edit ${feed.name} feed` : "New feed"} onSubmit={e => { e.preventDefault(); void save() }}>
    <div className="normal-event-fields">
      <label className="editor-row"><span>Group</span><Input required maxLength={120} value={draft.name} onChange={e => change("name", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Style</span><Select value={draft.style} onValueChange={value => change("style", value)} disabled={busy}>
        <SelectTrigger aria-label="Dance style"><SelectValue /></SelectTrigger>
        <SelectContent>{danceStyles.map(style => <SelectItem key={style} value={style}>{style}</SelectItem>)}</SelectContent>
      </Select></label>
      <label className="editor-row"><span>City</span><Input maxLength={80} value={draft.city} onChange={e => change("city", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Calendar</span><Input type="url" required maxLength={2000} placeholder="Calendar (.ics) link or CampusGroups club page" value={draft.feedUrl} onChange={e => change("feedUrl", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Website</span><Input type="url" maxLength={2000} placeholder="https://" value={draft.siteUrl} onChange={e => change("siteUrl", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Skip</span><Input maxLength={300} placeholder="Words that leave an event out, such as Practice, Class" value={draft.skipTitles} onChange={e => change("skipTitles", e.target.value)} disabled={busy} /></label>
      <label className="editor-row"><span>Pages</span><Input maxLength={2000} placeholder="Title words and their page: Lindy Jam https://…, Ball https://…" value={draft.eventPages} onChange={e => change("eventPages", e.target.value)} disabled={busy} /></label>
    </div>
    {error && <p role="alert" className="event-error">{error}</p>}
    <div className="normal-event-actions">
      <Button type="submit" disabled={busy}>{busy ? "Reading feed…" : "Save"}</Button>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      {feed.id && <span className="ml-auto"><ConfirmButton confirmLabel="Remove feed and its events" busyLabel="Removing…" disabled={busy} onConfirm={async () => { await api(`/dance-feeds/${feed.id}`, { method: "DELETE" }); onRemove() }}>Remove feed</ConfirmButton></span>}
    </div>
  </form>
}

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react"
import { createPortal } from "react-dom"
import { renderToStaticMarkup } from "react-dom/server"
import { Bold, Check, Copy, ExternalLink, GripVertical, Italic, Link, Plus, RotateCcw, Save, X } from "lucide-react"
import { Button } from "../components/ui/button"
import { Checkbox } from "../components/ui/checkbox"
import { ToggleChoice, ToggleGroupItem } from "../components/ui/toggle-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { formatEventDate, hasEventDetails, isUpcoming, ithacaArea, todayInNewYork, type EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { api, errorMessage } from "./api"
import { ConfirmButton } from "./ConfirmButton"
import { AnnouncementBlock, Card, CommunityBlock, EmailFrame, EventsBlock, FeaturedBlock, FooterBlock, GlanceBlock, GreetingBlock, InvolvedBlock, LessonBlock, longDate, PracticeBlock, SignOffBlock } from "./NewsletterEmail"

const none = "none"
type Placement = "featured" | "listed" | "out"
const placements: { value: Placement; label: string }[] = [{ value: "featured", label: "Featured" }, { value: "listed", label: "Listed" }, { value: "out", label: "Left out" }]
const shortDate = (event: Pick<EventRecord, "date">) => formatEventDate(event.date, { weekday: "short", month: "short", day: "numeric" })

// Parts that repeat every week. Organizers can save their edits to these for future newsletters.
type Part = "practice" | "involved" | "signoff" | "footer"
const partNames: Record<Part, string> = { practice: "the etiquette and practice note", involved: "the get involved note", signoff: "the sign-off", footer: "the footer" }
const builtIn: Record<Part, () => string> = {
  practice: () => renderToStaticMarkup(<PracticeBlock />),
  involved: () => renderToStaticMarkup(<InvolvedBlock />),
  signoff: () => renderToStaticMarkup(<SignOffBlock />),
  footer: () => renderToStaticMarkup(<FooterBlock />),
}
// Saved parts are organizer-written HTML shown inside the manager, so anything that could run code is dropped.
function clean(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.body.querySelectorAll("script, style, iframe, object, embed, form").forEach(element => element.remove())
  doc.body.querySelectorAll("*").forEach(element => {
    for (const { name, value } of [...element.attributes]) if (name.startsWith("on") || /^\s*javascript:/i.test(value)) element.removeAttribute(name)
  })
  return doc.body.innerHTML
}

function CopyButton({ label, copy, primary }: { label: string; copy: () => Promise<void>; primary?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function run() {
    await copy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return <Button variant={primary ? "default" : "outline"} onClick={() => void run()}>{copied ? <Check /> : <Copy />}{label}<span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span></Button>
}

// One editable part of the email. Its HTML is written only when the generated HTML or the key changes,
// so typing in it is kept until the event it was built from changes or the edits are reset.
// React would rewrite dangerouslySetInnerHTML on every render, losing the typing.
function Block({ html, part }: { html: string; part?: Part }) {
  const element = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { element.current!.innerHTML = html }, [html])
  return <div ref={element} className="newsletter-block" data-part={part} contentEditable suppressContentEditableWarning
    // Pasted text takes the email's formatting instead of the source's.
    onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")) }} />
}

// Builds the weekly newsletter from published events. Organizers edit it in place and paste it into Gmail.
// The copy buttons go in the page header, `actions`, where other tabs put their main action.
export function Newsletter({ events, outside, actions }: { events: EventRecord[]; outside: OutsideEvent[]; actions: HTMLElement | null }) {
  const today = todayInNewYork()
  const upcoming = events.filter(event => event.published && event.date >= today)
  const lessons = upcoming.filter(event => event.kind === "normal")
  const specials = upcoming.filter(event => event.kind === "special" && hasEventDetails(event))
  // The next lesson, which is this coming Monday's.
  const [lessonId, setLessonId] = useState(lessons[0]?.id ?? none)
  // The next special event is featured and later ones are listed under Coming up.
  const [placement, setPlacement] = useState<Record<string, Placement>>(() => Object.fromEntries(specials.map((event, index) => [event.id, index ? "listed" : "featured"])))
  // Other groups' dances stay out until an organizer ticks them.
  const [communityIds, setCommunityIds] = useState<string[]>([])
  const [nearby, setNearby] = useState(true)
  const [theme, setTheme] = useState(false)
  const [glanceShown, setGlanceShown] = useState(true)
  const [subject, setSubject] = useState<string | null>(null)
  // Section ids in the order the organizer chose; sections added later go where the default order puts them.
  const [order, setOrder] = useState<string[]>([])
  // Announcements the organizer adds.
  const [notes, setNotes] = useState<string[]>([])
  const noteCount = useRef(0)
  const [saved, setSaved] = useState<Partial<Record<Part, string>>>({})
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  // The section being dragged, and the gap it would drop into: 0 is above the first section.
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [activeLink, setActiveLink] = useState<HTMLAnchorElement | null>(null)
  // Bumped by "Reset edits" so every block is rebuilt from the events and the saved template.
  const [generation, setGeneration] = useState(0)
  const canvas = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<{ parts: Partial<Record<Part, string>> }>("/newsletter-template", undefined, "The saved template could not be loaded. The built-in text is shown.")
      .then(data => setSaved(Object.fromEntries(Object.entries(data.parts).map(([part, html]) => [part, clean(html)]))))
      .catch(err => setError(errorMessage(err)))
  }, [])
  // Confirmations fade after a few seconds; errors stay until the next save or restore works.
  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(""), 4000)
    return () => window.clearTimeout(timer)
  }, [status])
  const partHtml = (part: Part) => saved[part] ?? builtIn[part]()

  const lesson = lessons.find(event => event.id === lessonId)
  const featured = specials.filter(event => placement[event.id] === "featured")
  const listed = specials.filter(event => placement[event.id] === "listed")
  const communityEvents = outside.filter(event => event.published && isUpcoming(event, today))
  const community = communityEvents.filter(event => communityIds.includes(event.id))
  // The mailing list adds "[Swing Syndicate]" to every subject.
  const defaultSubject = [lesson && `${longDate(lesson.date)} Dance`, ...featured.map(event => event.title)].filter(Boolean).join(" & ") || "Weekly Newsletter"
  // Each section is one card. The lesson card ends with the etiquette and practice note, which organizers can save for future weeks.
  const sections = new Map<string, { name: string; key: string; html: string; part?: Part }>()
  const add = (id: string, name: string, key: string, element: ReactElement) => sections.set(id, { name, key, html: renderToStaticMarkup(element) })
  const glance = [lesson, ...featured, ...listed].filter((event): event is EventRecord => !!event).sort((a, b) => a.date.localeCompare(b.date))
  // With three events or fewer, the greeting and the sections already say it all.
  const glanceOn = glanceShown && glance.length >= 4
  if (glanceOn) add("glance", "This week and coming up", `glance-${glance.map(event => event.id).join()}`, <GlanceBlock events={glance} />)
  if (lesson) sections.set("lesson", { name: "Lesson", key: `lesson-${lesson.id}-${theme}`, html: renderToStaticMarkup(<LessonBlock lesson={lesson} theme={theme} />), part: "practice" })
  for (const event of featured) add(event.id, event.title, `featured-${event.id}`, <FeaturedBlock event={event} />)
  if (listed.length) add("events", "Coming up", `events-${listed.map(event => event.id).join()}-${glanceOn}`, <EventsBlock events={listed} title={glanceOn ? "Later this semester" : "Coming up"} />)
  if (community.length) add("community", "Community events", `community-${community.map(event => event.id).join()}`, <CommunityBlock events={community} />)
  for (const id of notes) add(id, "Announcement", id, <AnnouncementBlock />)
  const present = [...order.filter(id => sections.has(id)), ...[...sections.keys()].filter(id => !order.includes(id))]

  // Moves the section at `from` into the gap `to`, then keeps focus on its handle, which the move would otherwise drop.
  function move(from: number, to: number) {
    if (to < 0 || to > present.length || to === from || to === from + 1) return
    const next = [...present]
    const [id] = next.splice(from, 1)
    next.splice(to > from ? to - 1 : to, 0, id)
    setOrder(next)
    requestAnimationFrame(() => canvas.current?.querySelector<HTMLElement>(`[data-section="${id}"] .newsletter-handle`)?.focus())
  }
  // Dragging follows the pointer, which works for mouse, pen, and touch alike: the gap is the number of sections whose middle is above it.
  function dragTo(e: ReactPointerEvent) {
    if (dragging === null) return
    const middles = [...canvas.current!.querySelectorAll("[data-section]")].map(element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2 })
    setDropAt(middles.filter(middle => middle < e.clientY).length)
  }
  function endDrag() {
    if (dragging !== null && dropAt !== null) move(dragging, dropAt)
    setDragging(null); setDropAt(null)
  }
  // Adds an announcement into the gap `at`, between the sections already there.
  function addNote(at: number) {
    const id = `note-${++noteCount.current}`
    setNotes(current => [...current, id])
    setOrder([...present.slice(0, at), id, ...present.slice(at)])
  }
  // Removing an event's section also clears its choice in the sidebar, so the two always agree.
  function remove(id: string) {
    if (id === "lesson") setLessonId(none)
    else if (id === "glance") setGlanceShown(false)
    else if (id === "events") setPlacement(current => ({ ...current, ...Object.fromEntries(listed.map(event => [event.id, "out"])) }))
    else if (id === "community") setCommunityIds([])
    else if (placement[id]) setPlacement(current => ({ ...current, [id]: "out" }))
    else setNotes(current => current.filter(note => note !== id))
  }
  async function saveTemplate(part: Part) {
    const html = clean(canvas.current!.querySelector(`[data-part="${part}"]`)!.innerHTML)
    try {
      await api("/newsletter-template", { method: "PUT", body: JSON.stringify({ part, html }) })
      setSaved(current => ({ ...current, [part]: html })); setError(""); setStatus("Saved for future newsletters.")
    } catch (err) { setStatus(""); setError(errorMessage(err)) }
  }
  async function restoreTemplate(part: Part) {
    try {
      await api("/newsletter-template", { method: "DELETE", body: JSON.stringify({ part }) })
      setSaved(current => { const next = { ...current }; delete next[part]; return next })
      // The block's HTML may already match the built-in text after one-off edits, so it is rebuilt either way.
      canvas.current!.querySelector(`[data-part="${part}"]`)!.innerHTML = builtIn[part]()
      setError(""); setStatus("Restored the original text.")
    } catch (err) { setStatus(""); setError(errorMessage(err)) }
  }

  function emailHtml() {
    const copy = canvas.current!.cloneNode(true) as HTMLElement
    copy.querySelectorAll(".newsletter-chrome").forEach(element => element.remove())
    copy.querySelectorAll("[class], [contenteditable], [data-section], [data-part]").forEach(element => { for (const name of ["class", "contenteditable", "data-section", "data-part"]) element.removeAttribute(name) })
    return copy.innerHTML
  }
  // Gmail keeps the formatting and links of pasted HTML; the plain text is for places that take only text.
  const copyEmail = () => navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([emailHtml()], { type: "text/html" }),
    "text/plain": new Blob([[...canvas.current!.querySelectorAll<HTMLElement>(".newsletter-block")].map(block => block.innerText).join("\n\n")], { type: "text/plain" }),
  })])
  function addLink() {
    const url = window.prompt("Link address")
    if (url) document.execCommand("createLink", false, url)
  }
  function editLink(anchor: HTMLAnchorElement) {
    const url = window.prompt("Link address", anchor.getAttribute("href") ?? "")
    if (url) { anchor.setAttribute("href", url); setActiveLink(null); requestAnimationFrame(() => setActiveLink(anchor)) }
  }
  function unlink(anchor: HTMLAnchorElement) {
    anchor.replaceWith(...anchor.childNodes)
    setActiveLink(null)
  }

  const tool = (label: string, icon: ReactElement, onClick: () => void) => <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={onClick}>{icon}</Button>
  const templateTools = (part: Part) => <>
    {tool(`Save ${partNames[part]} for future newsletters`, <Save />, () => void saveTemplate(part))}
    {saved[part] !== undefined && tool(`Restore the original text of ${partNames[part]}`, <RotateCcw />, () => void restoreTemplate(part))}
  </>
  // Sits in the gap below a section, where hovering shows its button.
  const insert = (at: number) => <div className="newsletter-chrome newsletter-insert">
    <Button variant="outline" size="sm" onClick={() => addNote(at)}><Plus />Add announcement</Button>
  </div>
  function reset() {
    setSubject(null); setGlanceShown(true); setNotes([]); setOrder([]); setActiveLink(null); setGeneration(current => current + 1)
  }
  // The link bar sits under the link the organizer clicked, inside the scrolling email.
  const linkBox = activeLink && canvas.current?.contains(activeLink) ? (() => {
    const box = activeLink.getBoundingClientRect(), frame = canvas.current!.getBoundingClientRect()
    return { top: box.bottom - frame.top + 6, left: Math.max(8, box.left - frame.left) }
  })() : null

  return <div className="newsletter">
    {actions && createPortal(<>
      <CopyButton label="Copy subject" copy={() => navigator.clipboard.writeText(subject ?? defaultSubject)} />
      <CopyButton primary label="Copy email" copy={copyEmail} />
    </>, actions)}
    <aside className="newsletter-controls">
      <div className="newsletter-group">
        <label className="newsletter-field"><span>Lesson</span><Select value={lessonId} onValueChange={setLessonId}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={none}>None</SelectItem>
            {lessons.map(event => <SelectItem key={event.id} value={event.id}>{shortDate(event)}</SelectItem>)}
          </SelectContent>
        </Select></label>
        {lesson && <label className="newsletter-check"><Checkbox checked={theme} onCheckedChange={setTheme} />Secret social dance theme</label>}
      </div>
      {specials.length > 0 && <fieldset className="newsletter-field"><legend>Special events</legend>
        <ul className="newsletter-specials">{specials.map(event => <li key={event.id}>
          <span className="event-row-text"><span>{event.title}</span><span className="event-muted">{shortDate(event)}</span></span>
          <Select value={placement[event.id] ?? "out"} onValueChange={value => setPlacement(current => ({ ...current, [event.id]: value as Placement }))}>
            <SelectTrigger aria-label={`Show ${event.title}`}><SelectValue /></SelectTrigger>
            <SelectContent>{placements.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </li>)}</ul>
      </fieldset>}
      {communityEvents.length > 0 && <fieldset className="newsletter-field"><legend>Community events</legend>
        <ToggleChoice variant="segmented" aria-label="Area" value={nearby ? "ithaca" : "upstate"} onValueChange={area => setNearby(area === "ithaca")}>
          <ToggleGroupItem value="ithaca">Ithaca</ToggleGroupItem>
          <ToggleGroupItem value="upstate">All upstate</ToggleGroupItem>
        </ToggleChoice>
        <ul className="newsletter-specials newsletter-community">{communityEvents.filter(event => !nearby || ithacaArea.includes(event.city) || communityIds.includes(event.id)).map(event => <li key={event.id}>
          <label className="newsletter-check"><Checkbox checked={communityIds.includes(event.id)} onCheckedChange={checked => setCommunityIds(current => checked ? [...current, event.id] : current.filter(id => id !== event.id))} />
            <span className="event-row-text"><span>{event.title}</span><span className="event-muted">{shortDate(event)} · {event.groupName}</span></span></label>
        </li>)}</ul>
      </fieldset>}
      <div className="newsletter-actions">
        <Button variant="outline" onClick={() => addNote(present.length)}><Plus />Add announcement</Button>
        <ConfirmButton confirmLabel="Confirm" busyLabel="Resetting…" onConfirm={async () => reset()}>Reset edits</ConfirmButton>
      </div>
      {status && <p role="status" className="event-muted newsletter-status">{status}</p>}
      {error && <p role="alert" className="event-error newsletter-status">{error}</p>}
    </aside>
    <div className="newsletter-compose">
      <label className="newsletter-subject"><span>Subject</span><input value={subject ?? defaultSubject} onChange={e => setSubject(e.target.value)} /></label>
      {/* Buttons keep focus in the email, so the selection they format stays selected. */}
      <div className="newsletter-toolbar" role="toolbar" aria-label="Formatting" onMouseDown={e => e.preventDefault()}>
        <Button variant="ghost" size="icon" aria-label="Bold" onClick={() => document.execCommand("bold")}><Bold /></Button>
        <Button variant="ghost" size="icon" aria-label="Italic" onClick={() => document.execCommand("italic")}><Italic /></Button>
        <Button variant="ghost" size="icon" aria-label="Link" onClick={addLink}><Link /></Button>
      </div>
      <div ref={canvas} className="newsletter-canvas" data-dragging={dragging !== null || undefined}
        onClick={e => { const anchor = (e.target as Element).closest<HTMLAnchorElement>(".newsletter-block a"); if (anchor) e.preventDefault(); setActiveLink(anchor) }}
        onKeyDown={e => { if (e.key === "Escape") setActiveLink(null) }}>
        <EmailFrame>
          <div className="newsletter-section newsletter-greeting">
            <Block key={`greeting-${lesson?.id}-${featured.map(event => event.id).join()}-${generation}`} html={renderToStaticMarkup(<GreetingBlock lesson={lesson} featured={featured} />)} />
            {insert(0)}
          </div>
          {present.map((id, index) => {
            const section = sections.get(id)!
            return <div key={`${section.key}-${generation}`} data-section={id} className="newsletter-section" data-moving={dragging === index || undefined} data-drop={dropAt === index ? "before" : dropAt === present.length && index === present.length - 1 ? "after" : undefined}>
              <div className="newsletter-chrome newsletter-tools">
                {/* Drag the handle to move a section, or focus it and use the arrow keys. */}
                <Button variant="ghost" size="icon" className="newsletter-handle" aria-label={`Move ${section.name}`} title="Drag to move, or use the arrow keys"
                  onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(index) }}
                  onPointerMove={dragTo} onPointerUp={endDrag} onPointerCancel={() => { setDragging(null); setDropAt(null) }}
                  onKeyDown={e => {
                    if (e.key === "ArrowUp") { e.preventDefault(); move(index, index - 1) }
                    if (e.key === "ArrowDown") { e.preventDefault(); move(index, index + 2) }
                  }}><GripVertical /></Button>
                {tool(`Remove ${section.name}`, <X />, () => remove(id))}
              </div>
              <Card>
                <Block html={section.html} />
                {/* A saved part's tools sit beside it, not beside the whole card. */}
                {section.part && <div className="newsletter-part">
                  <div className="newsletter-chrome newsletter-tools">{templateTools(section.part)}</div>
                  <Block html={partHtml(section.part)} part={section.part} />
                </div>}
              </Card>
              {insert(index + 1)}
            </div>
          })}
          {(["involved", "signoff", "footer"] as const).map(part => <div key={`${part}-${generation}`} className="newsletter-section">
            <div className="newsletter-chrome newsletter-tools">{templateTools(part)}</div>
            <Block html={partHtml(part)} part={part} />
          </div>)}
        </EmailFrame>
        {linkBox && activeLink && <div className="newsletter-chrome newsletter-link" style={linkBox} onMouseDown={e => e.preventDefault()}>
          <a href={activeLink.href} target="_blank" rel="noreferrer"><ExternalLink />{activeLink.getAttribute("href")}</a>
          <Button variant="ghost" size="sm" onClick={() => editLink(activeLink)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => unlink(activeLink)}>Remove</Button>
        </div>}
      </div>
    </div>
  </div>
}

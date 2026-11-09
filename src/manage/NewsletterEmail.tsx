import type { CSSProperties, ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { formatEventDate, formatEventDayRange, formatEventLocation, formatEventPrices, formatEventTime, nightSpan, todayInNewYork, type EventRecord } from "../events/model"
import type { OutsideEvent } from "../events/outside"
import { parsePrograms } from "./NormalEventRow"

// Inline styles only, since Gmail keeps nothing else from pasted HTML.
// The website's warm ink, gray, and berry, with berry kept for things to click: links and the RSVP button.
// Each section is an outlined white card, so it is clear where one ends. The email has no page color of its own:
// Apple Mail's dark mode draws one as a lighter rectangle with hard edges inside its window.
const font = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const ink = "#232019"
const gray = "#5f5c55"
const berry = "#a13a5e"
const cardBorder = "#e6e4e0"
const text: CSSProperties = { margin: "0 0 16px", fontSize: 16, lineHeight: "24px" }
const meta: CSSProperties = { ...text, color: gray }
// Links in sentences are underlined, since berry alone is too close to the text color for some readers.
const link: CSSProperties = { color: berry, textDecoration: "underline" }
// Email clients drop hover styles from pasted HTML, so footer links are plain gray, as in Apple's and Stripe's footers.
const footerLink: CSSProperties = { color: gray, textDecoration: "none" }
const site = "https://swingsyndicate.club/"

// "November 2"
export const longDate = (date: string) => formatEventDate(date, { month: "long", day: "numeric" })
const fullDate = (date: string) => formatEventDate(date, { weekday: "long", month: "long", day: "numeric" })
// "8–10 PM", as the newsletters write times.
const time = (event: Pick<EventRecord, "startTime" | "endTime">) => formatEventTime(event).replaceAll(":00", "")
// "This Friday", "Next Monday", or "December 9", counted from today.
function relativeDay(date: string) {
  const days = Math.round((Date.parse(date) - Date.parse(todayInNewYork())) / 86400000)
  const weekday = formatEventDate(date, { weekday: "long" })
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 7 ? `This ${weekday}` : days < 14 ? `Next ${weekday}` : longDate(date)
}

function Place({ event }: { event: EventRecord }) {
  const place = formatEventLocation(event)
  return event.locationUrl ? <a href={event.locationUrl} style={{ color: gray, textDecoration: "underline" }}>{place}</a> : <>{place}</>
}

// Prices get their own line, labeled in words: no gray text symbol reads as a price, emoji stay in color,
// and Gmail drops the CSS that would gray them.
const Prices = ({ prices }: { prices: string[] }) => <><br />Tickets: {prices.join(", ")}</>

function EmailMarkdown({ children }: { children: string }) {
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    p: ({ children }) => <p style={text}>{children}</p>,
    a: ({ href, children }) => <a href={href} style={link}>{children}</a>,
    ul: ({ children }) => <ul style={{ ...text, paddingLeft: 24 }}>{children}</ul>,
    ol: ({ children }) => <ol style={{ ...text, paddingLeft: 24 }}>{children}</ol>,
    // Headings in an event description would compete with the newsletter's own, so they become bold lines.
    h1: ({ children }) => <p style={{ ...text, fontWeight: 700 }}>{children}</p>,
    h2: ({ children }) => <p style={{ ...text, fontWeight: 700 }}>{children}</p>,
    h3: ({ children }) => <p style={{ ...text, fontWeight: 700 }}>{children}</p>,
  }}>{children}</ReactMarkdown>
}

// A button built from a table cell, which every email client draws, unlike a styled link alone.
function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "8px 0 16px", borderCollapse: "separate" }}><tbody><tr>
    <td style={{ borderRadius: 6, backgroundColor: berry }}><a href={href} style={{ display: "inline-block", minWidth: 96, padding: "12px 28px", borderRadius: 6, color: "#ffffff", fontSize: 16, lineHeight: "20px", fontWeight: 600, textAlign: "center", textDecoration: "none" }}>{children}</a></td>
  </tr></tbody></table>
}

// A card built from a table, which email clients draw more reliably than a styled div. The bottom padding is smaller
// because the last paragraph already ends with a margin. Padding stays narrow so phones keep a wide text column.
export const Card = ({ children }: { children: ReactNode }) => <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ width: "100%", margin: "0 0 24px", borderCollapse: "separate", border: `1px solid ${cardBorder}`, borderRadius: 10, backgroundColor: "#ffffff" }}>
  <tbody><tr><td style={{ padding: "20px 20px 4px" }}>{children}</td></tr></tbody>
</table>
const Title = ({ children }: { children: ReactNode }) => <h2 style={{ margin: "0 0 8px", fontSize: 22, lineHeight: "28px", fontWeight: 700 }}>{children}</h2>

// A centered 600px column for the editable blocks.
export function EmailFrame({ children }: { children: ReactNode }) {
  return <table role="presentation" align="center" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ width: "100%", maxWidth: 600, margin: "0 auto", borderCollapse: "collapse", fontFamily: font, color: ink }}>
    <tbody><tr><td style={{ padding: "24px 8px" }}>{children}</td></tr></tbody>
  </table>
}

// The opening is the first text in the email, so inboxes show its hook as the preview.
export function GreetingBlock({ lesson, featured }: { lesson?: EventRecord; featured: EventRecord[] }) {
  const programs = lesson && parsePrograms(lesson.description)
  const topic = lesson?.lessonEndTime && programs && (programs.lesson || programs.advanced || programs.beginner)
  const parts = [
    lesson && `Monday we're ${topic ? `learning ${topic.charAt(0).toLowerCase()}${topic.slice(1)}` : "dancing"} at ${formatEventLocation(lesson)}`,
    ...featured.map(event => `${event.title} is ${relativeDay(event.date).replace(/^(This|Next) /, word => word.toLowerCase())}`),
  ].filter(Boolean)
  return <>
    <p style={text}>Hi dancers,</p>
    <p style={text}>{parts.length ? `${parts.join(", and ")}.` : "Here's what's happening this week."}</p>
  </>
}

// A weekly reader scans this first: one row per event, in date order.
export function GlanceBlock({ events }: { events: EventRecord[] }) {
  return <>
    <Title>This week and coming up</Title>
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ width: "100%", margin: "0 0 16px", borderCollapse: "collapse" }}><tbody>
      {events.map(event => <tr key={event.id}>
        <td style={{ width: 88, padding: "6px 12px 6px 0", verticalAlign: "top", fontSize: 15, lineHeight: "22px", fontWeight: 700, whiteSpace: "nowrap" }}>{formatEventDate(event.date, { weekday: "short", month: "short", day: "numeric" })}</td>
        <td style={{ padding: "6px 0", verticalAlign: "top", fontSize: 15, lineHeight: "22px" }}>{event.kind === "normal" ? lessonTitle(event) : event.title}<br /><span style={{ color: gray }}>{event.moreDays?.length ? formatEventDayRange(event) : time(nightSpan(event))} · {formatEventLocation(event)}</span></td>
      </tr>)}
    </tbody></table>
  </>
}

// The button closes the section, after the reader has the details and the description.
export function FeaturedBlock({ event }: { event: EventRecord }) {
  const prices = formatEventPrices(event)
  return <>
    <h2 style={{ margin: "0 0 8px", fontSize: 26, lineHeight: "32px", fontWeight: 700 }}>{event.title}</h2>
    <p style={meta}>{event.moreDays?.length ? formatEventDayRange(event) : <>{fullDate(event.date)} · {time(event)}</>}<br /><Place event={event} />{prices.length > 0 && <Prices prices={prices} />}</p>
    {event.description && <EmailMarkdown>{event.description}</EmailMarkdown>}
    <EmailButton href={event.slug ? `${site}events/${event.slug}` : site}>RSVP</EmailButton>
  </>
}

const lessonTitle = (lesson: EventRecord) => !lesson.lessonEndTime ? "Social dance" : parsePrograms(lesson.description).lesson ? "Lesson and social dance" : "Lessons and social dance"

// Lessons, when there are any, and the social dance, in the order they start.
export function LessonBlock({ lesson, theme }: { lesson: EventRecord; theme: boolean }) {
  const { lesson: topic, beginner, advanced, notes } = parsePrograms(lesson.description)
  const row: CSSProperties = { margin: "0 0 16px", fontSize: 16, lineHeight: "24px" }
  const social = <p style={row}><strong>{time({ ...lesson, startTime: lesson.socialStartTime || lesson.startTime })} · Social dance</strong>{theme && <><br />Secret theme: …</>}</p>
  const socialFirst = lesson.lessonEndTime && lesson.socialStartTime! < lesson.startTime
  return <>
    <Title>{lessonTitle(lesson)}</Title>
    <p style={meta}>{fullDate(lesson.date)} · <Place event={lesson} /></p>
    {socialFirst && social}
    {lesson.lessonEndTime && <p style={row}><strong>{time({ ...lesson, endTime: lesson.lessonEndTime })} · {topic ? "Lesson" : "Lessons"}</strong>
      {topic && <><br />{topic}</>}
      {advanced && <><br />{advanced} <span style={{ color: gray }}>(advanced)</span></>}
      {beginner && <><br />{beginner} <span style={{ color: gray }}>(beginner)</span></>}
    </p>}
    {!socialFirst && social}
    {notes && <EmailMarkdown>{notes}</EmailMarkdown>}
  </>
}

// The parts below are the same every week, so organizers can save their edits to them for future newsletters.
// The etiquette and practice note closes the lesson card.
export const PracticeBlock = () => <p style={meta}>New to social dancing? Read our <a href="https://docs.google.com/document/d/1zwoy4dJeol0Sn-cU7nSq2unUVubz5bL4pEyPB-T3sI4/edit?usp=sharing" style={link}>dance etiquette guidelines</a>. Want more practice? Come to open practice Sundays, 11 AM–12 PM, in the Garden Room at <a href="https://www.google.com/maps/place/Willard+Straight+Hall/@42.4465305,-76.4855642,703m/data=!3m2!1e3!4b1!4m6!3m5!1s0x89d0818966dd858d:0xdb77107b9b211095!8m2!3d42.4465305!4d-76.4855642!16zL20vMGgyd2Zn" style={link}>Willard Straight Hall</a>.</p>

// One entry per event, as campus digests list them: date and linked name, time and place, then the description.
export function EventsBlock({ events, title }: { events: EventRecord[]; title: string }) {
  return <>
    <Title>{title}</Title>
    {events.map(event => {
      const prices = formatEventPrices(event)
      return <div key={event.id} style={{ margin: "0 0 20px" }}>
        <p style={{ ...text, margin: 0 }}><strong>{event.moreDays?.length ? formatEventDayRange(event) : formatEventDate(event.date, { weekday: "short", month: "short", day: "numeric" })}:</strong> <a href={site} style={{ color: berry, textDecoration: "none", fontWeight: 700 }}>{event.title}</a></p>
        <p style={{ ...meta, margin: "0 0 8px" }}>{!event.moreDays?.length && <>{time(event)} · </>}<Place event={event} />{prices.length > 0 && <Prices prices={prices} />}</p>
        {event.description && <EmailMarkdown>{event.description}</EmailMarkdown>}
      </div>
    })}
  </>
}

// Other groups' dances, each linked to its own page.
export function CommunityBlock({ events }: { events: OutsideEvent[] }) {
  return <>
    <Title>Community events</Title>
    {events.map(event => <div key={event.id} style={{ margin: "0 0 20px" }}>
      <p style={{ ...text, margin: 0 }}><strong>{event.lastDate ? formatEventDayRange(event) : formatEventDate(event.date, { weekday: "short", month: "short", day: "numeric" })}:</strong> {event.url ? <a href={event.url} style={{ color: berry, textDecoration: "none", fontWeight: 700 }}>{event.title}</a> : <strong>{event.title}</strong>}</p>
      <p style={{ ...meta, margin: "0 0 8px" }}>{[!event.lastDate && event.startTime && time(event), formatEventLocation(event), event.groupName, event.price].filter(Boolean).join(" · ")}</p>
    </div>)}
  </>
}

// An announcement leads with a bold label, like "Shoes:" or "Board elections:".
export const AnnouncementBlock = () => <p style={text}><strong>Label:</strong> Write the announcement here.</p>

// Get involved sits on the page with the sign-off, as part of the closing note.
export const InvolvedBlock = () => <div style={{ margin: "32px 0 0" }}>
  <p style={text}><strong>Get involved:</strong> Tell us how we're doing in our anonymous <a href="https://docs.google.com/forms/d/e/1FAIpQLSdrJ13zuIyyfXErQbSKGwyf2q4Nv9ZRwD_-YvRKwc9LDPyqHQ/viewform?usp=dialog" style={link}>feedback form</a>, or apply to <a href="https://docs.google.com/forms/d/e/1FAIpQLSf27ZwwJBg9WEFZo4BTs8M0X3U237AfmnrwY4D27dp4D1SgTA/viewform?usp=dialog" style={link}>teach or DJ</a> with us.</p>
</div>

export const SignOffBlock = () => <p style={text}>See you on the dance floor!<br />– Swing Syndicate Team</p>

export const FooterBlock = () => <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: "18px", color: gray }}>
  <a href={site} style={footerLink}>Website</a> · <a href="https://www.instagram.com/cornell_swing/" style={footerLink}>Instagram</a> · <a href="https://www.facebook.com/CUSwingSyndicate" style={footerLink}>Facebook</a> · <a href="https://cornell.campusgroups.com/CGSDS/club_signup" style={footerLink}>CampusGroups</a><br />
  No longer dancing with us? <a href="https://lists.cornell.edu/GRAD-SWING-DANCE-L/subscribe/" style={footerLink}>Update your subscription</a>.
</p>

import { useEffect, useRef, useState, type FormEvent } from "react"
import { XIcon } from "lucide-react"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
import { largeButtonClass } from "../../check-in/src/lib/sizes"
import { StylePicker } from "../events/StylePicker"

const blank = { title: "", groupName: "", date: "", startTime: "", endTime: "", location: "", city: "Ithaca", price: "", url: "", email: "" }

// Lets anyone ask for a dance to be listed. Requests wait for an organizer in /manage.
export function RequestEvent() {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" variant="outline" aria-label="Request an event" onClick={() => setOpen(true)}><span className="request-long">Request an event</span><span className="request-short">Request</span></Button>
    {open && <RequestDialog onClose={() => setOpen(false)} />}
  </>
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [fields, setFields] = useState(blank)
  const [styles, setStyles] = useState<string[]>([])
  const [state, setState] = useState<"idle" | "saving" | "done">("idle")
  const [error, setError] = useState("")
  useEffect(() => {
    const element = dialog.current!
    // React removes the dialog before the browser can return focus, so focus goes back to the button by hand.
    const opener = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLInputElement>('input[name="title"]')!.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { element.close(); document.body.style.overflow = previous; opener?.focus() }
  }, [])
  const field = (name: keyof typeof blank) => ({ name, value: fields[name], onChange: (e: { target: { value: string } }) => setFields(current => ({ ...current, [name]: e.target.value })) })
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setState("saving"); setError("")
    try {
      const response = await fetch("/api/event-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, styles }) })
      const data = await response.json() as { error?: string }
      if (response.ok) { setState("done"); return }
      setError(data.error || "Your request could not be sent. Please try again.")
    } catch { setError("Check your connection and try again.") }
    setState("idle")
  }
  return <dialog ref={dialog} className="event-dialog" aria-labelledby="request-title" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <div className="event-dialog-body">
      <Button type="button" variant="ghost" size="icon" className="dialog-close" aria-label="Close request" onClick={onClose}><XIcon /></Button>
      <h2 id="request-title">{state === "done" ? "Thanks for the request!" : "Request an event"}</h2>
      {state === "done" ? <>
        <p className="event-muted">An organizer will review it before it appears on this page.</p>
        <Button type="button" autoFocus className={largeButtonClass} onClick={onClose}>Done</Button>
      </> : <form onSubmit={submit} className="event-form request-form">
        <label>Event<Input required maxLength={160} {...field("title")} /></label>
        <label>Group or host<Input required maxLength={120} {...field("groupName")} /></label>
        <div className="request-styles"><span>Dance styles</span><StylePicker value={styles} onChange={setStyles} /></div>
        <label>Date<Input type="date" required {...field("date")} /></label>
        <div className="request-times">
          <label>Starts<Input type="time" {...field("startTime")} /></label>
          <label>Ends<Input type="time" {...field("endTime")} /></label>
        </div>
        <div className="request-times">
          <label>Place<Input maxLength={300} {...field("location")} /></label>
          <label>City<Input maxLength={80} {...field("city")} /></label>
        </div>
        <label>Price<Input maxLength={100} {...field("price")} /></label>
        <label>Link<Input type="url" maxLength={2000} placeholder="https://" {...field("url")} /></label>
        <label>Your email<Input type="email" required maxLength={254} autoComplete="email" {...field("email")} /></label>
        {error && <p role="alert" className="event-error">{error}</p>}
        <Button type="submit" className={`mt-1 ${largeButtonClass}`} disabled={state === "saving"}>{state === "saving" ? "Sending…" : "Send request"}</Button>
      </form>}
    </div>
  </dialog>
}

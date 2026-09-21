import { useRef, useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog"

export function DeleteEventButton({ onDelete, disabled = false, includesRsvps = false, onBusyChange, kind = "event" }: {
  kind?: "event" | "rsvp"
  onDelete: () => Promise<void>
  disabled?: boolean
  includesRsvps?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const deleting = useRef(false)

  async function remove() {
    if (deleting.current || disabled) return
    deleting.current = true
    setBusy(true); setError("")
    onBusyChange?.(true)
    try {
      await onDelete()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "The event could not be deleted. Please try again.")
    } finally {
      deleting.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  return <AlertDialog open={open} onOpenChange={next => {
    if (deleting.current) return
    setOpen(next)
    if (next) setError("")
  }}>
    <AlertDialogTrigger asChild><Button type="button" variant={kind === "event" ? "destructive" : "outline"} size="default" disabled={disabled || busy}>{kind === "rsvp" ? "Remove" : "Delete event"}</Button></AlertDialogTrigger>
    <AlertDialogContent size="sm" aria-busy={busy}>
      <AlertDialogHeader>
        <AlertDialogTitle>{kind === "rsvp" ? "Remove RSVP?" : "Delete event?"}</AlertDialogTitle>
        <AlertDialogDescription>{kind === "rsvp" ? "This will remove the RSVP from the website and linked Google Sheet." : includesRsvps ? "This will permanently delete the event and its RSVPs." : "This will permanently delete the event."}</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel type="button" size="default" disabled={busy}>Cancel</AlertDialogCancel>
        <AlertDialogAction type="button" variant="destructive" size="default" disabled={disabled || busy} onClick={event => { event.preventDefault(); void remove() }}>{busy ? "Removing…" : kind === "rsvp" ? "Remove RSVP" : "Delete event"}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

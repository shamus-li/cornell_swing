import { useRef, useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog"
import { errorMessage } from "./api"

export function DeleteEventButton({ onDelete, disabled = false, includesRsvps = false, onBusyChange }: {
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
      setError(errorMessage(err))
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
    <AlertDialogTrigger asChild><Button type="button" variant="destructive" disabled={disabled || busy}>Delete event</Button></AlertDialogTrigger>
    <AlertDialogContent size="sm" aria-busy={busy}>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete event?</AlertDialogTitle>
        <AlertDialogDescription>{includesRsvps ? "This will permanently delete the event and its RSVPs." : "This will permanently delete the event."}</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
        <AlertDialogAction type="button" variant="destructive" disabled={disabled || busy} onClick={event => { event.preventDefault(); void remove() }}>{busy ? "Deleting…" : "Delete event"}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

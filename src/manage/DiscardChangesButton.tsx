import { useState, type ComponentProps } from "react"
import { Button } from "../../check-in/src/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog"

export function DiscardChangesButton({ dirty, onDiscard, children, ...props }: Omit<ComponentProps<typeof Button>, "onClick"> & { dirty: boolean; onDiscard: () => void }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button {...props} type="button" onClick={() => dirty ? setOpen(true) : onDiscard()}>{children}</Button>
    <DiscardChangesDialog open={open} onOpenChange={setOpen} onDiscard={onDiscard} />
  </>
}

export function DiscardChangesDialog({ open, onOpenChange, onDiscard }: { open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>Your changes will not be saved.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Keep editing</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onDiscard}>Discard changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
}

import { useState } from "react"
import { Button } from "../../check-in/src/components/ui/button"

// Asks for a second click in place; both labels share one width so the row never shifts.
export function ConfirmButton({ children, confirmLabel, busyLabel, onConfirm, disabled = false, size, "aria-label": ariaLabel }: {
  children: string
  confirmLabel: string
  busyLabel: string
  onConfirm: () => Promise<void>
  disabled?: boolean
  size?: "sm"
  "aria-label"?: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  async function click() {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false); setArmed(false) }
  }
  const label = busy ? busyLabel : armed ? confirmLabel : children
  return <Button type="button" size={size} variant={armed ? "destructive" : "outline"} disabled={disabled || busy} aria-label={armed || busy ? label : ariaLabel} onClick={() => void click()} onBlur={() => { if (!busy) setArmed(false) }} onKeyDown={e => { if (e.key === "Escape") setArmed(false) }} className="grid place-items-center">
    {[children, confirmLabel, busyLabel].map(text => <span key={text} className={`col-start-1 row-start-1 ${text === label ? "" : "invisible"}`} aria-hidden={text !== label}>{text}</span>)}
  </Button>
}

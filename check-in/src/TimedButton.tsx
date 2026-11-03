import { useEffect } from "react"

import { Button } from "@shared/components/ui/button"
import { largeButtonClass } from "@shared/lib/sizes"

export const KIOSK_TIMEOUT_MS = 30_000

// Runs onClick by itself after 30 seconds, lightening from the right as the time runs out, so the kiosk
// returns to a blank form when nobody taps it.
export function TimedButton({ onClick, children }: { onClick: () => void; children: string }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClick, KIOSK_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [])
  return (
    <Button className={`relative overflow-hidden ${largeButtonClass}`} onClick={onClick}>
      <span
        aria-hidden="true"
        className="absolute inset-0 origin-right bg-white/35"
        style={{ animation: `confirmation-timer ${KIOSK_TIMEOUT_MS}ms linear forwards` }}
      />
      <span className="relative">{children}</span>
    </Button>
  )
}

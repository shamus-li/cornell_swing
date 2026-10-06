import { FormEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { FloatingField, floatingInputClass } from "@/components/ui/floating-field"
import { Input } from "@/components/ui/input"
import { largeButtonClass } from "@/lib/sizes"

type WaiverText = { paragraphs: string[]; eventName: string }

// Cornell's non-Cornell participant waiver, signed on the kiosk and submitted to CampusGroups by the server.
export function NonCornellWaiver({
  name,
  email,
  phone,
  onDone,
}: {
  name: string
  email: string
  phone: string
  onDone: () => void
}) {
  const [waiver, setWaiver] = useState<WaiverText | null>(null)
  const [signature, setSignature] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signed, setSigned] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch("api/waiver", { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as WaiverText & { message?: string }
        if (!response.ok) throw new Error(payload.message || "Couldn't load the waiver.")
        setWaiver(payload)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setMessage(error instanceof Error ? error.message : "Couldn't load the waiver.")
      })
    return () => controller.abort()
  }, [])

  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!signature.trim()) {
      setMessage("Type your full name to sign.")
      return
    }
    setMessage("")
    setIsSubmitting(true)
    try {
      const response = await fetch("api/waiver", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, email, phone, signature }),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) throw new Error(payload.message || "Couldn't submit the waiver. Try again.")
      setSigned(true)
    } catch (error) {
      setMessage(
        error instanceof TypeError
          ? "Couldn't reach the server. Check the Wi-Fi connection and try again."
          : error instanceof Error
            ? error.message
            : "Couldn't submit the waiver. Try again.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  if (signed) {
    return (
      <>
        <p className="text-lg">Waiver signed.</p>
        <Button className={largeButtonClass} onClick={onDone}>
          Check in another person
        </Button>
      </>
    )
  }

  return (
    <form className="w-full space-y-4 text-left" noValidate onSubmit={sign}>
      <h2 className="font-sans text-xl font-semibold">Sign the participant waiver</h2>
      {waiver && (
        <>
          <div className="max-h-[45svh] space-y-3 overflow-y-auto rounded-xl bg-muted p-4 text-sm leading-relaxed">
            {waiver.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{name}</dd>
            <dt className="text-muted-foreground">Phone</dt>
            <dd>{phone}</dd>
            <dt className="text-muted-foreground">Event</dt>
            <dd>{waiver.eventName}</dd>
            <dt className="text-muted-foreground">Host</dt>
            <dd>Swing Syndicate at Cornell</dd>
          </dl>
          <FloatingField id="signature" label="Type your full name to sign" filled={!!signature}>
            <Input
              id="signature"
              className={floatingInputClass}
              autoComplete="off"
              autoCapitalize="words"
              data-1p-ignore
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              aria-invalid={message === "Type your full name to sign."}
            />
          </FloatingField>
          <Button className={`w-full ${largeButtonClass}`} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing…" : "Sign waiver"}
          </Button>
        </>
      )}
      {!waiver && !message && <p className="text-muted-foreground">Loading the waiver…</p>}
      <p className="text-destructive text-base" role="alert">
        {message}
      </p>
      <Button className="w-full" type="button" variant="link" onClick={onDone}>
        Skip
      </Button>
    </form>
  )
}

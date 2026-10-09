import { FormEvent, useEffect, useRef, useState } from "react"

import participantWaiverQrUrl from "../../assets/participant-waiver-qr.png"

import { Button } from "@/components/ui/button"
import { FloatingField, floatingInputClass } from "@/components/ui/floating-field"
import { Input } from "@/components/ui/input"
import { QrCallout } from "@/components/ui/qr-callout"
import { signatureMatchesName, type WaiverBlock } from "@/lib/checkin"
import { largeButtonClass } from "@/lib/sizes"

type WaiverText = { blocks: WaiverBlock[]; eventName: string }
type WaiverResult = { waiver: WaiverText } | { formChanged: true } | { unavailable: true }
type WaiverResponse = WaiverText & { message?: string; formChanged?: boolean; unavailable?: boolean }

let pendingWaiver: Promise<WaiverResult> | null = null

// Starts loading the waiver while the attendee is still filling in the form, so the waiver screen
// opens with the text ready. A failed load is retried for the next attendee.
export function preloadWaiver(): Promise<WaiverResult> {
  pendingWaiver ??= fetch("api/waiver", { headers: { Accept: "application/json" } }).then(async (response) => {
    const payload = (await response.json()) as WaiverResponse
    if (payload.formChanged) return { formChanged: true as const }
    if (payload.unavailable) {
      pendingWaiver = null
      return { unavailable: true as const }
    }
    if (!response.ok) throw new Error(payload.message || "Couldn't load the waiver.")
    return { waiver: payload }
  })
  pendingWaiver.catch(() => {
    pendingWaiver = null
  })
  return pendingWaiver
}

// The event name changes by day, so each attendee gets a fresh load.
export function forgetWaiver(): void {
  pendingWaiver = null
}

// Cornell's non-Cornell participant waiver, signed on the kiosk before the check-in is recorded and
// submitted to CampusGroups by the server. When the CampusGroups form has changed, the server emails
// an officer and the kiosk checks the attendee in without the waiver. When CampusGroups is down, the
// attendee signs the same waiver on their phone instead.
export function NonCornellWaiver({
  name,
  email,
  phone,
  onBack,
  onComplete,
}: {
  name: string
  email: string
  phone: string
  onBack: () => void
  // Records the check-in; returns an error message when it fails.
  onComplete: () => Promise<string | null>
}) {
  const [waiver, setWaiver] = useState<WaiverText | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [signature, setSignature] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [signOnPhone, setSignOnPhone] = useState(false)
  // Retrying after a failed check-in must not submit the waiver to CampusGroups twice.
  const signed = useRef(false)

  // onComplete runs here only when the form changed.
  useEffect(() => {
    let active = true
    preloadWaiver()
      .then(async (result) => {
        if (!active) return
        if ("waiver" in result) return setWaiver(result.waiver)
        if ("unavailable" in result) return setSignOnPhone(true)
        const error = await onComplete()
        if (error) setMessage(error)
      })
      .catch((error: unknown) => {
        if (!active) return
        setMessage(
          error instanceof TypeError
            ? "Couldn't reach the server. Check the Wi-Fi connection and try again."
            : error instanceof Error
              ? error.message
              : "Couldn't load the waiver.",
        )
      })
    return () => {
      active = false
    }
  }, [])

  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!signatureMatchesName(signature, name)) {
      setMessage(`Sign with your full name: ${name}`)
      return
    }
    setMessage("")
    setIsSubmitting(true)
    try {
      if (!signed.current) {
        const response = await fetch("api/waiver", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ name, email, phone, signature }),
        })
        const payload = (await response.json().catch(() => ({}))) as WaiverResponse
        if (payload.unavailable) return setSignOnPhone(true)
        if (!response.ok && !payload.formChanged) throw new Error(payload.message || "Couldn't submit the waiver. Try again.")
        signed.current = true
      }
      const error = await onComplete()
      if (error) setMessage(error)
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

  async function checkInAfterSigningOnPhone() {
    setMessage("")
    setIsSubmitting(true)
    const error = await onComplete()
    if (error) setMessage(error)
    setIsSubmitting(false)
  }

  if (signOnPhone) {
    return (
      <div className="space-y-4">
        <QrCallout
          title="Sign the participant waiver"
          detail="The waiver can't be signed on this screen right now. Scan to sign it on your phone, then check in."
          src={participantWaiverQrUrl}
        />
        <Button className={`w-full ${largeButtonClass}`} onClick={checkInAfterSigningOnPhone} disabled={isSubmitting}>
          {isSubmitting ? "Checking in…" : "Check in"}
        </Button>
        <Button className={`w-full ${largeButtonClass}`} variant="outline" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <p className="text-destructive text-base" role="alert">
          {message}
        </p>
      </div>
    )
  }

  return (
    <form className="space-y-4" noValidate onSubmit={sign}>
      {waiver && (
        <>
          <h1 className="text-[1.75rem] leading-tight font-semibold">
            {waiver.blocks[0].runs.map((run) => run.text).join("")}
          </h1>
          <div className="rounded-xl bg-muted p-4">
            <div
              className={`space-y-3 text-sm leading-relaxed ${expanded ? "" : "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"}`}
            >
              <WaiverBody blocks={waiver.blocks.slice(1)} />
            </div>
            <Button className="mt-2 h-auto px-0" type="button" variant="link" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Read the full waiver"}
            </Button>
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
              aria-invalid={message.startsWith("Sign with your full name")}
            />
          </FloatingField>
          <Button className={`w-full ${largeButtonClass}`} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing…" : "Sign and check in"}
          </Button>
        </>
      )}
      <Button className={`w-full ${largeButtonClass}`} type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
        Back
      </Button>
      <p className="text-destructive text-base" role="alert">
        {message}
      </p>
    </form>
  )
}

function WaiverRuns({ block }: { block: WaiverBlock }) {
  return block.runs.map((run, index) => {
    const text = run.italic ? <em>{run.text}</em> : run.text
    return run.bold ? <strong key={index}>{text}</strong> : <span key={index}>{text}</span>
  })
}

// Paragraphs and bullet lists styled as CampusGroups shows them.
function WaiverBody({ blocks }: { blocks: WaiverBlock[] }) {
  const groups: WaiverBlock[][] = []
  for (const block of blocks) {
    const group = groups.at(-1)
    if (block.list && group?.[0].list) group.push(block)
    else groups.push([block])
  }
  return groups.map((group, index) =>
    group[0].list ? (
      <ul key={index} className="list-disc space-y-1 pl-5">
        {group.map((block, item) => (
          <li key={item}>
            <WaiverRuns block={block} />
          </li>
        ))}
      </ul>
    ) : (
      <p key={index}>
        <WaiverRuns block={group[0]} />
      </p>
    ),
  )
}

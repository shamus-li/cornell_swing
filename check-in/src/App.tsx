import { FormEvent, useEffect, useRef, useState } from "react"

import campusGroupsQrUrl from "../../assets/campusgroups-qr.png"

import { SiteBrand } from "@shared/site/components/SiteBrand"
import { Button } from "@shared/components/ui/button"
import { largeButtonClass } from "@shared/lib/sizes"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@shared/components/ui/combobox"
import { FloatingField, floatingInputClass } from "@shared/components/ui/floating-field"
import { Input } from "@shared/components/ui/input"
import { Person } from "@shared/components/ui/person"
import { QrCallout } from "@shared/components/ui/qr-callout"
import PhoneInput from "react-phone-number-input/input"
import { Payment } from "@/Payment"
import { TimedButton } from "@/TimedButton"
import { forgetWaiver, GeneralRiskWaiver, NonCornellWaiver, preloadWaiver } from "@/Waiver"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/components/ui/select"
import {
  AFFILIATION_LABELS,
  AFFILIATIONS,
  eventQuery,
  hasUnusualNameCapitalization,
  isConnectionError,
  isValidEmail,
  isValidName,
  normalizeName,
  normalizePhone,
  phoneNumberForInput,
  PARTICIPANT_WAIVER_AFFILIATIONS,
  REQUEST_TIMEOUT_MS,
  type Affiliation,
  type Attendee,
  type DoorTicket,
  type EventChoice,
  type Member,
  type NextSteps,
} from "@/lib/checkin"

type MembersResponse = {
  members?: Member[]
}

const MEMBER_SEARCH_DELAY_MS = 75
const MEMBER_SEARCH_CACHE_LIMIT = 12
const IDLE_RESET_MS = 90_000
const EVENTS_REFRESH_MS = 60_000
const NO_RESULTS = { key: "", members: [], failed: false }

function memberSearchKey(query: string): string {
  return query.toLocaleLowerCase()
}

function MemberResults() {
  return (
    <ComboboxContent>
      <ComboboxList>
        {(member: Member) => (
          <ComboboxItem key={member.id} value={member} className="items-start px-3 py-2.5">
            <Person
              name={member.name}
              detail={[member.email, member.affiliation && AFFILIATION_LABELS[member.affiliation]]
                .filter(Boolean)
                .join(" · ")}
            />
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxContent>
  )
}

export default function App() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [affiliation, setAffiliation] = useState<Affiliation | "">("")
  // Tagged with the search they answer so "Don't see your name?" waits for the current results.
  const [results, setResults] = useState<{ key: string; members: Member[]; failed: boolean }>(NO_RESULTS)
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [memberSearchOpen, setMemberSearchOpen] = useState(false)
  const [nameFocused, setNameFocused] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [confirmation, setConfirmation] = useState<string | null>(() =>
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "success"
      ? "Checked in!"
      : null,
  )
  const [next, setNext] = useState<NextSteps | null>(null)
  const [waiverAttendee, setWaiverAttendee] = useState<Attendee | null>(null)
  const [payment, setPayment] = useState<{ attendee: Attendee; event: string; tickets: DoorTicket[] } | null>(null)
  // Null until the day's events have loaded.
  const [choices, setChoices] = useState<EventChoice[] | null>(null)
  // Stays chosen from one attendee to the next; reloading the page asks again.
  const [pickedEvent, setPickedEvent] = useState<string | null>(null)
  const memberSearchCache = useRef(new Map<string, Member[]>())

  const severalEvents = !!choices && choices.length > 1
  const eventId = severalEvents && choices.some((option) => option.id === pickedEvent) ? pickedEvent : null

  useEffect(() => {
    if (affiliation && PARTICIPANT_WAIVER_AFFILIATIONS.includes(affiliation)) preloadWaiver(eventId).catch(() => {})
  }, [affiliation, eventId])

  // Only refreshed while the form is empty, so the event can't change under someone checking in.
  const hasEntry = !!(name || email || phone || affiliation || waiverAttendee || payment)
  const isIdle = !hasEntry && !confirmation
  useEffect(() => {
    if (!isIdle) return
    let active = true
    const load = async () => {
      try {
        const response = await fetch("api/events", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        if (!response.ok) throw new Error(`Events request failed with ${response.status}`)
        const payload = (await response.json()) as { events: EventChoice[] }
        if (active) setChoices(payload.events)
      } catch (error) {
        console.error(error)
        // Check-in never stops at the door: without the list, the server goes by the time.
        if (active) setChoices((current) => current ?? [])
      }
    }
    void load()
    const interval = window.setInterval(load, EVENTS_REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [isIdle])

  const query = name.trim()
  const searchKey = memberSearchKey(query)
  const showNoMatches = !selectedMember && !!query && results.key === searchKey && results.members.length === 0
  const showNameCasePrompt =
    nameTouched && !nameFocused && hasUnusualNameCapitalization(name)
  useEffect(() => {
    if (selectedMember || !query) {
      setResults(NO_RESULTS)
      setMemberSearchOpen(false)
      return
    }

    const cached = memberSearchCache.current.get(searchKey)
    if (cached) {
      setResults({ key: searchKey, members: cached, failed: false })
      setMemberSearchOpen(true)
      return
    }

    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("api/members", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ q: query }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Member request failed with ${response.status}`)

        const payload = (await response.json()) as MembersResponse
        const matches = (payload.members ?? []).slice(0, 8)
        if (!active) return

        memberSearchCache.current.set(searchKey, matches)
        if (memberSearchCache.current.size > MEMBER_SEARCH_CACHE_LIMIT) {
          const oldestKey = memberSearchCache.current.keys().next().value
          if (oldestKey) memberSearchCache.current.delete(oldestKey)
        }
        setResults({ key: searchKey, members: matches, failed: false })
        setMemberSearchOpen(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (!active) return
        console.error(error)
        setResults({ key: searchKey, members: [], failed: true })
        setMemberSearchOpen(false)
      }
    }, MEMBER_SEARCH_DELAY_MS)

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query, searchKey, selectedMember])

  function clearSelectedMember() {
    setSelectedMember(null)
    setName("")
    setEmail("")
    setPhone("")
    setAffiliation("")
    setResults(NO_RESULTS)
    memberSearchCache.current.clear()
    setMemberSearchOpen(false)
    setNameTouched(false)
    setMessage("")
  }

  function chooseMember(member: Member | null) {
    if (!member) return
    setSelectedMember(member)
    memberSearchCache.current.clear()
    setNameTouched(false)

    setName(member.name)
    setEmail(member.email)
    setPhone(phoneNumberForInput(member.phone))
    setAffiliation(AFFILIATIONS.some((option) => option === member.affiliation) ? member.affiliation : "")
    setMemberSearchOpen(false)
    setMessage("")
  }

  async function submitCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")

    const normalizedName = normalizeName(name)
    setName(normalizedName)
    if (!isValidName(normalizedName)) {
      setNameTouched(true)
      setMessage("Enter your full name.")
      return
    }

    if (!isValidEmail(email.trim())) {
      setMessage("Enter a valid email.")
      return
    }
    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone) {
      setMessage("Enter a valid phone number.")
      return
    }
    if (!affiliation) {
      setMessage("Choose an affiliation.")
      return
    }

    const attendee = {
      memberId: selectedMember?.id || null,
      name: normalizedName,
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      affiliation,
    }
    setIsSubmitting(true)
    // Someone already checked in tonight goes straight to "Already checked in" instead of seeing a waiver again.
    const status = await checkinStatus(attendee)
    if (typeof status === "string") {
      setMessage(status)
    } else if (status.checkedIn) {
      setNext(status.next)
      setConfirmation("Already checked in")
    } else if (status.next.waiver === "cornell" || PARTICIPANT_WAIVER_AFFILIATIONS.includes(affiliation)) {
      setWaiverAttendee(attendee)
    } else {
      const error = await checkIn(attendee)
      if (error) setMessage(error)
    }
    setIsSubmitting(false)
  }

  // Asks whether the attendee already checked in tonight and what they still need to do; returns an
  // error message when it can't tell.
  async function checkinStatus(attendee: Attendee): Promise<{ checkedIn: boolean; next: NextSteps } | string> {
    try {
      const response = await fetch(`api/checkins/status${eventQuery(eventId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(attendee),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string; checkedIn: boolean; next: NextSteps }
      if (!response.ok) throw new Error(payload.message || "Check-in failed")
      return payload
    } catch (error) {
      console.error(error)
      return isConnectionError(error)
        ? "Couldn't reach the server. Check the Wi-Fi connection and try again."
        : error instanceof Error
          ? error.message
          : "Check-in failed. Please try again."
    }
  }

  // Records the check-in and shows the confirmation; returns an error message when it fails.
  async function checkIn(attendee: Attendee): Promise<string | null> {
    try {
      const response = await fetch(`api/checkins${eventQuery(eventId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(attendee),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string; next?: NextSteps; event?: string; tickets?: DoorTicket[] }
      if (response.status === 402) {
        setWaiverAttendee(null)
        setPayment({ attendee, event: payload.event!, tickets: payload.tickets! })
        return null
      }
      if (!response.ok && response.status !== 409) {
        throw new Error(payload.message || "Check-in failed")
      }

      setNext(payload.next ?? null)
      setWaiverAttendee(null)
      const firstName = attendee.name.split(/\s+/)[0]
      setConfirmation(
        response.status === 409
          ? "Already checked in"
          : firstName
            ? `Checked in, ${firstName}!`
            : "Checked in!",
      )
      return null
    } catch (error) {
      console.error(error)
      return isConnectionError(error)
        ? "Couldn't reach the server. Check the Wi-Fi connection and try again."
        : error instanceof Error
          ? error.message
          : "Check-in failed. Please try again."
    }
  }

  function confirmPayment(attendee: Attendee, steps: NextSteps | null) {
    const firstName = attendee.name.split(/\s+/)[0]
    setPayment(null)
    setNext(steps)
    setConfirmation(firstName ? `Checked in, ${firstName}!` : "Checked in!")
  }

  function resetForm() {
    forgetWaiver()
    clearSelectedMember()
    setWaiverAttendee(null)
    setPayment(null)
    setConfirmation(null)
    setNext(null)
  }

  // A half-filled form clears itself after 90 seconds without a touch, keypress, or scroll, so the next
  // person at the kiosk never sees it. Waivers take longer to read and sign, often on a phone, so a
  // waiver screen stays until the attendee taps a button.
  useEffect(() => {
    if (confirmation || !hasEntry || waiverAttendee) return
    const events = ["pointerdown", "keydown", "input", "scroll"]
    let timeout = window.setTimeout(resetForm, IDLE_RESET_MS)
    const restart = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(resetForm, IDLE_RESET_MS)
    }
    for (const type of events) window.addEventListener(type, restart, true)
    return () => {
      window.clearTimeout(timeout)
      for (const type of events) window.removeEventListener(type, restart, true)
    }
  }, [confirmation, hasEntry, waiverAttendee])

  if (confirmation) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-[620px] flex-col items-center justify-center gap-6 px-5 py-12 text-center sm:gap-8">
        <h1 className="text-[length:var(--title-font-size)] leading-tight font-bold">{confirmation}</h1>
        {next?.joinCampusGroups && (
          <QrCallout
            title="Join Swing Syndicate on CampusGroups"
            detail="Scan to become a member."
            src={campusGroupsQrUrl}
          />
        )}
        <TimedButton onClick={resetForm}>Check in another person</TimedButton>
      </main>
    )
  }

  if (payment) {
    return (
      <Payment
        attendee={payment.attendee}
        eventId={eventId}
        event={payment.event}
        tickets={payment.tickets}
        onPaid={(steps) => confirmPayment(payment.attendee, steps)}
        onLeave={resetForm}
      />
    )
  }

  if (waiverAttendee) {
    return (
      <div className="mx-auto min-h-svh w-full max-w-[620px] px-5 pb-12">
        <header className="flex h-16 items-center">
          <SiteBrand link={false} />
        </header>
        <main className="pt-12">
          {PARTICIPANT_WAIVER_AFFILIATIONS.includes(waiverAttendee.affiliation) ? (
            <NonCornellWaiver
              name={waiverAttendee.name}
              email={waiverAttendee.email}
              phone={waiverAttendee.phone}
              eventId={eventId}
              onBack={() => setWaiverAttendee(null)}
              onComplete={() => checkIn(waiverAttendee)}
            />
          ) : (
            <GeneralRiskWaiver
              onBack={() => setWaiverAttendee(null)}
              onComplete={() => checkIn(waiverAttendee)}
            />
          )}
        </main>
      </div>
    )
  }

  if (!choices) return null

  if (severalEvents && !eventId) {
    return (
      <div className="mx-auto min-h-svh w-full max-w-[620px] px-5 pb-12">
        <header className="flex h-16 items-center">
          <SiteBrand link={false} />
        </header>
        <main className="pt-12">
          <h1 className="mb-6 text-[length:var(--title-font-size)] leading-tight font-bold">Choose an event</h1>
          <div className="flex flex-col gap-3">
            {choices.map((option) => (
              <button key={option.id} type="button" className="flex min-h-16 flex-col justify-center rounded-lg border bg-background px-4 py-3 text-left text-lg transition-colors hover:bg-muted" onClick={() => setPickedEvent(option.id)}>
                <span className="font-medium">{option.title}</span>
                <span className="text-sm text-muted-foreground">{option.time}</span>
              </button>
            ))}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-[620px] px-5 pb-12">
      <header className="flex h-16 items-center">
        <SiteBrand link={false} />
      </header>

      <main className="pt-12">
        <h1 className="mb-6 text-[length:var(--title-font-size)] leading-tight font-bold">Check in</h1>

        <form className="space-y-4" autoComplete="off" noValidate onSubmit={submitCheckin}>
          {selectedMember && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                Updating {selectedMember.name || selectedMember.email}
              </span>
              <Button
                type="button"
                variant="link"
                onClick={clearSelectedMember}
              >
                Not you?
              </Button>
            </div>
          )}

          <div>
            <FloatingField id="name" label="Full name" filled={!!name}>
              <Combobox<Member>
                items={results.members}
                filteredItems={results.members}
                value={selectedMember}
                inputValue={name}
                open={memberSearchOpen && nameFocused && results.members.length > 0}
                onOpenChange={(open) =>
                  setMemberSearchOpen(open && !selectedMember && !!query)
                }
                onInputValueChange={(value, details) => {
                  if (details.reason === "input-change") setName(value)
                }}
                onValueChange={chooseMember}
                itemToStringLabel={(member) => member.name}
                itemToStringValue={(member) => member.id}
                isItemEqualToValue={(member, value) => member.id === value.id}
                autoHighlight
              >
                <ComboboxInput
                  id="name"
                  name="name"
                  className="h-14 w-full [&_[data-slot=input-group-control]]:h-full [&_[data-slot=input-group-control]]:px-3 [&_[data-slot=input-group-control]]:pt-5 [&_[data-slot=input-group-control]]:pb-1 [&_[data-slot=input-group-control]]:text-base"
                  autoComplete="off"
                  autoCapitalize="words"
                  aria-describedby={showNameCasePrompt ? "name-case-prompt" : undefined}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => {
                    setNameFocused(false)
                    setName(normalizeName(name))
                    setNameTouched(true)
                  }}
                  data-1p-ignore
                  required
                  showTrigger={false}
                  autoFocus
                />
                <MemberResults />
              </Combobox>
            </FloatingField>
            {showNoMatches && (
              <p className="mt-2 px-3 text-sm leading-5 text-muted-foreground" role="status">
                {results.failed ? "Name search isn't working right now. Fill in the form below." : "Don't see your name? Continue below."}
              </p>
            )}
            {showNameCasePrompt && (
              <p
                id="name-case-prompt"
                className="mt-2 px-3 text-sm leading-5 text-muted-foreground"
                role="status"
              >
                Is your name capitalized?
              </p>
            )}
          </div>

          <FloatingField id="email" label="Email" filled={!!email}>
            <Input
              id="email"
              name="email"
              className={floatingInputClass}
              type="email"
              inputMode="email"
              autoComplete="off"
              data-1p-ignore
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={message === "Enter a valid email."}
              required
            />
          </FloatingField>

          <FloatingField id="phone" label="Phone" filled={!!phone}>
            <PhoneInput
              id="phone"
              name="phone"
              className={floatingInputClass}
              inputComponent={Input}
              defaultCountry="US"
              autoComplete="off"
              data-1p-ignore
              value={phone || undefined}
              onChange={(value) => setPhone(value ?? "")}
              aria-invalid={message === "Enter a valid phone number."}
            />
          </FloatingField>

          <FloatingField id="affiliation" label="Affiliation" filled={!!affiliation}>
            <Select
              value={affiliation}
              onValueChange={(value) => setAffiliation(value as Affiliation)}
            >
              <SelectTrigger
                id="affiliation"
                className={`${floatingInputClass} h-14! w-full [&>svg]:-mt-4`}
                aria-invalid={message === "Choose an affiliation."}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {AFFILIATIONS.map((option) => (
                  <SelectItem key={option} value={option} className="py-2">
                    {AFFILIATION_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FloatingField>

          <Button className={`w-full ${largeButtonClass}`} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Checking in…" : "Check in"}
          </Button>

          <p className="text-destructive text-base" role="alert">
            {message}
          </p>
        </form>
      </main>
    </div>
  )
}

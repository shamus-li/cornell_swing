import { FormEvent, useEffect, useRef, useState } from "react"

import campusGroupsQrUrl from "../../assets/campusgroups-qr.png"
import waiverQrUrl from "../../assets/waiver-qr.png"

import { SiteBrand } from "@shared/site/components/SiteBrand"
import { Button } from "@/components/ui/button"
import { largeButtonClass } from "@/lib/sizes"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { FloatingField, floatingInputClass } from "@/components/ui/floating-field"
import { Input } from "@/components/ui/input"
import { Person } from "@/components/ui/person"
import { QrCallout } from "@/components/ui/qr-callout"
import PhoneInput from "react-phone-number-input/input"
import { forgetWaiver, NonCornellWaiver, preloadWaiver } from "@/Waiver"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AFFILIATION_LABELS,
  AFFILIATIONS,
  hasUnusualNameCapitalization,
  isValidEmail,
  isValidName,
  normalizeName,
  normalizePhone,
  phoneNumberForInput,
  PARTICIPANT_WAIVER_AFFILIATIONS,
  type Affiliation,
  type Member,
  type NextSteps,
} from "@/lib/checkin"

type MembersResponse = {
  members?: Member[]
}

const MEMBER_SEARCH_DELAY_MS = 75
const MEMBER_SEARCH_CACHE_LIMIT = 12
const NO_RESULTS = { key: "", members: [] }

type Attendee = {
  memberId: string | null
  name: string
  email: string
  phone: string
  affiliation: Affiliation
}

function memberSearchKey(query: string): string {
  return query.toLocaleLowerCase()
}

function MemberResults() {
  return (
    <ComboboxContent>
      <ComboboxList>
        {(member: Member) => (
          <ComboboxItem key={member.id} value={member} className="items-start px-3 py-2.5 text-base">
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
  const [results, setResults] = useState<{ key: string; members: Member[] }>(NO_RESULTS)
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
  const memberSearchCache = useRef(new Map<string, Member[]>())

  useEffect(() => {
    if (affiliation && PARTICIPANT_WAIVER_AFFILIATIONS.includes(affiliation)) preloadWaiver().catch(() => {})
  }, [affiliation])

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
      setResults({ key: searchKey, members: cached })
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
        setResults({ key: searchKey, members: matches })
        setMemberSearchOpen(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (!active) return
        console.error(error)
        setResults(NO_RESULTS)
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
      memberId: selectedMember?.id ?? null,
      name: normalizedName,
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      affiliation,
    }
    if (PARTICIPANT_WAIVER_AFFILIATIONS.includes(affiliation)) {
      setWaiverAttendee(attendee)
      return
    }
    setIsSubmitting(true)
    const error = await checkIn(attendee)
    if (error) setMessage(error)
    setIsSubmitting(false)
  }

  // Records the check-in and shows the confirmation; returns an error message when it fails.
  async function checkIn(attendee: Attendee): Promise<string | null> {
    try {
      const response = await fetch("api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(attendee),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string; next?: NextSteps }
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
      // fetch rejects with a TypeError when the request never reached the server.
      return error instanceof TypeError
        ? "Couldn't reach the server. Check the Wi-Fi connection and try again."
        : error instanceof Error
          ? error.message
          : "Check-in failed. Please try again."
    }
  }

  function resetForm() {
    forgetWaiver()
    clearSelectedMember()
    setConfirmation(null)
    setNext(null)
  }

  if (confirmation) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-[540px] flex-col items-center justify-center gap-6 px-5 py-12 text-center sm:gap-8">
        <h1 className="text-[1.75rem] leading-tight font-semibold">{confirmation}</h1>
        {next?.waiver === "cornell" && (
          <QrCallout
            title="Sign the General Risk waiver"
            detail="Scan to sign with your NetID."
            src={waiverQrUrl}
          />
        )}
        {next?.joinCampusGroups && (
          <QrCallout
            title="Join Swing Syndicate on CampusGroups"
            detail="Scan to become a member."
            src={campusGroupsQrUrl}
          />
        )}
        <Button className={largeButtonClass} onClick={resetForm}>
          Check in another person
        </Button>
      </main>
    )
  }

  if (waiverAttendee) {
    return (
      <div className="mx-auto min-h-svh w-full max-w-[620px] px-5 pb-12">
        <header className="flex h-16 items-center">
          <SiteBrand />
        </header>
        <main className="pt-12">
          <NonCornellWaiver
            name={waiverAttendee.name}
            email={waiverAttendee.email}
            phone={waiverAttendee.phone}
            onBack={() => setWaiverAttendee(null)}
            onComplete={() => checkIn(waiverAttendee)}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-[620px] px-5 pb-12">
      <header className="flex h-16 items-center">
        <SiteBrand />
      </header>

      <main className="pt-12">
        <h1 className="mb-6 text-[1.75rem] leading-tight font-semibold">Check in</h1>

        <form className="space-y-4" autoComplete="off" noValidate onSubmit={submitCheckin}>
          {selectedMember && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                Updating {selectedMember.name || selectedMember.email}
              </span>
              <Button
                size="sm"
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
                Don&apos;t see your name? Continue below.
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
                  <SelectItem key={option} value={option} className="py-2 text-base">
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

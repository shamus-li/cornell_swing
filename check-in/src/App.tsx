import { FormEvent, useEffect, useRef, useState } from "react"

import logoUrl from "../../assets/shoe-logo.png"

import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AFFILIATIONS, type Affiliation, type Member } from "@/lib/checkin"

type MembersResponse = {
  members?: Member[]
}

const MEMBER_SEARCH_DELAY_MS = 75
const MEMBER_SEARCH_CACHE_LIMIT = 12

function memberSearchKey(query: string): string {
  return query.toLocaleLowerCase()
}

function MemberResults() {
  return (
    <ComboboxContent className="rounded-md">
      <ComboboxList>
        {(member: Member) => (
          <ComboboxItem key={member.id} value={member} className="items-start px-3 py-2.5 text-base">
            <span className="min-w-0">
              {member.name && <span className="block truncate font-medium">{member.name}</span>}
              {(member.email || member.affiliation) && (
                <span className="text-muted-foreground block truncate">
                  {[member.email, member.affiliation].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxContent>
  )
}

export default function App() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [affiliation, setAffiliation] = useState<Affiliation | "">("")
  const [members, setMembers] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [memberSearchOpen, setMemberSearchOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const memberSearchCache = useRef(new Map<string, Member[]>())

  const query = name.trim()
  const searchKey = memberSearchKey(query)
  useEffect(() => {
    if (selectedMember) {
      setMembers([])
      setMemberSearchOpen(false)
      return
    }
    if (!query) {
      setMembers([])
      setMemberSearchOpen(false)
      return
    }

    const cached = memberSearchCache.current.get(searchKey)
    if (cached) {
      setMembers(cached)
      setMemberSearchOpen(cached.length > 0)
      return
    }

    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`api/members?q=${encodeURIComponent(query)}`, {
          headers: { Accept: "application/json" },
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
        setMembers(matches)
        setMemberSearchOpen(matches.length > 0)
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (!active) return
        console.error(error)
        setMembers([])
        setMemberSearchOpen(false)
      }
    }, MEMBER_SEARCH_DELAY_MS)

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query, searchKey, selectedMember])

  function updateName(value: string) {
    setName(value)
  }

  function clearSelectedMember() {
    setSelectedMember(null)
    setName("")
    setEmail("")
    setAffiliation("")
    setMembers([])
    memberSearchCache.current.clear()
    setMemberSearchOpen(false)
    setMessage("")
  }

  function chooseMember(member: Member | null) {
    if (!member) return
    setSelectedMember(member)
    memberSearchCache.current.clear()

    setName(member.name)
    setEmail(member.email)
    setAffiliation(AFFILIATIONS.some((option) => option === member.affiliation) ? member.affiliation : "")
    setMemberSearchOpen(false)
    setMessage("")
  }

  async function submitCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage("")

    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity()
      return
    }
    if (!affiliation) {
      setMessage("Choose an affiliation.")
      return
    }

    setIsSubmitting(true)
    const attendee = {
      memberId: selectedMember?.id ?? null,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      affiliation,
    }

    try {
      const response = await fetch("api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(attendee),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok && response.status !== 409) {
        throw new Error(payload.message || "Check-in failed")
      }

      const firstName = attendee.name.split(/\s+/)[0]
      setConfirmation(
        response.status === 409
          ? "Already checked in"
          : firstName
            ? `Checked in, ${firstName}!`
            : "Checked in!",
      )
    } catch (error) {
      console.error(error)
      // fetch rejects with a TypeError when the request never reached the server.
      setMessage(
        error instanceof TypeError
          ? "Couldn't reach the server. Check the Wi-Fi connection and try again."
          : error instanceof Error
            ? error.message
            : "Check-in failed. Please try again.",
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function resetForm() {
    setName("")
    setEmail("")
    setAffiliation("")
    setMembers([])
    memberSearchCache.current.clear()
    setSelectedMember(null)
    setMemberSearchOpen(false)
    setMessage("")
    setConfirmation(null)
  }

  if (confirmation) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-[620px] flex-col items-center px-5 pt-16 text-center">
        <h1 className="text-[2rem] leading-tight font-bold">{confirmation}</h1>
        <Button className="mt-6 h-13 px-5 text-base" onClick={resetForm}>
          Check in another person
        </Button>
      </main>
    )
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-[620px] px-5 pb-12">
      <header className="flex h-16 items-center">
        <a
          className="font-heading inline-flex items-center text-[1.05rem] leading-none font-semibold no-underline"
          href="../"
          aria-label="Swing Syndicate at Cornell home"
        >
          <img className="mr-[-4px] h-12 w-auto shrink-0" src={logoUrl} alt="" />
          <span>Swing Syndicate at Cornell</span>
        </a>
      </header>

      <main className="pt-12">
        <h1 className="mb-6 text-[2rem] leading-tight font-bold">Check in</h1>

        <form className="space-y-4" autoComplete="off" onSubmit={submitCheckin}>
          {selectedMember && (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                Updating {selectedMember.name || selectedMember.email}
              </span>
              <Button
                className="h-auto shrink-0 px-0 py-0 text-sm"
                type="button"
                variant="link"
                onClick={clearSelectedMember}
              >
                Not you?
              </Button>
            </div>
          )}

          <label className="sr-only" htmlFor="name">
            Name
          </label>
          <Combobox<Member>
            items={members}
            filteredItems={members}
            value={selectedMember}
            inputValue={name}
            open={memberSearchOpen}
            onOpenChange={(open) =>
              setMemberSearchOpen(open && !selectedMember && name.trim().length >= 1)
            }
            onInputValueChange={(value, details) => {
              if (details.reason === "input-change") updateName(value)
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
              className="h-13 w-full rounded-md [&_[data-slot=input-group-control]]:text-base"
              placeholder="Name"
              autoComplete="off"
              data-1p-ignore
              showTrigger={false}
              autoFocus
            />
            <MemberResults />
          </Combobox>

          <label className="sr-only" htmlFor="email">
            Email
          </label>
          <Input
            id="email"
            name="email"
            className="h-13 rounded-md px-3 text-base md:text-base"
            type="email"
            inputMode="email"
            autoComplete="off"
            data-1p-ignore
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label className="sr-only" htmlFor="affiliation">
            Affiliation
          </label>
          <Select value={affiliation} onValueChange={(value) => setAffiliation(value as Affiliation)}>
            <SelectTrigger
              id="affiliation"
              className="h-13! w-full rounded-md px-3 text-base"
              aria-invalid={message === "Choose an affiliation."}
            >
              <SelectValue placeholder="Affiliation" />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {AFFILIATIONS.map((option) => (
                <SelectItem key={option} value={option} className="py-2 text-base">
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-destructive min-h-6 text-base" role="alert" aria-live="assertive">
            {message}
          </p>

          <Button className="h-13 w-full text-base" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Checking in…" : "Check in"}
          </Button>
        </form>
      </main>
    </div>
  )
}

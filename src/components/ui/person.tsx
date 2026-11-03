// Name over a muted detail line, shared by check-in search results and the RSVP list.
function Person({ name, detail }: { name: string; detail?: string }) {
  return (
    <span className="min-w-0">
      {name && <span className="block truncate font-medium">{name}</span>}
      {detail && <span className="block truncate text-muted-foreground">{detail}</span>}
    </span>
  )
}

export { Person }

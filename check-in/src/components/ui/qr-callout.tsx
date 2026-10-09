// A titled card with a QR code for attendees to scan with their phone.
function QrCallout({ title, detail, src }: { title: string; detail: string; src: string }) {
  return (
    <aside className="flex w-full flex-col items-center gap-5 rounded-xl bg-muted p-5 text-center sm:flex-row sm:gap-6 sm:p-6 sm:text-left">
      <div className="min-w-0 flex-1">
        <h2 className="font-sans text-lg leading-tight font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0 rounded-sm bg-white p-1">
        <img className="size-24" src={src} width="444" height="444" alt={`QR code: ${title}`} />
      </div>
    </aside>
  )
}

export { QrCallout }

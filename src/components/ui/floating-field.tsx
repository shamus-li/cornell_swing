import * as React from "react"

// Leaves room above the text for the floating label.
const floatingInputClass = "h-14 px-3 pt-5 pb-1"

// Label sits inside the field like a placeholder and moves up once the field is focused or filled.
function FloatingField({ id, label, filled, children }: { id: string; label: string; filled: boolean; children: React.ReactNode }) {
  return (
    <div className="group relative" data-filled={filled || undefined}>
      {children}
      <label
        htmlFor={id}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted-foreground transition-[top,font-size,translate] duration-150 group-focus-within:top-2 group-focus-within:translate-y-0 group-focus-within:text-[length:var(--caption-font-size)] group-data-filled:top-2 group-data-filled:translate-y-0 group-data-filled:text-[length:var(--caption-font-size)] motion-reduce:transition-none"
      >
        {label}
      </label>
    </div>
  )
}

export { FloatingField, floatingInputClass }

import type { KeyboardEvent, ReactNode } from "react"

export function Tabs<T extends string>({ label, tabs, value, onChange }: {
  label: string
  tabs: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  // Arrow keys move between tabs, following the WAI-ARIA tabs pattern.
  function move(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!step) return
    const next = tabs[(tabs.findIndex(tab => tab.value === value) + step + tabs.length) % tabs.length].value
    onChange(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus()
  }
  return <div role="tablist" aria-label={label} className="tabs" onKeyDown={move}>
    {tabs.map(tab => <button key={tab.value} type="button" role="tab" data-value={tab.value} aria-selected={tab.value === value} tabIndex={tab.value === value ? 0 : -1} className="tab" onClick={() => onChange(tab.value)}>{tab.label}</button>)}
  </div>
}

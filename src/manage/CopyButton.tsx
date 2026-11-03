import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "../components/ui/button"

// Tab-separated rows paste into Google Sheets as Name and Email columns.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{label}<span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span></Button>
}

import { useState, type ComponentProps } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "../components/ui/button"

export function CopyButton({ copy, label, variant = "outline", size }: { copy: () => Promise<void>; label: string } & Pick<ComponentProps<typeof Button>, "variant" | "size">) {
  const [copied, setCopied] = useState(false)
  async function run() {
    await copy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return <Button type="button" variant={variant} size={size} onClick={() => void run()}>{copied ? <Check /> : <Copy />}{label}<span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span></Button>
}

import { lazy, Suspense } from "react"

const Editor = lazy(() => import("./MarkdownEditorContent").then(module => ({ default: module.MarkdownEditor })))

export function MarkdownEditor(props: {
  markdown: string
  label: string
  onChange: (markdown: string) => void
  onError: (message: string) => void
}) {
  return <Suspense fallback={<p role="status">Loading editor…</p>}><Editor {...props} /></Suspense>
}

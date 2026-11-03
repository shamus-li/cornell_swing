import { lazy, Suspense } from "react"

const loadEditor = () => import("./MarkdownEditorContent")
const Editor = lazy(() => loadEditor().then(module => ({ default: module.MarkdownEditor })))

// The editor is a large download, so an event page fetches it ahead of the first click on Details.
export const preloadMarkdownEditor = () => void loadEditor().catch(() => {})

export function MarkdownEditor(props: {
  markdown: string
  label: string
  onChange: (markdown: string) => void
  onError: (message: string) => void
  readOnly: boolean
}) {
  return <Suspense fallback={<div className="inline-editor inline-editor-loading" role="status" aria-label="Loading editor" />}><Editor {...props} /></Suspense>
}

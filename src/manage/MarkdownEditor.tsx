import { lazy, Suspense } from "react"

const Editor = lazy(() => import("./MarkdownEditorContent").then(module => ({ default: module.MarkdownEditor })))

export function MarkdownEditor(props: {
  markdown: string
  label: string
  onChange: (markdown: string) => void
  onError: (message: string) => void
  readOnly: boolean
}) {
  return <Suspense fallback={<div className="inline-editor inline-editor-loading" role="status" aria-label="Loading editor" />}><Editor {...props} /></Suspense>
}

import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return <div className="event-markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    table: ({ children }) => <div className="event-table-scroll"><table>{children}</table></div>,
    // The editor saves blank lines as paragraphs holding only a non-breaking space.
    p: ({ node, children }) => node?.children.every(child => child.type === "text" && !child.value.trim()) ? null : <p>{children}</p>,
  }}>{children}</ReactMarkdown></div>
})

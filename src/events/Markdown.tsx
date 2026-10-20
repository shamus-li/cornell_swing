import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return <div className="event-markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    table: ({ children }) => <div className="event-table-scroll"><table>{children}</table></div>,
  }}>{children}</ReactMarkdown></div>
})

import { useState } from "react"
import {
  MDXEditor, BlockTypeSelect, CreateLink, InsertThematicBreak,
  ListsToggle, Separator, headingsPlugin, linkDialogPlugin, linkPlugin,
  listsPlugin, markdownShortcutPlugin, quotePlugin, thematicBreakPlugin,
  toolbarPlugin,
  addExportVisitor$, realmPlugin,
} from "@mdxeditor/editor"
import { $isParagraphNode } from "lexical"
import "@mdxeditor/editor/style.css"
import "./markdown-editor.css"
import { URLOnlyLinkDialog } from "./URLOnlyLinkDialog"

const blankParagraphsPlugin = realmPlugin({
  init(realm) {
    realm.pub(addExportVisitor$, {
      priority: 1,
      testLexicalNode: $isParagraphNode,
      visitLexicalNode({ lexicalNode, mdastParent, actions }) {
        if (lexicalNode.getTextContent() !== "") return actions.nextVisitor()
        // Ordinary Markdown blank lines collapse; a space paragraph preserves the editor's gap.
        actions.appendToParent(mdastParent, { type: "paragraph", children: [{ type: "text", value: "\u00a0" }] })
      },
    })
  },
})

export function MarkdownEditor({ markdown, label, onChange, onError }: {
  markdown: string
  label: string
  onChange: (markdown: string) => void
  onError: (message: string) => void
}) {
  const [initialMarkdown] = useState(markdown)
  return <section className="markdown-editor" aria-labelledby="description-label">
    <p id="description-label" className="editor-label">{label}</p>
    <MDXEditor
      markdown={initialMarkdown}
      className="inline-editor"
      contentEditableClassName="event-markdown inline-editor-content"
      placeholder="Write here…"
      suppressHtmlProcessing
      translation={(key, defaultValue, values) => {
        if (key === "toolbar.blockTypes.heading") return values?.level === 2 ? "Heading" : "Subheading"
        if (key === "toolbar.blockTypes.quote") return "Blockquote"
        if (key === "toolbar.thematicBreak") return "Divider"
        return defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ""))
      }}
      toMarkdownOptions={{ bullet: "-", emphasis: "*", strong: "*" }}
      onChange={(value, initialNormalize) => { if (!initialNormalize) onChange(value) }}
      onError={() => onError("This description could not be opened. Your saved text has been preserved.")}
      plugins={[
        blankParagraphsPlugin(),
        headingsPlugin({ allowedHeadingLevels: [2, 3] }), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin({ LinkDialog: URLOnlyLinkDialog }),
        thematicBreakPlugin(), markdownShortcutPlugin(),
        toolbarPlugin({ toolbarContents: () => <><BlockTypeSelect /><Separator /><ListsToggle options={["bullet", "number"]} /><CreateLink /><InsertThematicBreak /></> }),
      ]}
    />
  </section>
}

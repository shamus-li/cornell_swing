import { useState, type ReactNode } from "react"
import {
  MDXEditor, headingsPlugin, linkDialogPlugin, linkPlugin,
  listsPlugin, markdownShortcutPlugin, quotePlugin, thematicBreakPlugin,
  toolbarPlugin, addExportVisitor$, realmPlugin,
  applyFormat$, applyListType$, convertSelectionToNode$, currentBlockType$, currentFormat$, currentListType$, openLinkEditDialog$,
  IS_BOLD, IS_ITALIC, useCellValues, usePublisher,
} from "@mdxeditor/editor"
import { $createParagraphNode, $isParagraphNode } from "lexical"
import { $createHeadingNode } from "@lexical/rich-text"
import { Bold, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react"
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

function ToolbarButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="editor-tool" aria-label={label} title={label} aria-pressed={active} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>
}

// Only the formatting the homepage renders: bold, italic, headings, lists, and links.
function EditorToolbar() {
  const [format, blockType, listType] = useCellValues(currentFormat$, currentBlockType$, currentListType$)
  const applyFormat = usePublisher(applyFormat$)
  const convertSelection = usePublisher(convertSelectionToNode$)
  const applyListType = usePublisher(applyListType$)
  const openLink = usePublisher(openLinkEditDialog$)
  const heading = blockType === "h2" || blockType === "h3"
  return <>
    <ToolbarButton label="Bold" active={(format & IS_BOLD) !== 0} onClick={() => applyFormat("bold")}><Bold /></ToolbarButton>
    <ToolbarButton label="Italic" active={(format & IS_ITALIC) !== 0} onClick={() => applyFormat("italic")}><Italic /></ToolbarButton>
    <ToolbarButton label="Heading" active={heading} onClick={() => convertSelection(() => heading ? $createParagraphNode() : $createHeadingNode("h2"))}><Heading2 /></ToolbarButton>
    <span className="editor-tool-separator" aria-hidden="true" />
    <ToolbarButton label="Bulleted list" active={listType === "bullet"} onClick={() => applyListType(listType === "bullet" ? "" : "bullet")}><List /></ToolbarButton>
    <ToolbarButton label="Numbered list" active={listType === "number"} onClick={() => applyListType(listType === "number" ? "" : "number")}><ListOrdered /></ToolbarButton>
    <ToolbarButton label="Link" active={false} onClick={() => openLink()}><Link2 /></ToolbarButton>
  </>
}

export function MarkdownEditor({ markdown, label, onChange, onError }: {
  markdown: string
  label: string
  onChange: (markdown: string) => void
  onError: (message: string) => void
}) {
  const [initialMarkdown] = useState(markdown)
  return <div className="markdown-editor" role="group" aria-label={label}><MDXEditor
    markdown={initialMarkdown}
    className="inline-editor"
    contentEditableClassName="event-markdown inline-editor-content"
    placeholder="Add a description…"
    suppressHtmlProcessing
    toMarkdownOptions={{ bullet: "-", emphasis: "*", strong: "*" }}
    onChange={(value, initialNormalize) => { if (!initialNormalize) onChange(value) }}
    onError={() => onError("This description could not be opened. Your saved text has been preserved.")}
    plugins={[
      blankParagraphsPlugin(),
      headingsPlugin({ allowedHeadingLevels: [2, 3] }), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin({ LinkDialog: URLOnlyLinkDialog }),
      thematicBreakPlugin(), markdownShortcutPlugin(),
      toolbarPlugin({ toolbarClassName: "editor-toolbar", toolbarContents: () => <EditorToolbar /> }),
    ]}
  /></div>
}

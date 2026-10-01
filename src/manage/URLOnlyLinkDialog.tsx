import { useEffect, useRef } from "react"
import { useCellValues, usePublisher } from "@mdxeditor/gurx"
import {
  activeEditor$, cancelLinkEdit$, contentEditableWrapperElement$, linkDialogState$,
  onWindowChange$, removeLink$, switchFromPreviewToLinkEdit$, updateLink$,
} from "@mdxeditor/editor"
import { CornerDownLeft, Globe, Link2, Pencil, Unlink } from "lucide-react"
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover"

export function URLOnlyLinkDialog() {
  const [state, editor, wrapper] = useCellValues(linkDialogState$, activeEditor$, contentEditableWrapperElement$)
  const updateLink = usePublisher(updateLink$)
  const cancelEdit = usePublisher(cancelLinkEdit$)
  const editLink = usePublisher(switchFromPreviewToLinkEdit$)
  const removeLink = usePublisher(removeLink$)
  const setDialog = usePublisher(linkDialogState$)
  const updatePosition = usePublisher(onWindowChange$)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const update = () => editor?.getEditorState().read(() => updatePosition(true))
    const scrollContainer = wrapper?.closest(".mdxeditor-root-contenteditable")
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update)
    scrollContainer?.addEventListener("scroll", update)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update)
      scrollContainer?.removeEventListener("scroll", update)
    }
  }, [editor, wrapper, updatePosition])

  useEffect(() => {
    if (state.type === "edit") input.current?.focus()
  }, [state.type])

  if (state.type === "inactive") return <></>
  const rectangle = state.rectangle
  const anchor = { current: { getBoundingClientRect: () => new DOMRect(rectangle.left, rectangle.top, rectangle.width, rectangle.height) } }
  const close = () => {
    if (state.type === "edit") cancelEdit()
    setDialog({ type: "inactive" })
  }

  return <Popover open onOpenChange={(open) => { if (!open) close() }}>
    <PopoverAnchor virtualRef={anchor} />
    <PopoverContent
      aria-label={state.type === "edit" ? "Edit link" : "Link"}
      align="start"
      className="w-80 max-w-[calc(100vw-32px)] gap-0 rounded-lg p-1"
      updatePositionStrategy="always"
      onOpenAutoFocus={(event) => { event.preventDefault(); if (state.type === "edit") input.current?.focus() }}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); close() }}
    >
      {state.type === "edit" ? <form key={`${state.linkNodeKey}:${state.initialUrl}`} className="link-bar" onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        // An empty text payload preserves the selection; collapsed new links use the URL.
        updateLink({ url: input.current?.value, text: state.initialUrl ? state.text : undefined, title: state.title })
      }}>
        <Link2 aria-hidden="true" />
        <input ref={input} className="link-input" aria-label="Link URL" name="url" defaultValue={state.url} placeholder="Paste a link" autoComplete="off" required />
        <button type="submit" className="editor-tool" aria-label="Apply link" title="Apply link"><CornerDownLeft /></button>
      </form> : <div className="link-bar">
        <Globe aria-hidden="true" />
        <a href={state.href ?? "about:blank"} target="_blank" rel="noopener noreferrer" className="link-url" title={state.url}>{state.url}</a>
        <button type="button" className="editor-tool" aria-label="Edit link" title="Edit link" onClick={() => editLink()}><Pencil /></button>
        <button type="button" className="editor-tool" aria-label="Remove link" title="Remove link" onClick={() => removeLink()}><Unlink /></button>
      </div>}
    </PopoverContent>
  </Popover>
}

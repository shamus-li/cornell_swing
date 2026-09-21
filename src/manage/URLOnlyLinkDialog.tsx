import { useEffect, useId, useRef } from "react"
import { useCellValues, usePublisher } from "@mdxeditor/gurx"
import {
  activeEditor$, cancelLinkEdit$, contentEditableWrapperElement$, linkDialogState$,
  onWindowChange$, removeLink$, switchFromPreviewToLinkEdit$, updateLink$,
} from "@mdxeditor/editor"
import { Button } from "../../check-in/src/components/ui/button"
import { Input } from "../../check-in/src/components/ui/input"
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
  const inputId = useId()

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
      updatePositionStrategy="always"
      onOpenAutoFocus={(event) => { event.preventDefault(); if (state.type === "edit") input.current?.focus() }}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); close() }}
    >
      {state.type === "edit" ? <form key={`${state.linkNodeKey}:${state.initialUrl}`} className="flex flex-col gap-3" onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        // An empty text payload preserves the selection; collapsed new links use the URL.
        updateLink({ url: input.current?.value, text: state.initialUrl ? state.text : undefined, title: state.title })
      }}>
        <label htmlFor={inputId} className="text-sm font-medium">URL</label>
        <Input ref={input} id={inputId} name="url" defaultValue={state.url} placeholder="Paste a URL" autoComplete="off" required />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="default" onClick={close}>Cancel</Button>
          <Button type="submit" size="default">Save</Button>
        </div>
      </form> : <div className="flex flex-col gap-3">
        <a href={state.href ?? "about:blank"} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{state.url}</a>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="default" onClick={() => editLink()}>Edit</Button>
          <Button type="button" variant="outline" size="default" onClick={() => removeLink()}>Remove link</Button>
        </div>
      </div>}
    </PopoverContent>
  </Popover>
}

'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { Icon } from '@/lib/icons'

interface SelectionBubbleProps {
  editor: Editor | null
  /** Hidden entirely for a viewer: commenting is an edit. */
  readOnly: boolean
  onAddComment: () => void
  onHighlight: () => void
}

interface Anchor {
  top: number
  left: number
}

/**
 * The floating control that appears over a text selection.
 *
 * Written directly rather than pulled in from `@tiptap/extension-bubble-menu`,
 * which brings Tippy and Popper along for what amounts to two numbers from
 * `coordsAtPos`. The positioning here is `fixed`, because that is the
 * coordinate space ProseMirror already reports in — going through an
 * offsetParent would mean re-deriving it against a scroll container that also
 * moves.
 */
export function SelectionBubble({
  editor,
  readOnly,
  onAddComment,
  onHighlight,
}: SelectionBubbleProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  useEffect(() => {
    if (!editor || readOnly) {
      setAnchor(null)
      return
    }

    const update = () => {
      const { state, view } = editor
      const { from, to, empty } = state.selection

      // `empty` is not sufficient on its own: a NodeSelection on an image is
      // not empty but has no text to comment on.
      if (empty || !state.doc.textBetween(from, to, ' ').trim()) {
        setAnchor(null)
        return
      }

      const start = view.coordsAtPos(from)
      const end = view.coordsAtPos(to)

      // Centre over the selection, clamped so a selection at the very edge of
      // the window does not push the control off-screen.
      const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
      setAnchor({
        top: Math.min(start.top, end.top),
        left: Math.max(90, Math.min(window.innerWidth - 90, centre)),
      })
    }

    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    // The selection stays valid while the page scrolls, but the coordinates do
    // not, so the control has to follow it.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)

    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor, readOnly])

  if (!anchor || !editor) return null

  return (
    <div
      className="selection-bubble"
      style={{ top: anchor.top, left: anchor.left }}
      role="toolbar"
      aria-label="Selection actions"
      // Without this, pressing the button blurs the editor and collapses the
      // selection before the click handler ever runs — so there would be
      // nothing left to attach the comment to.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" className="selection-bubble__btn" onClick={onAddComment}>
        <Icon name="comment" size={14} />
        Add comment
      </button>

      <span className="selection-bubble__sep" aria-hidden />

      <button
        type="button"
        className="selection-bubble__btn selection-bubble__btn--icon"
        title="Highlight"
        aria-label="Highlight"
        data-active={editor.isActive('highlight') ? 'true' : 'false'}
        onClick={onHighlight}
      >
        <Icon name="highlight" size={14} />
      </button>
    </div>
  )
}

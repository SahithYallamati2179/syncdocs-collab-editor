'use client'

import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * The mark that ties a comment to a stretch of text.
 *
 * A mark rather than a ProseMirror decoration or a stored character offset,
 * because a mark is part of the document, and in this app the document is a
 * CRDT. That means the anchor gets every property the prose already has for
 * free: it moves when someone types above it, it survives a partition and
 * merges afterwards, it is persisted by the same pipeline, and it replicates
 * to every peer. Offsets would have to be transformed against every concurrent
 * edit by hand, and would silently drift the moment two people typed at once.
 *
 * `inclusive: false` keeps the highlight from swallowing text typed at its
 * edges — a comment on "the report" should not quietly grow to cover "the
 * report is late" because someone continued the sentence.
 */
export interface CommentMarkAttributes {
  commentId: string | null
  resolved: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (commentId: string) => ReturnType
      unsetCommentMark: (commentId: string) => ReturnType
      setCommentResolved: (commentId: string, resolved: boolean) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  // Comments may overlap other formatting and each other; excludes: '' lets a
  // commented span also be bold, linked, and so on.
  excludes: '',
  keepOnSplit: true,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) =>
          attributes.commentId ? { 'data-comment-id': attributes.commentId } : {},
      },
      resolved: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-resolved') === 'true',
        renderHTML: (attributes) => ({ 'data-resolved': attributes.resolved ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]
  },

  addCommands() {
    return {
      setCommentMark:
        (commentId: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId, resolved: false }),

      /**
       * Remove one comment's mark wherever it appears, leaving any other
       * comment marks on the same text alone. `unsetMark` would strip every
       * comment from the range, which is wrong as soon as two comments overlap.
       */
      unsetCommentMark:
        (commentId: string) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks[this.name]
          if (!type) return false
          let touched = false

          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, mark)
                touched = true
              }
            }
          })

          if (touched && dispatch) dispatch(tr)
          return touched
        },

      /** Restyle a comment's range in place when it is resolved or reopened. */
      setCommentResolved:
        (commentId: string, resolved: boolean) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks[this.name]
          if (!type) return false
          let touched = false

          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            for (const mark of node.marks) {
              if (mark.type === type && mark.attrs.commentId === commentId) {
                if (mark.attrs.resolved === resolved) continue
                tr.removeMark(pos, pos + node.nodeSize, mark)
                tr.addMark(pos, pos + node.nodeSize, type.create({ commentId, resolved }))
                touched = true
              }
            }
          })

          if (touched && dispatch) dispatch(tr)
          return touched
        },
    }
  },
})

/** Scroll a commented range into view and flash it, for "jump to comment". */
export function revealComment(commentId: string): boolean {
  const target = document.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(commentId)}"]`)
  if (!target) return false

  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target.classList.add('comment-mark--flash')
  window.setTimeout(() => target.classList.remove('comment-mark--flash'), 1200)
  return true
}

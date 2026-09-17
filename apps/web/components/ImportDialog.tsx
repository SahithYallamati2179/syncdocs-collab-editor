'use client'

import type { Editor } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'
import {
  ACCEPTED_IMPORT_TYPES,
  applyImport,
  blocksToHtml,
  htmlToBlocks,
  isDocumentEmpty,
  MAX_IMPORT_BYTES,
  readImportedFile,
  SUPPORTED_IMPORT_LABEL,
  type DocumentBlock,
} from '@/lib/import'
import { Icon } from '@/lib/icons'
import { formatBytes } from '@/lib/metrics'
import { ImportReview } from './ImportReview'
import { Modal } from './Modal'

interface ImportDialogProps {
  editor: Editor | null
  title: string
  onClose: () => void
  onToast: (message: string) => void
  onTitleChange: (next: string) => void
  /** True when this user only has view access; importing is an edit. */
  readOnly: boolean
}

interface Review {
  fileName: string
  before: DocumentBlock[]
  after: DocumentBlock[]
  /** Applied only if the person keeps at least one change. */
  suggestedTitle: string
}

/**
 * Upload, then review.
 *
 * Dropping a file into a document that already has content is a destructive
 * act, and doing it silently means the person finds out what changed by
 * reading the result. So the file is diffed against the document and every
 * changed line is accepted or rejected individually before anything is
 * written. Nothing lands until Apply.
 *
 * An empty document skips the review entirely — there is nothing to weigh up,
 * and a diff consisting only of additions is a worse way to say "here is your
 * file" than simply showing the file.
 */
export function ImportDialog({
  editor,
  title,
  onClose,
  onToast,
  onTitleChange,
  readOnly,
}: ImportDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const finish = useCallback(
    (message: string, suggestedTitle: string) => {
      if (suggestedTitle && !title.trim()) onTitleChange(suggestedTitle)
      onToast(message)
      onClose()
    },
    [title, onTitleChange, onToast, onClose],
  )

  const accept = useCallback(
    async (file: File | undefined) => {
      if (!file || !editor) return
      setError(null)
      setBusy(file.name)

      try {
        const parsed = await readImportedFile(file)

        // Our own JSON export is a ProseMirror tree, not HTML, so there is no
        // block list to diff against. It round-trips exactly by design.
        if (parsed.json) {
          if (!applyImport(editor, parsed.json, 'replace')) {
            setError('The editor rejected that content.')
            return
          }
          finish(`Imported ${file.name}`, parsed.title)
          return
        }

        if (!parsed.html.trim()) {
          setError(`“${file.name}” had no content this editor could read.`)
          return
        }

        if (isDocumentEmpty(editor)) {
          if (!applyImport(editor, parsed.html, 'replace')) {
            setError('The editor rejected that content.')
            return
          }
          finish(`Imported ${file.name}`, parsed.title)
          return
        }

        setReview({
          fileName: file.name,
          before: htmlToBlocks(editor.getHTML()),
          after: htmlToBlocks(parsed.html),
          suggestedTitle: parsed.title,
        })
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [editor, finish],
  )

  const applyReviewed = useCallback(
    (blocks: DocumentBlock[]) => {
      if (!editor || !review) return
      // One replace, so the whole reviewed result lands as a single undoable
      // step rather than as a stream of per-line edits.
      if (!applyImport(editor, blocksToHtml(blocks), 'replace')) {
        setError('The editor rejected that content.')
        return
      }
      finish(`Applied changes from ${review.fileName}`, review.suggestedTitle)
    },
    [editor, review, finish],
  )

  if (readOnly) {
    return (
      <Modal title="Upload a document" onClose={onClose} width={520}>
        <div className="notice">
          You have view-only access to this document, and importing a file is an edit. Ask the
          owner for edit access, or start your own document and import it there.
        </div>
      </Modal>
    )
  }

  if (review) {
    return (
      <Modal title="Review changes" onClose={onClose} width={860}>
        <ImportReview
          before={review.before}
          after={review.after}
          fileName={review.fileName}
          onCancel={() => setReview(null)}
          onApply={applyReviewed}
        />
        {error && (
          <div className="notice" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal title="Upload a document" onClose={onClose} width={520}>
      <div
        className="dropzone"
        data-dragging={dragging ? 'true' : 'false'}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void accept(event.dataTransfer.files[0])
        }}
      >
        <span className="dropzone__icon">
          <Icon name={busy ? 'clock' : 'upload'} size={20} />
        </span>

        {busy ? (
          <>
            <strong>Reading {busy}…</strong>
            <span className="dropzone__hint">This stays on your machine.</span>
          </>
        ) : (
          <>
            <strong>{dragging ? 'Drop it here' : 'Drag a file here'}</strong>
            <span className="dropzone__hint">{SUPPORTED_IMPORT_LABEL}</span>
            <button
              type="button"
              className="btn btn--soft"
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </button>
            <span className="dropzone__hint">Up to {formatBytes(MAX_IMPORT_BYTES)}</span>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPTED_IMPORT_TYPES}
          onChange={(event) => {
            void accept(event.target.files?.[0])
            // Reset so choosing the same file twice still fires a change event.
            event.target.value = ''
          }}
        />
      </div>

      <span className="field__hint">
        Into an empty document the file is simply placed. Into a document that already has
        content, you get a line-by-line diff and decide what to keep — nothing is written until
        you apply it, and what you apply lands as one undoable edit that merges with whatever
        your collaborators are typing.
      </span>

      {error && (
        <div className="notice" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

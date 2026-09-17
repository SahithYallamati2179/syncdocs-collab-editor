'use client'

import type { Editor } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'
import {
  ACCEPTED_IMPORT_TYPES,
  applyImport,
  chooseImportMode,
  MAX_IMPORT_BYTES,
  readImportedFile,
  SUPPORTED_IMPORT_LABEL,
} from '@/lib/import'
import { Icon } from '@/lib/icons'
import { formatBytes } from '@/lib/metrics'
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

/**
 * Upload is a single action, not a wizard.
 *
 * Choosing the file *is* the instruction — the file is read, placed and the
 * dialog closes. Where it goes is decided from the document's own state rather
 * than asked about (see chooseImportMode), and because the import lands as an
 * ordinary editing transaction, Ctrl+Z undoes the whole thing if the guess was
 * not what the person wanted. A confirmation step would have bought nothing
 * that undo does not already provide.
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
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = useCallback(
    async (file: File | undefined) => {
      if (!file || !editor) return
      setError(null)
      setBusy(file.name)

      try {
        const parsed = await readImportedFile(file)
        const content = parsed.json ?? parsed.html

        if (!content || (typeof content === 'string' && !content.trim())) {
          setError(`“${file.name}” had no content this editor could read.`)
          return
        }

        const mode = chooseImportMode(editor)
        if (!applyImport(editor, content, mode)) {
          setError('The editor rejected that content. Try saving the file as Markdown instead.')
          return
        }

        // Only ever fills a blank — never renames a document someone has
        // already titled.
        if (parsed.title && !title.trim()) onTitleChange(parsed.title)

        const note = parsed.warnings.length
          ? ` (${parsed.warnings.length} formatting detail${parsed.warnings.length === 1 ? '' : 's'} simplified)`
          : ''
        onToast(
          mode === 'replace'
            ? `Imported ${file.name}${note}`
            : `Added ${file.name} to the end${note}`,
        )
        onClose()
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [editor, title, onTitleChange, onToast, onClose],
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
        The file is placed for you — into an empty document it becomes the document, otherwise it
        is added at the end. It lands as a normal edit, so it merges with whatever your
        collaborators are typing, replicates to everyone, and <strong>Ctrl+Z</strong> undoes it.
      </span>

      {error && (
        <div className="notice" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

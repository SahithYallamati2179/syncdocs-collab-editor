'use client'

import type { Editor } from '@tiptap/react'
import { useRef, useState } from 'react'
import {
  ACCEPTED_IMPORT_TYPES,
  applyImport,
  MAX_IMPORT_BYTES,
  readImportedFile,
  SUPPORTED_IMPORT_LABEL,
  type ImportedDocument,
  type ImportMode,
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

interface Staged {
  file: File
  parsed: ImportedDocument
}

export function ImportDialog({
  editor,
  title,
  onClose,
  onToast,
  onTitleChange,
  readOnly,
}: ImportDialogProps) {
  const [staged, setStaged] = useState<Staged | null>(null)
  const [mode, setMode] = useState<ImportMode>('append')
  const [useFileTitle, setUseFileTitle] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setReading(true)
    try {
      const parsed = await readImportedFile(file)
      setStaged({ file, parsed })
      // Offer the file's own title only when it actually has one and the
      // document is still untitled — never silently overwrite a name someone
      // chose, and never propose the placeholder filename over a real title.
      setUseFileTitle(Boolean(parsed.title) && !title.trim())
    } catch (cause) {
      setStaged(null)
      setError((cause as Error).message)
    } finally {
      setReading(false)
    }
  }

  const confirm = () => {
    if (!editor || !staged) return
    const { parsed } = staged
    const content = parsed.json ?? parsed.html

    if (!content || (typeof content === 'string' && !content.trim())) {
      setError('That file had no content this editor could read.')
      return
    }

    const ok = applyImport(editor, content, mode)
    if (!ok) {
      setError('The editor rejected that content. Try exporting the file as Markdown instead.')
      return
    }

    if (useFileTitle && parsed.title) onTitleChange(parsed.title)
    onToast(
      mode === 'replace'
        ? `Replaced the document with ${staged.file.name}`
        : `Added ${staged.file.name} to the end`,
    )
    onClose()
  }

  if (readOnly) {
    return (
      <Modal title="Upload a document" onClose={onClose} width={560}>
        <div className="notice">
          You have view-only access to this document, and importing a file is an edit. Ask the
          owner for edit access, or start your own document and import it there.
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Upload a document"
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="topbar__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!staged || !editor}
            onClick={confirm}
          >
            <Icon name="upload" size={15} />
            {mode === 'replace' ? 'Replace document' : 'Add to document'}
          </button>
        </>
      }
    >
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
          accept(event.dataTransfer.files[0])
        }}
      >
        <span className="dropzone__icon">
          <Icon name="upload" size={20} />
        </span>
        <strong>{dragging ? 'Drop it here' : 'Drag a file here'}</strong>
        <span className="dropzone__hint">{SUPPORTED_IMPORT_LABEL}</span>
        <button type="button" className="btn btn--soft" onClick={() => inputRef.current?.click()}>
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPTED_IMPORT_TYPES}
          onChange={(event) => {
            accept(event.target.files?.[0])
            // Reset so choosing the same file twice still fires a change event.
            event.target.value = ''
          }}
        />
        <span className="dropzone__hint">Up to {formatBytes(MAX_IMPORT_BYTES)}</span>
      </div>

      {reading && <div className="empty">Reading the file…</div>}

      {staged && (
        <>
          <div className="member-row">
            <span className="avatar avatar--sm" style={{ background: 'var(--primary)' }}>
              <Icon name="file" size={11} />
            </span>
            <span className="member-row__email">{staged.file.name}</span>
            <span className="member-row__tag">{formatBytes(staged.file.size)}</span>
          </div>

          <div className="field">
            <span className="field__label">Where it goes</span>
            <div className="choice-row">
              <button
                type="button"
                className="choice"
                data-active={mode === 'append' ? 'true' : 'false'}
                aria-pressed={mode === 'append'}
                onClick={() => setMode('append')}
              >
                <strong>Add to the end</strong>
                <span>Keeps what is already here and appends the file below it.</span>
              </button>
              <button
                type="button"
                className="choice"
                data-active={mode === 'replace' ? 'true' : 'false'}
                aria-pressed={mode === 'replace'}
                onClick={() => setMode('replace')}
              >
                <strong>Replace everything</strong>
                <span>Clears the document first. Undo brings it straight back.</span>
              </button>
            </div>
          </div>

          {staged.parsed.title && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={useFileTitle}
                onChange={(event) => setUseFileTitle(event.target.checked)}
              />
              <span>
                Rename this document to <strong>{staged.parsed.title}</strong>
              </span>
            </label>
          )}

          {staged.parsed.warnings.length > 0 && (
            <div className="notice">
              <strong>Some formatting was simplified.</strong>
              <ul className="notice__list">
                {staged.parsed.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <span className="field__hint">
            The import lands as a normal edit: it merges with whatever your collaborators are
            typing at that moment, it replicates to everyone, and Ctrl+Z undoes it.
          </span>
        </>
      )}

      {error && (
        <div className="notice" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

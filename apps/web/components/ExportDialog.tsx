'use client'

import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import {
  exportDocument,
  EXPORT_FORMATS,
  fileNameFor,
  printDocument,
  serialize,
  type ExportFormat,
} from '@/lib/export'
import { Icon } from '@/lib/icons'
import { formatBytes } from '@/lib/metrics'
import { Modal } from './Modal'

interface ExportDialogProps {
  editor: Editor | null
  documentId: string
  title: string
  onClose: () => void
  onToast: (message: string) => void
}

export function ExportDialog({
  editor,
  documentId,
  title,
  onClose,
  onToast,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('markdown')

  if (!editor) {
    return (
      <Modal title="Export" onClose={onClose} width={520}>
        <div className="empty">The document is still opening.</div>
      </Modal>
    )
  }

  const spec = EXPORT_FORMATS.find((entry) => entry.id === format) ?? EXPORT_FORMATS[0]
  // Generated for the preview anyway, so the size below is the real byte count
  // of the file you are about to get rather than an estimate.
  const preview = serialize(editor, title, format)
  const fileName = fileNameFor(title, documentId, spec.extension)

  return (
    <Modal
      title="Export a copy"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="btn" onClick={() => printDocument(editor, title)}>
            <Icon name="print" size={15} />
            Print / Save as PDF
          </button>
          <span className="topbar__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const name = exportDocument(editor, title, documentId, format)
              onToast(`Downloaded ${name}`)
              onClose()
            }}
          >
            <Icon name="download" size={15} />
            Download
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Format</span>
        <div className="format-grid">
          {EXPORT_FORMATS.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className="format-card"
              data-active={entry.id === format ? 'true' : 'false'}
              aria-pressed={entry.id === format}
              onClick={() => setFormat(entry.id)}
            >
              <span className="format-card__head">
                <strong>{entry.label}</strong>
                <span className="mono">.{entry.extension}</span>
              </span>
              <span className="format-card__hint">{entry.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">
          Preview — {fileName} · {formatBytes(new Blob([preview]).size)}
        </span>
        <pre className="export-preview">
          {preview.slice(0, 4000) || '(this document is empty)'}
          {preview.length > 4000 ? '\n…' : ''}
        </pre>
      </div>

      <span className="field__hint">
        Built from your local replica, so it works offline and mid-partition — you can always get
        your words out, even when the sync server cannot be reached.
      </span>
    </Modal>
  )
}

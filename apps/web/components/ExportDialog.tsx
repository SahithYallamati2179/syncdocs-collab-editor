'use client'

import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import {
  BINARY_FORMATS,
  exportDocument,
  EXPORT_FORMATS,
  fileNameFor,
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
  const [format, setFormat] = useState<ExportFormat>('docx')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!editor) {
    return (
      <Modal title="Export" onClose={onClose} width={520}>
        <div className="empty">The document is still opening.</div>
      </Modal>
    )
  }

  const spec = EXPORT_FORMATS.find((entry) => entry.id === format) ?? EXPORT_FORMATS[0]
  const isBinary = BINARY_FORMATS.includes(format)
  // Only the text formats are serialised up front. For those, the size shown is
  // the real byte count of the file you are about to get rather than an
  // estimate; rendering a .docx or a PNG purely to display a number would be
  // work thrown away.
  const preview = isBinary ? null : serialize(editor, title, format)
  const fileName = fileNameFor(title, documentId, spec.extension)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const name = await exportDocument(editor, title, documentId, format)
      onToast(format === 'pdf' ? 'Opening the print dialog…' : `Downloaded ${name}`)
      onClose()
    } catch (cause) {
      setError((cause as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Export a copy"
      onClose={onClose}
      width={660}
      footer={
        <>
          <span className="topbar__spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={busy}>
            <Icon name={format === 'pdf' ? 'print' : 'download'} size={15} />
            {busy ? 'Preparing…' : format === 'pdf' ? 'Open print dialog' : 'Download'}
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Format</span>
        <div className="format-grid format-grid--wide">
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

      {preview !== null ? (
        <div className="field">
          <span className="field__label">
            Preview — {fileName} · {formatBytes(new Blob([preview]).size)}
          </span>
          <pre className="export-preview">
            {preview.slice(0, 4000) || '(this document is empty)'}
            {preview.length > 4000 ? '\n…' : ''}
          </pre>
        </div>
      ) : (
        <div className="field">
          <span className="field__label">
            {format === 'pdf' ? 'How this works' : fileName}
          </span>
          <div className="notice">
            {format === 'pdf' && (
              <>
                Your browser already has a capable PDF writer behind the print dialog, and it
                handles pagination, fonts and remote images properly. Pick{' '}
                <strong>Save as PDF</strong> as the destination. Only the document is printed —
                the sidebar, toolbar and comments panel are left out.
              </>
            )}
            {format === 'docx' && (
              <>
                A genuine Word file, not an HTML page wearing a .docx extension. Headings, lists,
                tables, text formatting and clickable links all survive. Images become a labelled
                placeholder carrying their URL, because this editor stores pictures by link
                rather than by value.
              </>
            )}
            {(format === 'png' || format === 'jpg') && (
              <>
                The document rendered at twice screen resolution. Remote images and web fonts
                will not appear — an image rendered this way cannot fetch them — so choose PDF if
                you need a pixel-faithful copy.
              </>
            )}
          </div>
        </div>
      )}

      <span className="field__hint">
        Built from your local replica, so it works offline and mid-partition — you can always get
        your words out, even when the sync server cannot be reached.
      </span>

      {error && (
        <div className="notice" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import { fetchSnapshotDoc, fetchSnapshots, type SnapshotMeta } from '@/lib/documents'
import { formatBytes } from '@/lib/metrics'
import { Modal } from './Modal'

interface VersionHistoryDialogProps {
  documentId: string
  editor: Editor | null
  onClose: () => void
  onToast: (message: string) => void
}

/**
 * Version history reads the snapshot rows the sync server writes on an interval.
 *
 * Each row carries the display name of whoever edited last before it was
 * taken. That is an honest label rather than a full audit trail: a version can
 * contain work from several people, and it names the most recent of them.
 *
 * "Restore" does not rewind history — you cannot un-happen operations in a CRDT
 * and still converge. It applies a *compensating edit*: the current content is
 * replaced with the snapshot's content as a new set of operations, which every
 * peer merges normally. The snapshot itself is never mutated.
 */
export function VersionHistoryDialog({
  documentId,
  editor,
  onClose,
  onToast,
}: VersionHistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetchSnapshots(documentId)
      .then(setSnapshots)
      .catch((cause: Error) => {
        setError(cause.message)
        setSnapshots([])
      })
  }, [documentId])

  const load = async (id: string) => {
    setBusy(id)
    try {
      const doc = await fetchSnapshotDoc(documentId, id)
      const text = doc.getXmlFragment('default').toString().replace(/<[^>]+>/g, ' ').trim()
      setPreview({ id, text: text.slice(0, 1200) || '(empty document)' })
      doc.destroy()
    } catch (cause) {
      onToast((cause as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const restore = async (id: string) => {
    if (!editor) return
    setBusy(id)
    try {
      const doc = await fetchSnapshotDoc(documentId, id)
      const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default'))
      doc.destroy()
      // setContent goes through the normal editor transaction path, so the
      // change syncs to every peer like any other edit.
      editor.commands.setContent(json as never, true)
      onToast('Document restored from snapshot')
      onClose()
    } catch (cause) {
      onToast(`Restore failed: ${(cause as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title="Version history" onClose={onClose} width={620}>
      {snapshots === null && <div className="empty">Loading snapshots…</div>}
      {error && <div className="notice">{error}</div>}

      {snapshots?.length === 0 && !error && (
        <div className="notice">
          No snapshots yet. The server writes one at most every{' '}
          <span className="mono">SNAPSHOT_INTERVAL_MS</span> (5 minutes by default) while a document
          is being edited, so give it a moment or lower that value to see history build up.
        </div>
      )}

      {snapshots?.map((snapshot) => (
        <div className="version-row" key={snapshot.id}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="version-row__when">
              {new Date(snapshot.createdAt).toLocaleString()}
            </div>
            <div className="version-row__meta">
              {snapshot.author ? (
                <>
                  <span className="version-row__author">{snapshot.author}</span>
                  {' · '}
                </>
              ) : null}
              {formatBytes(snapshot.bytes)} encoded
            </div>
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => load(snapshot.id)}
          >
            Preview
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy !== null || !editor}
            onClick={() => restore(snapshot.id)}
          >
            {busy === snapshot.id ? 'Working…' : 'Restore'}
          </button>
        </div>
      ))}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div className="field__label" style={{ marginBottom: 6 }}>
            Preview · {new Date(
              snapshots?.find((snapshot) => snapshot.id === preview.id)?.createdAt ?? Date.now(),
            ).toLocaleString()}
            {snapshots?.find((snapshot) => snapshot.id === preview.id)?.author
              ? ` · last edited by ${snapshots.find((snapshot) => snapshot.id === preview.id)?.author}`
              : ''}
          </div>
          <div className="notice" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
            {preview.text}
          </div>
        </div>
      )}
    </Modal>
  )
}

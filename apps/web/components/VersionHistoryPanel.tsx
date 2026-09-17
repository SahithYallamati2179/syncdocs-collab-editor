'use client'

import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useState } from 'react'
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import { fetchSnapshotDoc, fetchSnapshots, type SnapshotMeta } from '@/lib/documents'
import { Icon } from '@/lib/icons'
import { formatBytes } from '@/lib/metrics'

interface VersionHistoryPanelProps {
  documentId: string
  editor: Editor | null
  onToast: (message: string) => void
  /** Bumped by the shell when the server reports another write. */
  refreshToken: number
}

/**
 * Version history, living inside the Activity tab.
 *
 * It sits next to the live event log because the two answer the same question
 * at different resolutions: the log is what has happened to this document in
 * the last few minutes, and this is what happened to it over its lifetime.
 * Splitting them across a panel and a modal meant opening a dialog to answer
 * half of one thought.
 *
 * "Restore" does not rewind history — you cannot un-happen operations in a
 * CRDT and still converge. It applies a *compensating edit*: the current
 * content is replaced with the snapshot's as a new set of operations, which
 * every peer merges normally. The snapshot itself is never mutated, so
 * restoring is itself undoable and leaves the history intact.
 */
export function VersionHistoryPanel({
  documentId,
  editor,
  onToast,
  refreshToken,
}: VersionHistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null)

  const load = useCallback(() => {
    fetchSnapshots(documentId)
      .then((list) => {
        setSnapshots(list)
        setError(null)
      })
      .catch((cause: Error) => {
        setError(cause.message)
        setSnapshots([])
      })
  }, [documentId])

  useEffect(load, [load, refreshToken])

  const showPreview = async (id: string) => {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    setBusy(id)
    try {
      const doc = await fetchSnapshotDoc(documentId, id)
      const text = doc.getXmlFragment('default').toString().replace(/<[^>]+>/g, ' ').trim()
      setPreview({ id, text: text.slice(0, 600) || '(empty document)' })
      doc.destroy()
    } catch (cause) {
      onToast((cause as Error).message)
      setOpenId(null)
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
      // change syncs to every peer like any other edit — and undoes like one.
      editor.commands.setContent(json as never, true)
      onToast('Restored. Ctrl+Z puts it back.')
    } catch (cause) {
      onToast(`Restore failed: ${(cause as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="history">
      <div className="history__head">
        <Icon name="history" size={13} />
        <span>Version history</span>
        {snapshots && snapshots.length > 0 && (
          <span className="badge">{snapshots.length}</span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="link-btn" onClick={load} title="Check for new versions">
          Refresh
        </button>
      </div>

      {snapshots === null && <div className="empty">Loading versions…</div>}

      {error && <div className="notice">{error}</div>}

      {snapshots?.length === 0 && !error && (
        <div className="empty">
          No versions yet. The server writes one at most every few minutes while a document is
          being edited.
        </div>
      )}

      {snapshots?.map((snapshot) => (
        <div className="history__item" key={snapshot.id} data-open={openId === snapshot.id}>
          <button
            type="button"
            className="history__row"
            onClick={() => showPreview(snapshot.id)}
            aria-expanded={openId === snapshot.id}
          >
            <span className="history__when">
              {new Date(snapshot.createdAt).toLocaleString()}
            </span>
            <span className="history__meta">
              {snapshot.author ? (
                <>
                  <strong>{snapshot.author}</strong>
                  {' · '}
                </>
              ) : null}
              {formatBytes(snapshot.bytes)}
            </span>
          </button>

          {openId === snapshot.id && (
            <div className="history__body">
              <div className="history__preview">
                {busy === snapshot.id && !preview ? 'Loading…' : preview?.text}
              </div>
              <button
                type="button"
                className="btn btn--soft"
                disabled={busy !== null || !editor}
                onClick={() => restore(snapshot.id)}
              >
                {busy === snapshot.id ? 'Working…' : 'Restore this version'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

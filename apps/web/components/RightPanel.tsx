'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import type { CollabSession } from '@/lib/collab'
import { revealComment } from '@/lib/comment-mark'
import { initialsFor } from '@/lib/colors'
import {
  addComment,
  deleteComment,
  relativeTime,
  setResolved,
  type CommentThread,
} from '@/lib/comments'
import { Icon } from '@/lib/icons'
import type { Identity } from '@/lib/identity'
import type { MetricsSnapshot } from '@/lib/metrics'

interface RightPanelProps {
  session: CollabSession | null
  identity: Identity
  threads: CommentThread[]
  snapshot: MetricsSnapshot
  editor: Editor | null
  onClose: () => void
}

function CommentCard({
  thread,
  session,
  identity,
  editor,
}: {
  thread: CommentThread
  session: CollabSession
  identity: Identity
  editor: Editor | null
}) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')

  const submitReply = () => {
    if (!draft.trim()) return
    addComment(session.doc, identity, draft, thread.id)
    setDraft('')
    setReplying(false)
  }

  return (
    <div className="comment" data-resolved={thread.resolved ? 'true' : 'false'}>
      <div className="comment__head">
        <span className="avatar avatar--sm" style={{ background: thread.authorColor }}>
          {initialsFor(thread.authorName)}
        </span>
        <span className="comment__author">{thread.authorName}</span>
        <span className="comment__time">{relativeTime(thread.createdAt)}</span>
      </div>

      {thread.quote && (
        <button
          type="button"
          className="comment__quote"
          title="Jump to this text in the document"
          onClick={() => {
            if (!revealComment(thread.id)) {
              // The marked text is gone, which is a normal outcome: someone
              // deleted the sentence this thread was about.
              window.alert('The text this comment was attached to is no longer in the document.')
            }
          }}
        >
          <Icon name="quote" size={12} />
          <span>{thread.quote}</span>
        </button>
      )}

      <div className="comment__body">{thread.body}</div>

      {thread.replies.length > 0 && (
        <div className="comment__replies">
          {thread.replies.map((reply) => (
            <div key={reply.id}>
              <div className="reply__head">
                <span className="avatar avatar--sm" style={{ background: reply.authorColor }}>
                  {initialsFor(reply.authorName)}
                </span>
                <span className="reply__author">{reply.authorName}</span>
                <span className="comment__time">{relativeTime(reply.createdAt)}</span>
              </div>
              <div className="comment__body">{reply.body}</div>
            </div>
          ))}
        </div>
      )}

      {replying ? (
        <div className="composer" style={{ marginTop: 9 }}>
          <textarea
            className="textarea"
            value={draft}
            autoFocus
            placeholder={`Reply to ${thread.authorName}…`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitReply()
              if (event.key === 'Escape') setReplying(false)
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={submitReply}
              disabled={!draft.trim()}
            >
              Reply
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setReplying(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="comment__actions">
          <button type="button" className="link-btn" onClick={() => setReplying(true)}>
            Reply
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              const next = !thread.resolved
              setResolved(session.doc, thread.id, next)
              // Keep the highlight in step with the thread's state.
              editor?.commands.setCommentResolved(thread.id, next)
            }}
          >
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
          {thread.authorId === identity.id && (
            <button
              type="button"
              className="link-btn"
              style={{ color: 'var(--ink-3)' }}
              onClick={() => {
                deleteComment(session.doc, thread.id)
                // Otherwise the highlight outlives the comment and nothing in
                // the panel explains why that text is shaded.
                editor?.commands.unsetCommentMark(thread.id)
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function RightPanel({
  session,
  identity,
  threads,
  snapshot,
  editor,
  onClose,
}: RightPanelProps) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const [draft, setDraft] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [selection, setSelection] = useState('')

  const visible = showResolved ? threads : threads.filter((thread) => !thread.resolved)
  const unresolved = threads.filter((thread) => !thread.resolved).length

  /**
   * Track what is selected in the editor so the composer can offer to attach
   * the comment to it. Read here rather than at submit time because the
   * selection is gone by then -- clicking into the textarea blurs the editor.
   */
  useEffect(() => {
    if (!editor) return
    const read = () => {
      const { from, to, empty } = editor.state.selection
      setSelection(empty ? '' : editor.state.doc.textBetween(from, to, ' ').trim())
    }
    read()
    editor.on('selectionUpdate', read)
    editor.on('transaction', read)
    return () => {
      editor.off('selectionUpdate', read)
      editor.off('transaction', read)
    }
  }, [editor])

  const submit = () => {
    if (!session || !draft.trim()) return

    // Capture before the comment is created: applying the mark needs the range
    // that is selected right now.
    const range = editor && !editor.state.selection.empty ? editor.state.selection : null
    const quote = range ? selection : ''

    const id = addComment(session.doc, identity, draft, null, quote)
    if (id && range && editor) {
      // One chain so the mark lands as a single undoable step alongside the
      // selection restore, rather than leaving the caret somewhere surprising.
      editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).setCommentMark(id).run()
    }
    setDraft('')
  }

  return (
    <aside className="panel">
      <div className="panel__head">
        <span className="panel__title">Collaboration</span>
        {unresolved > 0 && <span className="badge">{unresolved} open</span>}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close collaboration panel"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === 'comments'}
          onClick={() => setTab('comments')}
        >
          Comments
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === 'activity'}
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
      </div>

      <div className="panel__scroll">
        {tab === 'comments' && (
          <>
            {visible.length === 0 && (
              <div className="empty">
                {threads.length === 0
                  ? 'No comments yet. Comments are stored in the document itself, so they merge like any other edit.'
                  : 'No open comments.'}
              </div>
            )}
            {session &&
              visible.map((thread) => (
                <CommentCard
                  key={thread.id}
                  thread={thread}
                  editor={editor}
                  session={session}
                  identity={identity}
                />
              ))}
            {threads.some((thread) => thread.resolved) && (
              <button
                type="button"
                className="link-btn"
                style={{ marginTop: 4 }}
                onClick={() => setShowResolved((value) => !value)}
              >
                {showResolved ? 'Hide resolved' : `Show resolved (${threads.length - unresolved})`}
              </button>
            )}
          </>
        )}

        {tab === 'activity' && (
          <>
            {snapshot.events.length === 0 && <div className="empty">Nothing recorded yet.</div>}
            {snapshot.events
              .slice()
              .reverse()
              .map((event) => (
                <div className="activity-row" key={`${event.t}-${event.message}`}>
                  <span className="activity-row__time">
                    {new Date(event.t).toLocaleTimeString()}
                  </span>
                  <span>
                    <span className={`activity-row__kind kind--${event.kind}`}>{event.kind}</span>
                    <br />
                    {event.message}
                  </span>
                </div>
              ))}
          </>
        )}
      </div>

      {tab === 'comments' && (
        <div className="panel__foot">
          <div className="composer">
            {selection ? (
              <div className="composer__target" title={selection}>
                <Icon name="quote" size={12} />
                <span>{selection}</span>
              </div>
            ) : (
              <div className="composer__target composer__target--empty">
                Select text in the document to attach a comment to it.
              </div>
            )}

            <textarea
              className="textarea"
              placeholder={selection ? 'Comment on the selected text…' : 'Add a comment…'}
              value={draft}
              disabled={!session}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              onClick={submit}
              disabled={!session || !draft.trim()}
            >
              {selection ? 'Comment on selection' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

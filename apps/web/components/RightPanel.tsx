'use client'

import { useState } from 'react'
import type { CollabSession } from '@/lib/collab'
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
  onClose: () => void
}

function CommentCard({
  thread,
  session,
  identity,
}: {
  thread: CommentThread
  session: CollabSession
  identity: Identity
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
            onClick={() => setResolved(session.doc, thread.id, !thread.resolved)}
          >
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
          {thread.authorId === identity.id && (
            <button
              type="button"
              className="link-btn"
              style={{ color: 'var(--ink-3)' }}
              onClick={() => deleteComment(session.doc, thread.id)}
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
  onClose,
}: RightPanelProps) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const [draft, setDraft] = useState('')
  const [showResolved, setShowResolved] = useState(false)

  const visible = showResolved ? threads : threads.filter((thread) => !thread.resolved)
  const unresolved = threads.filter((thread) => !thread.resolved).length

  const submit = () => {
    if (!session || !draft.trim()) return
    addComment(session.doc, identity, draft)
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
            <textarea
              className="textarea"
              placeholder="Add a comment…"
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
              Comment
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

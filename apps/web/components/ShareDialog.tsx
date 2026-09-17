'use client'

import { useEffect, useState } from 'react'
import {
  addDocumentMember,
  fetchDocumentAccess,
  removeDocumentMember,
  type DocumentAccess,
} from '@/lib/documents'
import { Icon } from '@/lib/icons'
import { authEnabled } from '@/lib/supabase'
import { Modal } from './Modal'

interface ShareDialogProps {
  documentId: string
  onClose: () => void
  onToast: (message: string) => void
}

export function ShareDialog({ documentId, onClose, onToast }: ShareDialogProps) {
  const [url] = useState(() =>
    typeof window === 'undefined' ? '' : `${window.location.origin}/doc/${documentId}`,
  )
  const [access, setAccess] = useState<DocumentAccess | null>(null)
  const [loading, setLoading] = useState(authEnabled)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authEnabled) return
    fetchDocumentAccess(documentId)
      .then(setAccess)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [documentId])

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      onToast(`${label} copied`)
    } catch {
      onToast('Clipboard blocked — select and copy manually')
    }
  }

  const invite = async () => {
    const target = email.trim()
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      setAccess(await addDocumentMember(documentId, target))
      setEmail('')
      onToast(`${target} can now open this document`)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (target: string) => {
    setBusy(true)
    setError(null)
    try {
      setAccess(await removeDocumentMember(documentId, target))
      onToast(`Removed ${target}`)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Share this document" onClose={onClose} width={560}>
      <div className="field">
        <span className="field__label">Link</span>
        <div className="copy-row">
          <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn--primary" onClick={() => copy(url, 'Link')}>
            Copy
          </button>
        </div>
        <span className="field__hint">
          {authEnabled
            ? 'The link alone is not enough — the person also has to be invited below.'
            : 'Anyone who opens this link joins the same document and can edit it.'}
        </span>
      </div>

      {!authEnabled && (
        <div className="notice">
          <strong>Access is by link.</strong> Google sign-in is not configured, so the server does
          not restrict who may open a document. Set{' '}
          <span className="mono">NEXT_PUBLIC_SUPABASE_URL</span> and{' '}
          <span className="mono">AUTH_MODE=supabase</span> to turn on per-document access control.
        </div>
      )}

      {authEnabled && loading && <div className="empty">Loading access…</div>}

      {authEnabled && !loading && access && (
        <>
          <div className="field">
            <span className="field__label">People with access</span>

            <div className="member-row">
              <span className="avatar avatar--sm" style={{ background: 'var(--primary)' }}>
                <Icon name="users" size={11} />
              </span>
              <span className="member-row__email">{access.acl?.ownerEmail || 'Owner'}</span>
              <span className="member-row__tag">owner</span>
            </div>

            {access.acl?.members.map((member) => (
              <div className="member-row" key={member.email}>
                <span className="avatar avatar--sm" style={{ background: 'var(--ink-3)' }}>
                  {member.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="member-row__email">{member.email}</span>
                {access.isOwner ? (
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => revoke(member.email)}
                  >
                    Remove
                  </button>
                ) : (
                  <span className="member-row__tag">invited</span>
                )}
              </div>
            ))}

            {access.acl?.members.length === 0 && (
              <span className="field__hint">Only you so far.</span>
            )}
          </div>

          {access.isOwner ? (
            <div className="field">
              <span className="field__label">Invite by Google account</span>
              <div className="copy-row">
                <input
                  className="input"
                  type="email"
                  placeholder="teammate@example.com"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') invite()
                  }}
                />
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={invite}
                  disabled={busy || !email.trim()}
                >
                  Invite
                </button>
              </div>
              <span className="field__hint">
                They sign in with that Google address to get in. Invites work before they have ever
                used the app.
              </span>
            </div>
          ) : (
            <div className="notice">Only the owner can change who has access.</div>
          )}
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

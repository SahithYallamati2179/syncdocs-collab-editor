'use client'

import { useEffect, useRef, useState } from 'react'
import {
  addDocumentMember,
  fetchDocumentAccess,
  LINK_ACCESS_OPTIONS,
  removeDocumentMember,
  setLinkAccess,
  type DocumentAccess,
  type LinkAccess,
} from '@/lib/documents'
import { Icon } from '@/lib/icons'
import { authEnabled } from '@/lib/supabase'
import { Modal } from './Modal'

interface ShareDialogProps {
  documentId: string
  title: string
  onClose: () => void
  onToast: (message: string) => void
  /** Lifted so the editor learns about a demotion to viewer without a reload. */
  access: DocumentAccess | null
  onAccessChange: (access: DocumentAccess) => void
  onExport: () => void
}

function initial(email: string): string {
  return email.slice(0, 1).toUpperCase() || '?'
}

export function ShareDialog({
  documentId,
  title,
  onClose,
  onToast,
  access,
  onAccessChange,
  onExport,
}: ShareDialogProps) {
  const [url] = useState(() =>
    typeof window === 'undefined' ? '' : `${window.location.origin}/doc/${documentId}`,
  )
  const [loading, setLoading] = useState(authEnabled && !access)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [levelOpen, setLevelOpen] = useState(false)
  const levelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authEnabled || access) return
    fetchDocumentAccess(documentId)
      .then(onAccessChange)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [documentId, access, onAccessChange])

  useEffect(() => {
    if (!levelOpen) return
    const onDown = (event: MouseEvent) => {
      if (!levelRef.current?.contains(event.target as Node)) setLevelOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [levelOpen])

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      onToast(`${label} copied`)
    } catch {
      // Clipboard access is denied in insecure contexts and in some embedded
      // webviews. Selecting the text is the fallback that always works.
      const field = document.querySelector<HTMLInputElement>('.share-link input')
      field?.select()
      onToast('Clipboard blocked — the link is selected, press Ctrl+C')
    }
  }

  const run = async (action: () => Promise<DocumentAccess>, success: string) => {
    setBusy(true)
    setError(null)
    try {
      onAccessChange(await action())
      onToast(success)
      return true
    } catch (cause) {
      setError((cause as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const invite = async () => {
    const target = email.trim()
    if (!target) return
    const ok = await run(
      () => addDocumentMember(documentId, target),
      `${target} can now open this document`,
    )
    if (ok) setEmail('')
  }

  const chooseLevel = async (level: LinkAccess) => {
    setLevelOpen(false)
    if (level === access?.linkAccess) return
    const option = LINK_ACCESS_OPTIONS.find((entry) => entry.id === level)
    await run(() => setLinkAccess(documentId, level), `Link access: ${option?.label ?? level}`)
  }

  const current =
    LINK_ACCESS_OPTIONS.find((option) => option.id === access?.linkAccess) ??
    LINK_ACCESS_OPTIONS[0]
  const isOwner = access?.isOwner ?? false
  const members = access?.acl?.members ?? []

  return (
    <Modal title="Share this document" onClose={onClose} width={560}>
      {authEnabled && loading && <div className="empty">Loading access…</div>}

      {authEnabled && !loading && access?.isGuest && (
        <div className="notice">
          <strong>You are viewing this as a guest.</strong> The owner opened this document to
          anyone with the link, so no account was needed. Sign in if you want documents of your
          own — the people and access settings belong to the owner.
        </div>
      )}

      {authEnabled && !loading && access && !access.isGuest && (
        <>
          <div className="field">
            <span className="field__label">People with access</span>

            <div className="member-row">
              <span className="avatar avatar--sm" style={{ background: 'var(--primary)' }}>
                {initial(access.acl?.ownerEmail ?? '')}
              </span>
              <span className="member-row__email">{access.acl?.ownerEmail || 'Owner'}</span>
              <span className="member-row__tag">owner</span>
            </div>

            {members.map((member) => (
              <div className="member-row" key={member.email}>
                <span className="avatar avatar--sm" style={{ background: 'var(--ink-3)' }}>
                  {initial(member.email)}
                </span>
                <span className="member-row__email">{member.email}</span>
                {isOwner ? (
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => removeDocumentMember(documentId, member.email),
                        `Removed ${member.email}`,
                      )
                    }
                  >
                    Remove
                  </button>
                ) : (
                  <span className="member-row__tag">invited</span>
                )}
              </div>
            ))}

            {members.length === 0 && (
              <span className="field__hint">
                {isOwner ? 'Only you so far.' : 'Nobody else has been invited.'}
              </span>
            )}
          </div>

          {isOwner && (
            <div className="field">
              <span className="field__label">Add people</span>
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
                They sign in with that Google address to get in. An invitation works before they
                have ever used the app.
              </span>
            </div>
          )}

          <div className="field">
            <span className="field__label">Access level</span>

            <div className="access-level" ref={levelRef}>
              <button
                type="button"
                className="access-level__trigger"
                disabled={!isOwner || busy}
                aria-expanded={levelOpen}
                aria-haspopup="listbox"
                onClick={() => setLevelOpen((open) => !open)}
                title={
                  isOwner ? 'Change what the link grants' : 'Only the owner can change this'
                }
              >
                <span className="access-level__icon">
                  <Icon name={current.icon} size={15} />
                </span>
                <span className="access-level__label">{current.label}</span>
                {isOwner && <Icon name="chevronDown" size={15} />}
              </button>

              {levelOpen && (
                <div className="access-menu" role="listbox">
                  {LINK_ACCESS_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className="access-menu__item"
                      role="option"
                      aria-selected={option.id === current.id}
                      onClick={() => chooseLevel(option.id)}
                    >
                      <span className="access-level__icon">
                        <Icon name={option.icon} size={15} />
                      </span>
                      <span className="access-menu__text">
                        <strong>{option.label}</strong>
                        <span>
                          {option.detail}
                          {option.note && (
                            <>
                              {' '}
                              <strong className="access-menu__note">{option.note}</strong>
                            </>
                          )}
                        </span>
                      </span>
                      {option.id === current.id && <Icon name="check" size={15} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!isOwner && (
              <span className="field__hint">Only the owner can change who has access.</span>
            )}
          </div>
        </>
      )}

      <div className="field share-link">
        <div className="copy-row">
          <input
            className="input"
            readOnly
            value={url}
            aria-label="Link to this document"
            onFocus={(event) => event.target.select()}
          />
        </div>
        <button
          type="button"
          className="btn btn--primary btn--wide"
          onClick={() => copy(url, 'Link')}
        >
          <Icon name="link" size={15} />
          Copy link
        </button>
        <span className="field__hint">
          {!authEnabled
            ? 'Anyone who opens this link joins the same document and can edit it.'
            : access?.linkAccess === 'restricted'
              ? 'The link alone is not enough — the person also has to be invited above, or you can open the link up.'
              : access?.linkAccess === 'view'
                ? 'Anyone who opens this link can read the document, with no sign-in. Only people you invite see it listed in their explorer.'
                : 'Anyone who opens this link can edit the document, with no sign-in. Only people you invite see it listed in their explorer.'}
        </span>
      </div>

      <div className="field">
        <span className="field__label">Export a copy</span>
        <button type="button" className="btn btn--soft btn--wide" onClick={onExport}>
          <Icon name="download" size={15} />
          Download or print {title.trim() ? `“${title.trim()}”` : 'this document'}
        </button>
        <span className="field__hint">
          Markdown, HTML, plain text or JSON. Exports are built from your local replica, so they
          work offline and during a partition.
        </span>
      </div>

      {!authEnabled && (
        <div className="notice">
          <strong>Access is by link.</strong> Google sign-in is not configured, so the server does
          not restrict who may open a document, and there is no access level to choose. Set{' '}
          <span className="mono">NEXT_PUBLIC_SUPABASE_URL</span> and{' '}
          <span className="mono">AUTH_MODE=supabase</span> to turn on per-document access control.
        </div>
      )}

      {error && (
        <div className="notice" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

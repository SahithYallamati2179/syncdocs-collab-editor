'use client'

import { useState } from 'react'
import { Icon, type IconName } from '@/lib/icons'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  body: React.ReactNode
  confirmLabel: string
  /** Typed-to-confirm guard. When set, the button stays disabled until it matches. */
  requirePhrase?: string
  tone?: 'danger' | 'default'
  icon?: IconName
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

/**
 * A confirmation that is proportional to the damage.
 *
 * `requirePhrase` exists because a destructive action reached by one click
 * should not be *confirmed* by one click in the same place — muscle memory
 * carries straight through an "Are you sure?" that only needs another Enter.
 * Making the person type the document's name forces them to read what they are
 * about to destroy.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  requirePhrase,
  tone = 'danger',
  icon = 'trash',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = !requirePhrase || typed.trim() === requirePhrase

  const run = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (cause) {
      setError((cause as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <span className="topbar__spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn btn--danger' : 'btn btn--primary'}
            onClick={run}
            disabled={busy || !ready}
          >
            <Icon name={icon} size={15} />
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="field">{body}</div>

      {requirePhrase && (
        <div className="field">
          <span className="field__label">
            Type <span className="mono">{requirePhrase}</span> to confirm
          </span>
          <input
            className="input"
            value={typed}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder={requirePhrase}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && ready) void run()
            }}
          />
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

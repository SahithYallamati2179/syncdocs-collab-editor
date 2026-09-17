'use client'

import { useState } from 'react'
import { signOut } from '@/lib/auth'
import { initialsFor } from '@/lib/colors'
import { HTTP_URL, type ServerStats } from '@/lib/documents'
import { Icon } from '@/lib/icons'
import { setDisplayName, type Identity } from '@/lib/identity'
import { formatBytes } from '@/lib/metrics'
import { authEnabled } from '@/lib/supabase'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { Modal } from './Modal'

interface SettingsDialogProps {
  identity: Identity
  onIdentityChange: (identity: Identity) => void
  stats: ServerStats | null
  onClose: () => void
}

const THEMES: { value: ThemePreference; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

export function SettingsDialog({
  identity,
  onIdentityChange,
  stats,
  onClose,
}: SettingsDialogProps) {
  const [name, setName] = useState(identity.name)
  const [theme, setTheme] = useTheme()
  const [signingOut, setSigningOut] = useState(false)

  const commit = () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === identity.name) return
    onIdentityChange(setDisplayName(trimmed))
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={540}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="field">
        <span className="field__label">Account</span>

        {authEnabled ? (
          <>
            <div className="member-row">
              {identity.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="avatar"
                  src={identity.picture}
                  alt=""
                  width={28}
                  height={28}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="avatar" style={{ background: identity.color }}>
                  {initialsFor(identity.name || '?')}
                </span>
              )}
              <span className="member-row__email">
                <strong style={{ display: 'block', color: 'var(--ink)' }}>{identity.name}</strong>
                {identity.email}
              </span>
              <span className="member-row__tag">Google</span>
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--danger"
                disabled={signingOut}
                onClick={async () => {
                  setSigningOut(true)
                  await signOut()
                }}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
            <span className="field__hint">
              Your name and picture come from your Google account. Your cursor colour is derived
              from your user id, so it is stable across sign-ins.
            </span>
          </>
        ) : (
          <>
            <div className="copy-row">
              <span className="avatar" style={{ background: identity.color }}>
                {initialsFor(name || '?')}
              </span>
              <input
                className="input"
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commit()
                    event.currentTarget.blur()
                  }
                }}
              />
            </div>
            <span className="field__hint">
              Google sign-in is not configured, so this is a local display name only — not an
              account. See the README to enable it.
            </span>
          </>
        )}
      </div>

      <div className="field">
        <span className="field__label">Appearance</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={theme === option.value ? 'btn btn--primary' : 'btn'}
              onClick={() => setTheme(option.value)}
              aria-pressed={theme === option.value}
            >
              <Icon name={option.icon} size={14} />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <span className="field__label">Sync server</span>
        {stats ? (
          <div className="notice">
            <div className="mono">{HTTP_URL}</div>
            <div style={{ marginTop: 6 }}>
              Up {stats.uptimeSeconds}s · {stats.connections} socket
              {stats.connections === 1 ? '' : 's'} · {stats.openDocuments} document
              {stats.openDocuments === 1 ? '' : 's'} in memory
            </div>
            <div>
              {stats.writes} persist write{stats.writes === 1 ? '' : 's'} ·{' '}
              {formatBytes(stats.bytesWritten)} · {stats.snapshots} snapshot
              {stats.snapshots === 1 ? '' : 's'}
              {stats.authFailures > 0 && ` · ${stats.authFailures} rejected connection(s)`}
            </div>
          </div>
        ) : (
          <div className="notice">Sync server unreachable.</div>
        )}
      </div>
    </Modal>
  )
}

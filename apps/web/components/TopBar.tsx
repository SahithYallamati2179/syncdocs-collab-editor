'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { initialsFor } from '@/lib/colors'
import type { PresencePeer, PresenceStatus } from '@/lib/hooks'
import { Icon } from '@/lib/icons'
import type { Identity } from '@/lib/identity'
import type { MetricsSnapshot } from '@/lib/metrics'

interface TopBarProps {
  identity: Identity
  title: string
  onTitleChange: (next: string) => void
  peers: PresencePeer[]
  snapshot: MetricsSnapshot
  unresolvedComments: number
  sidebarOpen: boolean
  panelOpen: boolean
  onToggleSidebar: () => void
  onTogglePanel: () => void
  onOpenCommands: () => void
  onOpenShare: () => void
  onOpenSettings: () => void
  onOpenExport: () => void
  readOnly: boolean
  /** Viewing without an account, via a shared link. */
  isGuest: boolean
  onSignIn: () => void
}

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
}

/** "Active 4m ago", for a peer who has gone idle. */
function sinceLabel(at: number | null): string {
  if (at === null) return ''
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

export function StatusDot({ status }: { status: PresenceStatus }) {
  return (
    <span
      className="status-dot"
      data-status={status}
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
    />
  )
}

/** An avatar with its online/away/offline state attached to the corner. */
export function PresenceAvatar({
  peer,
  size = 'md',
}: {
  peer: PresencePeer
  size?: 'sm' | 'md'
}) {
  return (
    <span className="avatar-wrap">
      <span
        className={size === 'sm' ? 'avatar avatar--sm' : 'avatar'}
        style={{ background: peer.color }}
        title={peer.isSelf ? `${peer.name} (you)` : peer.name}
        data-status={peer.status}
      >
        {initialsFor(peer.name)}
      </span>
      <StatusDot status={peer.status} />
    </span>
  )
}

function SaveChip({ snapshot }: { snapshot: MetricsSnapshot }) {
  const state =
    snapshot.status !== 'connected' ? 'offline' : snapshot.synced ? 'saved' : 'saving'
  const label = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Local only'

  return (
    <span className="save-chip" data-state={state} title="Server persistence state">
      <span className="save-chip__dot" aria-hidden />
      {label}
    </span>
  )
}

export function TopBar({
  identity,
  title,
  onTitleChange,
  peers,
  snapshot,
  unresolvedComments,
  sidebarOpen,
  panelOpen,
  onToggleSidebar,
  onTogglePanel,
  onOpenCommands,
  onOpenShare,
  onOpenSettings,
  onOpenExport,
  readOnly,
  isGuest,
  onSignIn,
}: TopBarProps) {
  const [presenceOpen, setPresenceOpen] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const presenceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!presenceOpen) return
    const onDown = (event: MouseEvent) => {
      if (!presenceRef.current?.contains(event.target as Node)) setPresenceOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [presenceOpen])

  const statusTone =
    snapshot.status === 'connected' ? 'good' : snapshot.status === 'connecting' ? 'warn' : 'danger'
  const statusLabel =
    snapshot.status === 'connected'
      ? 'Connected'
      : snapshot.status === 'connecting'
        ? 'Connecting'
        : 'Offline'

  const others = peers.filter((peer) => !peer.isSelf)
  const activeOthers = others.filter((peer) => peer.status === 'online')

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Hide document explorer' : 'Show document explorer'}
        aria-expanded={sidebarOpen}
      >
        <Icon name="menu" size={18} />
      </button>

      <Link href="/" className="topbar__logo">
        <span className="logo-mark" aria-hidden>
          <Icon name="file" size={15} />
        </span>
        SyncDocs
      </Link>

      <span className="topbar__divider" aria-hidden />

      <span className="topbar__doc">
        <input
          ref={titleRef}
          className="title-input"
          value={title}
          placeholder="Untitled document"
          aria-label="Document title"
          readOnly={readOnly}
          onChange={(event) => onTitleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {!readOnly && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => titleRef.current?.focus()}
            aria-label="Rename document"
            title="Rename document"
          >
            <Icon name="pencil" size={13} />
          </button>
        )}
        {readOnly ? (
          <span className="save-chip" data-state="offline" title="You have view-only access">
            <Icon name="eye" size={12} />
            View only
          </span>
        ) : (
          <SaveChip snapshot={snapshot} />
        )}
      </span>

      <span className="topbar__spacer" />

      <button type="button" className="cmd-search" onClick={onOpenCommands}>
        <Icon name="search" size={14} />
        <span className="cmd-search__text">Quick command search…</span>
        <span className="kbd">⌘K</span>
      </button>

      <span className="topbar__spacer" />

      <span className="status-pill" title="Live connection to the sync server">
        <span className={`dot dot--${statusTone}`} aria-hidden />
        {statusLabel}
      </span>

      <div ref={presenceRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="presence"
          onClick={() => setPresenceOpen((open) => !open)}
          aria-expanded={presenceOpen}
          aria-label={`${peers.length} in this document`}
        >
          <span className="presence__stack">
            {peers.slice(0, 3).map((peer) => (
              <PresenceAvatar key={peer.clientId} peer={peer} />
            ))}
          </span>
          <span className="presence__label">
            {others.length === 0
              ? 'only you'
              : activeOthers.length === others.length
                ? `${others.length} editing`
                : `${activeOthers.length} of ${others.length} active`}
          </span>
        </button>

        {presenceOpen && (
          <div className="popover" style={{ right: 0, top: 'calc(100% + 6px)' }}>
            {peers.length === 0 && <div className="empty">Nobody connected yet.</div>}
            {peers.map((peer) => (
              <div className="popover__row" key={peer.clientId}>
                <PresenceAvatar peer={peer} size="sm" />
                <span className="popover__name">{peer.name}</span>
                <span className="popover__tag" data-status={peer.status}>
                  {peer.isSelf
                    ? 'you'
                    : peer.status === 'online'
                      ? 'Online'
                      : peer.status === 'away'
                        ? `Away · ${sinceLabel(peer.lastActiveAt)}`
                        : 'Offline'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="icon-btn"
        onClick={onOpenExport}
        aria-label="Export or print a copy"
        title="Export or print a copy"
      >
        <Icon name="download" size={17} />
      </button>

      <button type="button" className="btn btn--primary" onClick={onOpenShare}>
        <Icon name="share" size={14} />
        Share
      </button>

      <button
        type="button"
        className="icon-btn"
        onClick={onTogglePanel}
        aria-label={panelOpen ? 'Hide collaboration panel' : 'Show collaboration panel'}
        aria-expanded={panelOpen}
        title="Comments and activity"
      >
        <Icon name="panel" size={18} />
        {unresolvedComments > 0 && <span className="icon-btn__badge" aria-hidden />}
      </button>

      {isGuest ? (
        <button type="button" className="btn btn--soft" onClick={onSignIn}>
          Sign in
        </button>
      ) : (
        <button
          type="button"
          className="presence"
          onClick={onOpenSettings}
          aria-label="Your account and settings"
          title={`${identity.name} — settings`}
        >
          <span className="avatar" style={{ background: identity.color }}>
            {initialsFor(identity.name || '?')}
          </span>
        </button>
      )}
    </header>
  )
}

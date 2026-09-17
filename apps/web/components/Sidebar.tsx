'use client'

import { useRouter } from 'next/navigation'
import { DEFAULT_TITLE, storagePercent, type ServerDocument } from '@/lib/documents'
import { Icon, type IconName } from '@/lib/icons'
import { formatBytes } from '@/lib/metrics'

interface SidebarProps {
  documents: ServerDocument[] | null
  error: string | null
  activeId: string | null
  recents: string[]
  onCreate: () => void
  onOpenVersions: () => void
  onOpenSettings: () => void
  onNavigate?: () => void
}

function NavItem({
  icon,
  label,
  meta,
  active,
  onClick,
}: {
  icon: IconName
  label: string
  meta?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="nav-item"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      title={label}
    >
      <Icon name={icon} size={15} />
      <span className="nav-item__label">{label}</span>
      {meta && <span className="nav-item__meta">{meta}</span>}
    </button>
  )
}

/**
 * The explorer lists what is actually persisted on the sync server, falling
 * back to this browser's recents when the server is unreachable — so the panel
 * is never empty just because the backend is down.
 */
export function Sidebar({
  documents,
  error,
  activeId,
  recents,
  onCreate,
  onOpenVersions,
  onOpenSettings,
  onNavigate,
}: SidebarProps) {
  const router = useRouter()

  const open = (id: string) => {
    router.push(`/doc/${id}`)
    onNavigate?.()
  }

  const serverIds = new Set((documents ?? []).map((document) => document.name))
  const localOnly = recents.filter((id) => !serverIds.has(id))
  const percent = storagePercent(documents)

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__title">Explorer</span>
        <Icon name="sort" size={13} />
      </div>

      <button type="button" className="btn btn--soft sidebar__new" onClick={onCreate}>
        <Icon name="plus" size={14} />
        New Document
      </button>

      <div className="sidebar__scroll">
        {error && <div className="notice">{error}</div>}

        {documents === null && !error && <div className="empty">Loading documents…</div>}

        {documents?.map((document) => (
          <NavItem
            key={document.name}
            icon="file"
            label={document.title || DEFAULT_TITLE}
            meta={formatBytes(document.bytes)}
            active={document.name === activeId}
            onClick={() => open(document.name)}
          />
        ))}

        {localOnly.length > 0 && (
          <>
            <div className="nav-group">On this device</div>
            {localOnly.map((id) => (
              <NavItem
                key={id}
                icon="file"
                label={id}
                active={id === activeId}
                onClick={() => open(id)}
              />
            ))}
          </>
        )}

        {documents?.length === 0 && localOnly.length === 0 && !error && (
          <div className="empty">
            No documents yet.
            <br />
            Create one to get started.
          </div>
        )}

        <div className="nav-group">Workspace</div>
        <NavItem icon="history" label="Version History" onClick={onOpenVersions} />
        <NavItem
          icon="activity"
          label="Telemetry"
          onClick={() => {
            router.push(activeId ? `/telemetry?doc=${activeId}` : '/telemetry')
            onNavigate?.()
          }}
        />
        <NavItem icon="settings" label="Settings" onClick={onOpenSettings} />
      </div>

      <div className="sidebar__foot">
        <div className="storage">
          <span>Workspace Storage</span>
          <span>{percent}%</span>
        </div>
        <div
          className="storage__track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Workspace storage used"
        >
          <div className="storage__fill" style={{ width: `${Math.max(2, percent)}%` }} />
        </div>
      </div>
    </aside>
  )
}

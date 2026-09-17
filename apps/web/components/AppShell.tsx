'use client'

import type { Editor as TiptapEditor } from '@tiptap/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { unresolvedCount, useComments } from '@/lib/comments'
import {
  fetchDocumentAccess,
  newDocumentId,
  readRecents,
  rememberDocument,
  useDocumentTitle,
  useServerDocuments,
  useServerStats,
  type DocumentAccess,
} from '@/lib/documents'
import { useCollabSession, useIdentity, useMetrics, usePresence } from '@/lib/hooks'
import type { Identity } from '@/lib/identity'
import { authEnabled } from '@/lib/supabase'
import { AuthGate } from './AuthGate'
import { Icon } from '@/lib/icons'
import { CommandPalette, type Command } from './CommandPalette'
import { ExportDialog } from './ExportDialog'
import { ImportDialog } from './ImportDialog'
import { RightPanel } from './RightPanel'
import { SettingsDialog } from './SettingsDialog'
import { ShareDialog } from './ShareDialog'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { VersionHistoryDialog } from './VersionHistoryDialog'

type DialogName = 'share' | 'settings' | 'versions' | 'export' | 'import' | null

export interface ShellRenderArgs {
  session: ReturnType<typeof useCollabSession>
  identity: Identity
  peers: ReturnType<typeof usePresence>
  snapshot: ReturnType<typeof useMetrics>
  setEditor: (editor: TiptapEditor | null) => void
  editor: TiptapEditor | null
  toast: (message: string) => void
  /**
   * True when the server resolved this user to a viewer on a view-only link.
   * The editor uses it to go read-only; it is a reflection of the server's
   * decision, never the thing that enforces it.
   */
  readOnly: boolean
}

interface AppShellProps {
  documentId: string
  /** Extra commands contributed by the current view. */
  extraCommands?: Command[]
  children: (args: ShellRenderArgs) => React.ReactNode
}

/**
 * The three-pane application frame: top bar, explorer, content, collaboration
 * panel. It owns the session so the editor view and the telemetry view can both
 * render inside the same chrome without opening two sockets.
 */
export function AppShell(props: AppShellProps) {
  return (
    <AuthGate>
      <Workspace {...props} />
    </AuthGate>
  )
}

function Workspace({ documentId, extraCommands = [], children }: AppShellProps) {
  const router = useRouter()

  const identityFromStore = useIdentity()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const active = identity ?? identityFromStore

  const session = useCollabSession(documentId)
  const peers = usePresence(session)
  const snapshot = useMetrics()
  const threads = useComments(session)
  const [title, setTitle] = useDocumentTitle(session)

  const [editor, setEditor] = useState<TiptapEditor | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [dialog, setDialog] = useState<DialogName>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const [refreshToken, setRefreshToken] = useState(0)
  const [access, setAccess] = useState<DocumentAccess | null>(null)

  const { documents, error } = useServerDocuments(refreshToken)
  const stats = useServerStats()

  const toast = useCallback((message: string) => {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage(null), 2200)
  }, [])

  useEffect(() => {
    rememberDocument(documentId)
    setRecents(readRecents())
  }, [documentId])

  /**
   * Resolve this user's role up front rather than waiting for the Share dialog
   * to be opened. The editor needs to know whether to go read-only before the
   * first keystroke, and a viewer who can type for two seconds and then watch
   * their words vanish is worse than one who never could.
   *
   * A failure here is deliberately not surfaced: the WebSocket handshake
   * reports access problems with a better message, and this call losing a race
   * with a cold-starting server should not paint an error over a document that
   * is about to open perfectly well.
   */
  useEffect(() => {
    if (!authEnabled) return
    let cancelled = false
    setAccess(null)
    fetchDocumentAccess(documentId)
      .then((value) => {
        if (!cancelled) setAccess(value)
      })
      .catch(() => {
        /* the socket reports this better */
      })
    return () => {
      cancelled = true
    }
  }, [documentId])

  // Refresh the explorer whenever the server reports another persist write, so
  // a newly created document appears without a manual reload.
  useEffect(() => {
    if (stats) setRefreshToken(stats.writes)
  }, [stats])

  const createDocument = useCallback(() => {
    router.push(`/doc/${newDocumentId()}`)
  }, [router])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: 'new',
        group: 'Document',
        icon: 'plus',
        label: 'New document',
        run: createDocument,
      },
      {
        id: 'share',
        group: 'Document',
        icon: 'share',
        label: 'Share this document',
        run: () => setDialog('share'),
      },
      {
        id: 'versions',
        group: 'Document',
        icon: 'history',
        label: 'Version history',
        run: () => setDialog('versions'),
      },
      {
        id: 'export',
        group: 'Document',
        icon: 'download',
        label: 'Export or print a copy',
        hint: 'Markdown, HTML, text, PDF',
        run: () => setDialog('export'),
      },
      {
        id: 'import',
        group: 'Document',
        icon: 'upload',
        label: 'Upload a document',
        hint: '.docx, .md, .html, .txt',
        run: () => setDialog('import'),
      },
      {
        id: 'rename',
        group: 'Document',
        icon: 'pencil',
        label: 'Rename document',
        run: () => {
          const input = document.querySelector<HTMLInputElement>('.title-input')
          input?.focus()
          input?.select()
        },
      },
      {
        id: 'telemetry',
        group: 'Go to',
        icon: 'activity',
        label: 'Telemetry',
        run: () => router.push(`/telemetry?doc=${documentId}`),
      },
      {
        id: 'editor',
        group: 'Go to',
        icon: 'file',
        label: 'Editor',
        run: () => router.push(`/doc/${documentId}`),
      },
      {
        id: 'settings',
        group: 'Go to',
        icon: 'settings',
        label: 'Settings',
        run: () => setDialog('settings'),
      },
      {
        id: 'toggle-panel',
        group: 'View',
        icon: 'panel',
        label: 'Toggle collaboration panel',
        run: () => setPanelOpen((open) => !open),
      },
      {
        id: 'toggle-sidebar',
        group: 'View',
        icon: 'menu',
        label: 'Toggle explorer',
        run: () => setSidebarOpen((open) => !open),
      },
      {
        id: 'partition',
        group: 'Simulate',
        icon: 'offline',
        label:
          snapshot.status === 'disconnected' ? 'Heal the partition' : 'Simulate a network partition',
        run: () =>
          snapshot.status === 'disconnected' ? session?.reconnect() : session?.disconnect(),
      },
      {
        id: 'lag',
        group: 'Simulate',
        icon: 'gauge',
        label: snapshot.lagMs > 0 ? 'Clear injected lag' : 'Inject 400ms of lag',
        run: () => session?.setLag(snapshot.lagMs > 0 ? 0 : 400),
      },
      {
        id: 'resync',
        group: 'Simulate',
        icon: 'wifi',
        label: 'Force a resync',
        run: () => session?.forceSync(),
      },
    ]

    const documentCommands: Command[] = (documents ?? [])
      .filter((entry) => entry.name !== documentId)
      .slice(0, 8)
      .map((entry) => ({
        id: `open-${entry.name}`,
        group: 'Open',
        icon: 'file' as const,
        label: entry.title || entry.name,
        hint: entry.name,
        run: () => router.push(`/doc/${entry.name}`),
      }))

    return [...extraCommands, ...base, ...documentCommands]
  }, [
    createDocument,
    documentId,
    documents,
    extraCommands,
    router,
    session,
    snapshot.lagMs,
    snapshot.status,
  ])

  // The server has already decided this; the flag only tells the UI to stop
  // pretending an edit would stick.
  const readOnly = access?.role === 'viewer'

  return (
    <div className="app">
      <TopBar
        identity={active}
        title={title}
        onTitleChange={setTitle}
        peers={peers}
        snapshot={snapshot}
        unresolvedComments={unresolvedCount(threads)}
        sidebarOpen={sidebarOpen}
        panelOpen={panelOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onOpenCommands={() => setPaletteOpen(true)}
        onOpenShare={() => setDialog('share')}
        onOpenSettings={() => setDialog('settings')}
        onOpenExport={() => setDialog('export')}
        readOnly={readOnly}
      />

      <div
        className="app__body"
        data-sidebar={sidebarOpen ? 'open' : 'closed'}
        data-panel={panelOpen ? 'open' : 'closed'}
      >
        <Sidebar
          documents={documents}
          error={error}
          activeId={documentId}
          recents={recents}
          onCreate={createDocument}
          onOpenVersions={() => setDialog('versions')}
          onOpenSettings={() => setDialog('settings')}
          onOpenImport={() => setDialog('import')}
          onOpenExport={() => setDialog('export')}
        />

        <main className="app__main">
          {snapshot.accessError ? (
            <div className="denied">
              <span className="logo-mark" style={{ width: 38, height: 38, borderRadius: 11 }}>
                <Icon name="offline" size={18} />
              </span>
              <h2 className="denied__title">You do not have access to this document</h2>
              <p className="denied__body">{snapshot.accessError}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn--primary" onClick={createDocument}>
                  <Icon name="plus" size={14} />
                  Start your own document
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDialog('settings')}
                >
                  Switch account
                </button>
              </div>
            </div>
          ) : (
            children({
              session,
              identity: active,
              peers,
              snapshot,
              setEditor,
              editor,
              toast,
              readOnly,
            })
          )}
        </main>

        <RightPanel
          session={session}
          identity={active}
          threads={threads}
          snapshot={snapshot}
          onClose={() => setPanelOpen(false)}
        />
      </div>

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      )}

      {dialog === 'share' && (
        <ShareDialog
          documentId={documentId}
          title={title}
          access={access}
          onAccessChange={setAccess}
          onExport={() => setDialog('export')}
          onClose={() => setDialog(null)}
          onToast={toast}
        />
      )}

      {dialog === 'export' && (
        <ExportDialog
          editor={editor}
          documentId={documentId}
          title={title}
          onClose={() => setDialog(null)}
          onToast={toast}
        />
      )}

      {dialog === 'import' && (
        <ImportDialog
          editor={editor}
          title={title}
          readOnly={readOnly}
          onTitleChange={setTitle}
          onClose={() => setDialog(null)}
          onToast={toast}
        />
      )}

      {dialog === 'settings' && (
        <SettingsDialog
          identity={active}
          onIdentityChange={setIdentity}
          stats={stats}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'versions' && (
        <VersionHistoryDialog
          documentId={documentId}
          editor={editor}
          onClose={() => setDialog(null)}
          onToast={toast}
        />
      )}

      {toastMessage && (
        <div className="toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  )
}

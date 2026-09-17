'use client'

import type { Editor as TiptapEditor } from '@tiptap/react'
import { useParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { Editor } from '@/components/Editor'
import { EditorToolbar } from '@/components/EditorToolbar'
import { PromptDialog } from '@/components/PromptDialog'
import { StatusStrip } from '@/components/StatusStrip'
import type { CollabSession } from '@/lib/collab'
import { initialsFor } from '@/lib/colors'
import { isValidDocumentId } from '@/lib/documents'
import type { PresencePeer } from '@/lib/hooks'
import { Icon } from '@/lib/icons'
import type { Identity } from '@/lib/identity'
import { formatNumber, type MetricsSnapshot } from '@/lib/metrics'

type EditorDialog = 'link' | 'image' | null

export default function DocumentPage() {
  const params = useParams<{ id: string }>()
  const raw = typeof params?.id === 'string' ? params.id : ''
  const documentId = isValidDocumentId(raw) ? raw : ''
  const [dialog, setDialog] = useState<EditorDialog>(null)

  if (!documentId) {
    return (
      <main className="shell" style={{ padding: 40 }}>
        <div className="notice">
          Invalid document id. Document names may contain letters, numbers, hyphens and
          underscores only.
        </div>
      </main>
    )
  }

  return (
    <AppShell documentId={documentId} allowGuest>
      {({ session, identity, peers, snapshot, setEditor, editor, toast, readOnly }) => (
        <DocumentView
          documentId={documentId}
          session={session}
          identity={identity}
          peerCount={peers.filter((peer) => !peer.isSelf).length}
          peers={peers}
          snapshot={snapshot}
          setEditor={setEditor}
          editor={editor}
          dialog={dialog}
          setDialog={setDialog}
          toast={toast}
          readOnly={readOnly}
        />
      )}
    </AppShell>
  )
}

interface DocumentViewProps {
  documentId: string
  session: CollabSession | null
  identity: Identity
  peers: PresencePeer[]
  peerCount: number
  snapshot: MetricsSnapshot
  editor: TiptapEditor | null
  setEditor: (editor: TiptapEditor | null) => void
  dialog: EditorDialog
  setDialog: (dialog: EditorDialog) => void
  toast: (message: string) => void
  readOnly: boolean
}

function DocumentView({
  documentId,
  session,
  identity,
  peers,
  peerCount,
  snapshot,
  setEditor,
  editor,
  dialog,
  setDialog,
  toast,
  readOnly,
}: DocumentViewProps) {
  const onReady = useCallback(
    (instance: TiptapEditor | null) => setEditor(instance),
    [setEditor],
  )

  const characters = snapshot.footprint[snapshot.footprint.length - 1]?.chars ?? 0

  return (
    <div className="editor-col">
      {readOnly ? (
        <div className="readonly-bar">
          <Icon name="eye" size={15} />
          <strong>View only.</strong>
          <span>
            You opened this through a view-only link. You can read, follow along live, and export
            a copy — but not edit.
          </span>
        </div>
      ) : (
        <div className="toolbar-wrap">
          <EditorToolbar
            editor={editor}
            peers={peerCount}
            onInsertLink={() => setDialog('link')}
            onInsertImage={() => setDialog('image')}
          />
        </div>
      )}

      <StatusStrip session={session} snapshot={snapshot} />

      <div className="doc-scroll">
        <article className="page">
          <div className="page__head">
            <span className="doc-tag">
              <Icon name="hash" size={11} />
              {documentId}
            </span>

            <span className="collab-inline">
              Active collaborators
              <span className="presence__stack">
                {peers.slice(0, 4).map((peer) => (
                  <span
                    key={peer.clientId}
                    className="avatar avatar--sm"
                    style={{ background: peer.color, borderWidth: 2 }}
                    title={peer.isSelf ? `${peer.name} (you)` : peer.name}
                  >
                    {initialsFor(peer.name)}
                  </span>
                ))}
              </span>
            </span>
          </div>

          <div className="doc-meta">
            <span className="doc-meta__row">
              <Icon name="clock" size={12} />
              {snapshot.synced ? 'Synced with the server' : 'Changes held locally'}
              <span className="doc-meta__chip">{formatNumber(characters)} characters</span>
            </span>
            <span className="doc-meta__row">
              <Icon name="branch" size={12} />
              Replica
              <span className="doc-meta__chip">
                {session ? session.doc.clientID.toString(16) : '—'}
              </span>
              ·
              <Icon name="users" size={12} />
              {peerCount === 0 ? 'no other peers' : `${peerCount} peer${peerCount === 1 ? '' : 's'}`}
            </span>
          </div>

          {session && identity.id ? (
            <Editor
              session={session}
              identity={identity}
              onReady={onReady}
              readOnly={readOnly}
            />
          ) : (
            <div className="empty">Opening document…</div>
          )}
        </article>
      </div>

      {dialog === 'link' && (
        <PromptDialog
          title="Link"
          label="URL"
          placeholder="https://example.com"
          hint="Only http, https and mailto links are accepted."
          initialValue={editor?.getAttributes('link').href ?? ''}
          submitLabel="Apply link"
          allowRemove={Boolean(editor?.isActive('link'))}
          onRemove={() => editor?.chain().focus().unsetLink().run()}
          onSubmit={(value) => {
            const ok = editor
              ?.chain()
              .focus()
              .extendMarkRange('link')
              .setLink({ href: value })
              .run()
            if (!ok) toast('That link was rejected — use http, https or mailto')
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'image' && (
        <PromptDialog
          title="Insert image"
          label="Image URL"
          placeholder="https://example.com/diagram.png"
          hint="The URL is stored in the document; the image itself is not uploaded."
          submitLabel="Insert"
          onSubmit={(value) => editor?.chain().focus().setImage({ src: value }).run()}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

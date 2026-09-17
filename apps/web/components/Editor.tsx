'use client'

import CharacterCount from '@tiptap/extension-character-count'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { Color } from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import type { CollabSession } from '@/lib/collab'
import { FontSize } from '@/lib/font-size'
import type { Identity } from '@/lib/identity'

interface EditorProps {
  session: CollabSession
  identity: Identity
  onReady?: (editor: TiptapEditor | null) => void
}

/**
 * Selection changes fire on every arrow key. Stamping awareness that often
 * floods the socket and inflates the very latency the telemetry view is
 * measuring, so the presence ping is throttled. 50ms is below the threshold
 * where a remote cursor stops feeling live.
 */
const PING_INTERVAL_MS = 50

export function Editor({ session, identity, onReady }: EditorProps) {
  const lastPingRef = useRef(0)

  const editor = useEditor(
    {
      // Next renders this on the server first; TipTap must not build the view
      // until the browser takes over or the markup will not match.
      immediatelyRender: false,

      extensions: [
        StarterKit.configure({
          // The Collaboration extension brings its own Y.UndoManager-backed
          // history. Leaving the default one enabled means two competing undo
          // stacks on the same document.
          history: false,
        }),
        Placeholder.configure({
          placeholder: 'Start typing. Anyone with this link edits the same document.',
        }),
        // Maintains the count incrementally, so reading it is O(1). Walking the
        // document on every keystroke would itself distort the measurements.
        CharacterCount,
        Underline,
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          // Anything that is not http(s) or mailto is dropped: a document is
          // shared by link, so a pasted javascript: URL would be a stored XSS
          // vector aimed at every collaborator.
          protocols: ['http', 'https', 'mailto'],
        }),
        Image.configure({ inline: false, allowBase64: false }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Collaboration.configure({
          document: session.doc,
          // TipTap stores the document body in this Y.XmlFragment. Changing the
          // name is a breaking change for existing stored documents.
          field: 'default',
        }),
        CollaborationCursor.configure({
          provider: session.provider,
          user: { name: identity.name, color: identity.color },
        }),
      ],

      onSelectionUpdate: () => {
        const now = Date.now()
        if (now - lastPingRef.current < PING_INTERVAL_MS) return
        lastPingRef.current = now
        session.ping()
      },

      onUpdate: ({ editor: instance }) => {
        session.reportCharCount(instance.storage.characterCount.characters())
      },

      editorProps: {
        attributes: { class: 'editor-surface', spellcheck: 'true' },
      },
    },
    [session, identity.name, identity.color],
  )

  useEffect(() => {
    onReady?.(editor)
    return () => onReady?.(null)
  }, [editor, onReady])

  // Seed the character count on load so the footprint chart has an x value
  // before the first keystroke.
  useEffect(() => {
    if (!editor) return
    session.reportCharCount(editor.storage.characterCount.characters())
  }, [editor, session])

  return <EditorContent editor={editor} />
}

'use client'

import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useState } from 'react'
import { Icon, type IconName } from '@/lib/icons'

interface EditorToolbarProps {
  editor: Editor | null
  peers: number
  onInsertLink: () => void
  onInsertImage: () => void
  onAddComment: () => void
}

interface ToolProps {
  icon: IconName
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function Tool({ icon, title, active, disabled, onClick }: ToolProps) {
  return (
    <button
      type="button"
      className="icon-btn"
      data-active={active ? 'true' : 'false'}
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}

const FONT_FAMILIES = [
  { label: 'Inter', value: '' },
  { label: 'Mono', value: 'var(--font-mono)' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
]

const FONT_SIZES = ['13px', '15px', '17px', '20px', '24px', '32px']

export function EditorToolbar({
  editor,
  peers,
  onInsertLink,
  onInsertImage,
  onAddComment,
}: EditorToolbarProps) {
  // TipTap mutates the editor in place, so React has no signal to re-render on.
  // Subscribing to transactions is what keeps the active states truthful.
  const [, force] = useState(0)

  useEffect(() => {
    if (!editor) return
    const rerender = () => force((value) => value + 1)
    editor.on('transaction', rerender)
    editor.on('selectionUpdate', rerender)
    return () => {
      editor.off('transaction', rerender)
      editor.off('selectionUpdate', rerender)
    }
  }, [editor])

  const currentBlock = useCallback((): string => {
    if (!editor) return 'paragraph'
    for (const level of [1, 2, 3] as const) {
      if (editor.isActive('heading', { level })) return `h${level}`
    }
    if (editor.isActive('codeBlock')) return 'code'
    if (editor.isActive('blockquote')) return 'quote'
    return 'paragraph'
  }, [editor])

  const setBlock = (value: string) => {
    if (!editor) return
    const chain = editor.chain().focus()
    if (value === 'paragraph') chain.setParagraph().run()
    else if (value === 'code') chain.toggleCodeBlock().run()
    else if (value === 'quote') chain.toggleBlockquote().run()
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run()
  }

  // The toolbar already re-renders on every transaction and selection change,
  // so this is simply read fresh rather than tracked in state.
  const hasSelection = Boolean(editor && !editor.state.selection.empty)

  const currentSize = editor?.getAttributes('textStyle').fontSize ?? '15px'
  const currentFamily = editor?.getAttributes('textStyle').fontFamily ?? ''
  const disabled = !editor

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar__row">
        <Tool
          icon="undo"
          title="Undo your own changes"
          disabled={disabled || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
        />
        <Tool
          icon="redo"
          title="Redo"
          disabled={disabled || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
        />

        <span className="toolbar__sep" aria-hidden />

        <select
          className="select"
          aria-label="Block type"
          value={currentBlock()}
          disabled={disabled}
          onChange={(event) => setBlock(event.target.value)}
        >
          <option value="paragraph">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="quote">Quote</option>
          <option value="code">Code block</option>
        </select>

        <select
          className="select"
          aria-label="Font family"
          value={currentFamily}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value
            if (!value) editor?.chain().focus().unsetFontFamily().run()
            else editor?.chain().focus().setFontFamily(value).run()
          }}
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font.label} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>

        <select
          className="select"
          aria-label="Font size"
          value={currentSize}
          disabled={disabled}
          onChange={(event) => editor?.chain().focus().setFontSize(event.target.value).run()}
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <span className="toolbar__sep" aria-hidden />

        <Tool
          icon="bold"
          title="Bold"
          active={editor?.isActive('bold')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <Tool
          icon="italic"
          title="Italic"
          active={editor?.isActive('italic')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <Tool
          icon="underline"
          title="Underline"
          active={editor?.isActive('underline')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        />
        <Tool
          icon="strike"
          title="Strikethrough"
          active={editor?.isActive('strike')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        />
        <Tool
          icon="code"
          title="Inline code"
          active={editor?.isActive('code')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        />

        <span className="toolbar__sep" aria-hidden />

        <input
          type="color"
          className="color-field"
          title="Text colour"
          aria-label="Text colour"
          disabled={disabled}
          value={editor?.getAttributes('textStyle').color ?? '#131629'}
          onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
        />
        <Tool
          icon="highlight"
          title="Highlight"
          active={editor?.isActive('highlight')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleHighlight().run()}
        />
      </div>

      <div className="toolbar__row">
        <Tool
          icon="alignLeft"
          title="Align left"
          active={editor?.isActive({ textAlign: 'left' })}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign('left').run()}
        />
        <Tool
          icon="alignCenter"
          title="Align centre"
          active={editor?.isActive({ textAlign: 'center' })}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign('center').run()}
        />
        <Tool
          icon="alignRight"
          title="Align right"
          active={editor?.isActive({ textAlign: 'right' })}
          disabled={disabled}
          onClick={() => editor?.chain().focus().setTextAlign('right').run()}
        />

        <span className="toolbar__sep" aria-hidden />

        <Tool
          icon="listUl"
          title="Bullet list"
          active={editor?.isActive('bulletList')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <Tool
          icon="listOl"
          title="Numbered list"
          active={editor?.isActive('orderedList')}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        />

        <span className="toolbar__sep" aria-hidden />

        <Tool
          icon="link"
          title="Add or edit link"
          active={editor?.isActive('link')}
          disabled={disabled}
          onClick={onInsertLink}
        />
        <Tool
          icon="table"
          title="Insert table"
          disabled={disabled}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        />
        <Tool icon="image" title="Insert image" disabled={disabled} onClick={onInsertImage} />

        <span className="toolbar__sep" aria-hidden />

        <Tool
          icon="comment"
          title={
            hasSelection
              ? 'Comment on the selected text'
              : 'Select some text first, then comment on it'
          }
          active={editor?.isActive('comment')}
          disabled={disabled || !hasSelection}
          onClick={onAddComment}
        />

        <span className="toolbar__sep" aria-hidden />

        <span className="live-pill" title="People editing this document right now">
          <span className="dot dot--good" aria-hidden />
          {peers + 1} live
        </span>
      </div>
    </div>
  )
}

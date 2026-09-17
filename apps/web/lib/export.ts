'use client'

import type { Editor } from '@tiptap/react'

/**
 * Document export.
 *
 * Everything here runs against the ProseMirror document the editor is already
 * holding, so an export is a pure read of local state: it works offline, works
 * mid-partition, and needs no round trip to the sync server. That matters for
 * this project specifically — "I can still get my words out" is the last line
 * of the recovery story, and it should not depend on the thing that just went
 * down.
 */

export type ExportFormat = 'docx' | 'pdf' | 'png' | 'jpg' | 'markdown' | 'html' | 'text' | 'json'

/** Formats produced as binary, which cannot be previewed as text. */
export const BINARY_FORMATS: ExportFormat[] = ['docx', 'pdf', 'png', 'jpg']

export const EXPORT_FORMATS: {
  id: ExportFormat
  label: string
  extension: string
  mime: string
  hint: string
}[] = [
  {
    id: 'docx',
    label: 'Word',
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    hint: 'A real .docx — headings, lists, tables and working links.',
  },
  {
    id: 'pdf',
    label: 'PDF',
    extension: 'pdf',
    mime: 'application/pdf',
    hint: 'Opens your print dialog. Choose "Save as PDF" as the destination.',
  },
  {
    id: 'png',
    label: 'PNG image',
    extension: 'png',
    mime: 'image/png',
    hint: 'The page rendered as a picture, at twice the screen resolution.',
  },
  {
    id: 'jpg',
    label: 'JPG image',
    extension: 'jpg',
    mime: 'image/jpeg',
    hint: 'Same as PNG, smaller file, no transparency.',
  },
  {
    id: 'markdown',
    label: 'Markdown',
    extension: 'md',
    mime: 'text/markdown;charset=utf-8',
    hint: 'Headings, lists, tables, links and formatting, as portable text.',
  },
  {
    id: 'html',
    label: 'HTML',
    extension: 'html',
    mime: 'text/html;charset=utf-8',
    hint: 'A standalone styled page. Open it in a browser and print to PDF.',
  },
  {
    id: 'text',
    label: 'Plain text',
    extension: 'txt',
    mime: 'text/plain;charset=utf-8',
    hint: 'Just the words, with all formatting dropped.',
  },
  {
    id: 'json',
    label: 'ProseMirror JSON',
    extension: 'json',
    mime: 'application/json;charset=utf-8',
    hint: 'The exact document tree. Re-importable without any loss.',
  },
]

interface ProseMirrorMark {
  type: string
  attrs?: Record<string, unknown>
}

interface ProseMirrorNode {
  type: string
  attrs?: Record<string, unknown>
  content?: ProseMirrorNode[]
  marks?: ProseMirrorMark[]
  text?: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/* ----------------------------  markdown  -------------------------------- */

/**
 * Escape the characters that would otherwise be read back as markup.
 *
 * Only applied to text that is *not* inside a code span or fence, where the
 * whole point is that the content survives verbatim.
 */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!>|])/g, '\\$1')
}

function renderInline(nodes: ProseMirrorNode[] | undefined): string {
  if (!nodes) return ''

  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n'
      if (node.type === 'image') {
        const src = text(node.attrs?.src)
        return src ? `![${text(node.attrs?.alt)}](${src})` : ''
      }
      if (node.type !== 'text') return renderInline(node.content)

      const marks = node.marks ?? []
      const isCode = marks.some((mark) => mark.type === 'code')

      // Inside a code span nothing is markup, so escaping would corrupt it.
      let out = isCode ? node.text ?? '' : escapeMarkdown(node.text ?? '')
      if (isCode) out = '`' + out + '`'

      for (const mark of marks) {
        if (mark.type === 'bold') out = `**${out}**`
        else if (mark.type === 'italic') out = `*${out}*`
        else if (mark.type === 'strike') out = `~~${out}~~`
        // Markdown has no underline or highlight; HTML tags are the portable
        // spelling and every renderer that matters passes them through.
        else if (mark.type === 'underline') out = `<u>${out}</u>`
        else if (mark.type === 'highlight') out = `<mark>${out}</mark>`
        else if (mark.type === 'link') {
          const href = text(mark.attrs?.href)
          if (href) out = `[${out}](${href})`
        }
      }
      return out
    })
    .join('')
}

function renderTable(node: ProseMirrorNode): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''

  const cellText = (cell: ProseMirrorNode): string =>
    (cell.content ?? [])
      .map((block) => renderInline(block.content))
      .join(' ')
      // A literal pipe would end the cell, and a newline would end the row.
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .trim()

  const matrix = rows.map((row) => (row.content ?? []).map(cellText))
  const width = Math.max(...matrix.map((row) => row.length))
  const pad = (row: string[]): string[] => [...row, ...Array(width - row.length).fill('')]

  const [head, ...body] = matrix
  const lines = [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`),
  ]
  return lines.join('\n')
}

function renderBlocks(nodes: ProseMirrorNode[] | undefined, indent = ''): string[] {
  if (!nodes) return []
  const out: string[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const level = Number(node.attrs?.level) || 1
        out.push(`${'#'.repeat(Math.min(6, level))} ${renderInline(node.content)}`)
        break
      }
      case 'paragraph': {
        const line = renderInline(node.content)
        // An empty paragraph is spacing, not content; markdown expresses that
        // with the blank line between blocks that the join below adds anyway.
        if (line.trim()) out.push(line)
        break
      }
      case 'codeBlock': {
        const language = text(node.attrs?.language)
        const body = (node.content ?? []).map((child) => child.text ?? '').join('')
        out.push('```' + language + '\n' + body + '\n```')
        break
      }
      case 'blockquote': {
        const inner = renderBlocks(node.content)
          .join('\n\n')
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n')
        out.push(inner)
        break
      }
      case 'bulletList':
      case 'orderedList': {
        const ordered = node.type === 'orderedList'
        const start = Number(node.attrs?.start) || 1
        const items = (node.content ?? []).map((item, index) => {
          const marker = ordered ? `${start + index}. ` : '- '
          const childIndent = indent + ' '.repeat(marker.length)
          const blocks = renderBlocks(item.content, childIndent)
          const [first = '', ...rest] = blocks.join('\n\n').split('\n')
          // Continuation lines line up under the marker, which is what keeps a
          // nested list attached to its parent item rather than restarting.
          return (
            indent +
            marker +
            first +
            (rest.length ? '\n' + rest.map((line) => (line ? childIndent + line : line)).join('\n') : '')
          )
        })
        out.push(items.join('\n'))
        break
      }
      case 'horizontalRule':
        out.push('---')
        break
      case 'image': {
        const src = text(node.attrs?.src)
        if (src) out.push(`![${text(node.attrs?.alt)}](${src})`)
        break
      }
      case 'table':
        out.push(renderTable(node))
        break
      default:
        out.push(...renderBlocks(node.content, indent))
    }
  }

  return out.filter((block) => block.length > 0)
}

export function toMarkdown(editor: Editor, title: string): string {
  const doc = editor.getJSON() as ProseMirrorNode
  const body = renderBlocks(doc.content).join('\n\n')
  const heading = title.trim()
  // The title lives outside the body (it is in the Y.Doc meta map, not the
  // prose), so it has to be prepended or the export silently loses it.
  return heading ? `# ${escapeMarkdown(heading)}\n\n${body}\n` : `${body}\n`
}

/* ------------------------------  html  ---------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A standalone page, not a fragment: the styles are inlined so the file opens
 * correctly from disk with no network and no app, which is the whole point of
 * having an export. Printing it is how you get a PDF without shipping a PDF
 * library.
 */
export function toStandaloneHtml(editor: Editor, title: string): string {
  const heading = title.trim() || 'Untitled document'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 48px 24px; background: #f6f7fb; color: #131629;
    font: 16px/1.7 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main {
    max-width: 760px; margin: 0 auto; background: #fff; padding: 56px 64px;
    border-radius: 14px; box-shadow: 0 1px 3px rgba(19,22,41,.07), 0 8px 24px rgba(19,22,41,.06);
  }
  h1, h2, h3 { line-height: 1.3; margin: 1.6em 0 .5em; }
  h1 { font-size: 2em; margin-top: 0; }
  p, ul, ol, blockquote, table { margin: 0 0 1em; }
  blockquote { border-left: 3px solid #d8dae8; margin-left: 0; padding-left: 16px; color: #3f4658; }
  code { background: #f1f2f7; border-radius: 4px; padding: .15em .4em; font-size: .9em;
         font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #f1f2f7; border-radius: 9px; padding: 16px; overflow: auto; }
  pre code { background: none; padding: 0; }
  a { color: #4f46e5; }
  mark { background: #fde68a; }
  img { max-width: 100%; height: auto; border-radius: 9px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e8e9f2; padding: 8px 12px; text-align: left; }
  th { background: #fafbff; font-weight: 600; }
  hr { border: none; border-top: 1px solid #e8e9f2; margin: 2em 0; }
  @media print {
    body { background: #fff; padding: 0; }
    main { box-shadow: none; border-radius: 0; padding: 0; max-width: none; }
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0e0f16; color: #f2f3f7; }
    main { background: #15161d; }
    code, pre { background: #1d1f2b; }
    blockquote { border-left-color: #343748; color: #c3c6d4; }
    a { color: #7c74f0; }
    th, td { border-color: #262837; }
    th { background: #121319; }
  }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
${editor.getHTML()}
</main>
</body>
</html>
`
}

/* ---------------------------  entry points  ----------------------------- */

export function serialize(editor: Editor, title: string, format: ExportFormat): string {
  if (format === 'markdown') return toMarkdown(editor, title)
  if (format === 'html') return toStandaloneHtml(editor, title)
  if (format === 'json') {
    return JSON.stringify({ title, doc: editor.getJSON() }, null, 2)
  }
  const heading = title.trim()
  return (heading ? `${heading}\n\n` : '') + editor.getText({ blockSeparator: '\n\n' })
}

/** Turn a document title into something a filesystem will accept. */
export function fileNameFor(title: string, documentId: string, extension: string): string {
  const base =
    title
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || documentId
  return `${base}.${extension}`
}

/**
 * Rasterise the document to a PNG or JPEG.
 *
 * Done by wrapping the exported HTML in an SVG <foreignObject> and drawing
 * that through a canvas, which keeps the whole thing dependency-free — a
 * screenshot library would be several hundred kilobytes for one button.
 *
 * The trade-off is real and worth stating: an SVG loaded as a data URL cannot
 * fetch external resources, so remote images and web fonts do not appear. Text,
 * layout, colour, tables and lists all render correctly, and the editor stores
 * images by URL rather than by value, so there is nothing local to inline. For
 * a faithful copy including pictures, PDF via the print dialog is the honest
 * answer, and the dialog says so.
 */
export async function toImageBlob(
  editor: Editor,
  title: string,
  format: 'png' | 'jpg',
): Promise<Blob> {
  const width = 820
  // 2x so the result is legible on a high-density display rather than soft.
  const scale = 2

  const html = toStandaloneHtml(editor, title)
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const styles = Array.from(parsed.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n')
  const body = parsed.body?.innerHTML ?? ''

  // Measure by laying the content out off-screen first: the SVG needs an
  // explicit height, and guessing it either clips the document or leaves a
  // huge empty margin below it.
  const probe = document.createElement('div')
  probe.setAttribute('style', `position:fixed;left:-10000px;top:0;width:${width}px;`)
  probe.innerHTML = `<style>${styles}</style>${body}`
  document.body.appendChild(probe)
  const height = Math.max(200, Math.ceil(probe.getBoundingClientRect().height) + 48)
  probe.remove()

  // Serialised through XMLSerializer so the markup is valid XHTML; foreignObject
  // silently renders nothing for HTML that is merely well-formed-ish.
  const holder = document.createElement('div')
  holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  holder.innerHTML = `<style>${styles}</style>${body}`
  const xhtml = new XMLSerializer().serializeToString(holder)

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`

  const image = new Image()
  image.width = width
  image.height = height
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () =>
      reject(new Error('Could not render the document to an image in this browser.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')

  // JPEG has no alpha, so without this the transparent areas come out black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.scale(scale, scale)
  context.drawImage(image, 0, 0)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'png' ? undefined : 0.92,
    )
  })
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(fileName: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers; one turn of
  // the event loop is enough for the click to have been consumed.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportDocument(
  editor: Editor,
  title: string,
  documentId: string,
  format: ExportFormat,
): Promise<string> {
  const spec = EXPORT_FORMATS.find((entry) => entry.id === format) ?? EXPORT_FORMATS[0]
  const fileName = fileNameFor(title, documentId, spec.extension)

  if (format === 'pdf') {
    // There is no PDF writer here on purpose. The browser already has an
    // excellent one behind the print dialog, and it handles pagination, fonts
    // and remote images correctly -- all things a bundled library would do
    // worse, for hundreds of kilobytes.
    printDocument(editor, title)
    return 'the print dialog'
  }

  if (format === 'docx') {
    const { toDocxBlob } = await import('./export-docx')
    downloadBlob(fileName, await toDocxBlob(editor, title))
    return fileName
  }

  if (format === 'png' || format === 'jpg') {
    downloadBlob(fileName, await toImageBlob(editor, title, format))
    return fileName
  }

  downloadText(fileName, spec.mime, serialize(editor, title, format))
  return fileName
}

/**
 * Print the document on its own, rather than the surrounding application.
 *
 * Done by handing the standalone HTML to a hidden same-origin iframe: printing
 * the live page would carry the toolbar, sidebar and collaboration panel into
 * the PDF, and a popup window would be blocked often enough to be unreliable.
 */
export function printDocument(editor: Editor, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)

  const cleanup = () => setTimeout(() => frame.remove(), 1000)

  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      cleanup()
    }
  }

  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(toStandaloneHtml(editor, title))
  doc.close()
}

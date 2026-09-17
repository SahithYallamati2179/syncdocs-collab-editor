'use client'

import type { Editor } from '@tiptap/react'

/**
 * Document import.
 *
 * Everything an uploaded file becomes is funnelled through HTML, because HTML
 * is what TipTap already knows how to parse into ProseMirror nodes using the
 * exact schema the editor is configured with. Anything the schema does not
 * recognise is dropped on the way in rather than producing an invalid document.
 *
 * The result is inserted as an ordinary editing transaction, so it flows
 * through the CRDT like any keystroke: it merges with concurrent edits, it is
 * undoable, it replicates to everyone connected, and it is captured by the same
 * persistence path. Importing a file is not a separate code path from typing.
 */

export interface ImportedDocument {
  html: string
  /**
   * A ProseMirror document, present only when the source was this app's own
   * JSON export. Preferred over `html` when set: re-importing our own format
   * should be exact, not a round trip through a lossier one.
   */
  json?: object
  /** Taken from the file itself where the format carries one, else the filename. */
  title: string
  /** Non-fatal notes worth showing the user, e.g. dropped .docx features. */
  warnings: string[]
}

export const ACCEPTED_IMPORT_TYPES =
  '.md,.markdown,.txt,.text,.html,.htm,.json,.docx,' +
  'text/markdown,text/plain,text/html,application/json,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const SUPPORTED_IMPORT_LABEL = 'Word (.docx), Markdown, HTML, plain text, or exported JSON'

/** Refused before reading: a browser tab is a bad place to parse a 20 MB file. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const base = dot === -1 ? fileName : fileName.slice(0, dot)
  return base.replace(/[_-]+/g, ' ').trim().slice(0, 120)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ---------------------------  markdown  --------------------------------- */

/**
 * Stand-in for an extracted code span while the rest of the line is processed.
 *
 * It has to be a character markdown itself can never produce, or a document
 * that happened to contain the sentinel would have its own text swapped out
 * for a code span. U+0001 is not valid in any source format we accept.
 */
const CODE_SENTINEL = '\u0001'
const CODE_PLACEHOLDER = /\u0001(\d+)\u0001/g

/**
 * The link/image target, allowing one level of balanced parentheses inside it.
 *
 * `[x](a(b))` has to capture `a(b)`, not `a(b`, or the leftover `)` is emitted
 * as stray text next to the link. Real URLs do this — Wikipedia disambiguation
 * paths are the everyday case — and so does a `javascript:alert(1)` payload,
 * where mis-parsing leaves debris beside the stripped link. The trailing
 * `[^()]*` swallows an optional "title" after the URL.
 */
const TARGET = /\(((?:[^()\s]|\([^()]*\))+)[^()]*\)/.source
const LINK_PATTERN = new RegExp(/\[([^\]]+)\]/.source + TARGET, 'g')
const IMAGE_PATTERN = new RegExp(/!\[([^\]]*)\]/.source + TARGET, 'g')

/**
 * Inline markdown, applied to one line of already-escaped text.
 *
 * Code spans are extracted first and put back last, so that a `**` inside
 * backticks is not mistaken for bold — which is the failure that makes
 * hand-rolled markdown converters embarrassing.
 */
function inlineMarkdown(line: string): string {
  const codeSpans: string[] = []
  let out = line.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(code)
    return `${CODE_SENTINEL}${codeSpans.length - 1}${CODE_SENTINEL}`
  })

  out = escapeHtml(out)

  out = out
    // Images before links: the syntaxes differ by one leading character.
    .replace(IMAGE_PATTERN, (_m, alt: string, src: string) =>
      isSafeUrl(src) ? `<img src="${src}" alt="${alt}">` : alt,
    )
    .replace(LINK_PATTERN, (_m, label: string, href: string) =>
      isSafeUrl(href) ? `<a href="${href}">${label}</a>` : label,
    )
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')

  return out.replace(CODE_PLACEHOLDER, (_m, index: string) =>
    `<code>${escapeHtml(codeSpans[Number(index)])}</code>`,
  )
}

/**
 * Only http(s) and mailto survive.
 *
 * An imported file is untrusted input that every collaborator will then render,
 * so a `javascript:` href in a markdown link would be a stored XSS aimed at the
 * whole document — the same reason the Link extension restricts protocols.
 */
function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:|\/|#)/i.test(url.trim())
}

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let index = 0

  const listStack: ('ul' | 'ol')[] = []
  const closeListsTo = (depth: number) => {
    while (listStack.length > depth) out.push(`</${listStack.pop()}>`)
  }

  while (index < lines.length) {
    const line = lines[index]

    // Fenced code. Consumed whole so nothing inside is interpreted.
    const fence = line.match(/^\s*```+\s*(\S*)\s*$/)
    if (fence) {
      closeListsTo(0)
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```+\s*$/.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : ''
      out.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (!line.trim()) {
      closeListsTo(0)
      index += 1
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closeListsTo(0)
      out.push('<hr>')
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeListsTo(0)
      // The schema only has h1-h3; deeper headings become h3 rather than
      // vanishing, which is what TipTap would do with an unknown h4.
      const level = Math.min(3, heading[1].length)
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      closeListsTo(0)
      const quoted: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      out.push(`<blockquote>${markdownToHtml(quoted.join('\n'))}</blockquote>`)
      continue
    }

    // Tables: a header row followed by a |---|---| separator.
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1] ?? '')) {
      closeListsTo(0)
      const cells = (row: string): string[] =>
        row
          .trim()
          .replace(/^\||\|$/g, '')
          .split(/(?<!\\)\|/)
          .map((cell) => cell.replace(/\\\|/g, '|').trim())

      const header = cells(line)
      index += 2
      const body: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        body.push(cells(lines[index]))
        index += 1
      }
      const head = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')
      const rows = body
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><tbody><tr>${head}</tr>${rows}</tbody></table>`)
      continue
    }

    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      // Two spaces of indent per level is the common convention; anything
      // shallower folds into the level above rather than starting a new list.
      const depth = Math.floor(item[1].replace(/\t/g, '  ').length / 2) + 1
      const kind: 'ul' | 'ol' = /\d/.test(item[2]) ? 'ol' : 'ul'

      closeListsTo(depth)
      while (listStack.length < depth) {
        listStack.push(kind)
        out.push(`<${kind}>`)
      }
      out.push(`<li><p>${inlineMarkdown(item[3])}</p></li>`)
      index += 1
      continue
    }

    closeListsTo(0)
    // Consecutive non-blank lines are one paragraph, joined with soft breaks.
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !/^(\s*([-*+]|\d+[.)])\s|#{1,6}\s|\s*>|\s*```)/.test(lines[index])) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    out.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`)
  }

  closeListsTo(0)
  return out.join('\n')
}

/* -----------------------------  html  ----------------------------------- */

/**
 * Strip everything that could execute or phone home before the HTML reaches
 * the editor. TipTap's parser ignores unknown *nodes*, but it does not
 * sanitise, and an imported file is untrusted content that will be replicated
 * to every other collaborator.
 */
function sanitiseHtml(source: string): { title: string; body: string } {
  const parsed = new DOMParser().parseFromString(source, 'text/html')

  parsed.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach(
    (element) => element.remove(),
  )

  parsed.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if ((name === 'href' || name === 'src') && !isSafeUrl(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return {
    title: parsed.querySelector('title')?.textContent ?? '',
    body: parsed.body?.innerHTML ?? '',
  }
}

/* -----------------------------  reading  -------------------------------- */

async function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsText(file)
  })
}

async function readDocx(file: File): Promise<{ html: string; warnings: string[] }> {
  // Dynamically imported so the .docx parser is a separate chunk that is only
  // fetched when somebody actually uploads one — it is by far the largest
  // dependency in the app and no other page needs it.
  const mammoth = await import('mammoth/mammoth.browser.js')
  const buffer = await file.arrayBuffer()

  let result
  try {
    result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  } catch (cause) {
    // A .docx is a zip, so a truncated or mislabelled file surfaces here as a
    // raw jszip complaint about central directories. That is a true statement
    // about the bytes and a useless one to the person who just picked a file.
    throw new Error(
      `“${file.name}” could not be read as a Word document. It may be damaged, or ` +
        `renamed from another format. Details: ${(cause as Error).message}`,
    )
  }

  const warnings = result.messages
    .filter((message: { type: string }) => message.type === 'warning')
    .map((message: { message: string }) => message.message)

  return { html: result.value, warnings: Array.from(new Set(warnings)).slice(0, 5) }
}

/**
 * Turn an uploaded file into HTML the editor can parse.
 *
 * Format is decided by extension first and MIME type second, because browsers
 * report `.md` inconsistently (often as text/plain, sometimes as an empty
 * string) and the extension is what the user actually chose.
 */
export async function readImportedFile(file: File): Promise<ImportedDocument> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(
      `That file is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`,
    )
  }

  const extension = extensionOf(file.name)
  const fallbackTitle = titleFromFileName(file.name)

  if (extension === 'docx') {
    const { html, warnings } = await readDocx(file)
    return { html, title: fallbackTitle, warnings }
  }

  if (extension === 'doc') {
    throw new Error(
      'The old .doc format is not supported. Open it in Word and save as .docx, or export to PDF and copy the text.',
    )
  }

  const source = await readText(file)

  if (extension === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      throw new Error('That .json file is not valid JSON.')
    }
    const record = parsed as { title?: unknown; doc?: unknown; type?: unknown }
    // Accept both shapes this app exports: the wrapper with a title, and a
    // bare ProseMirror document.
    const doc = record.doc ?? (record.type === 'doc' ? record : null)
    if (!doc) {
      throw new Error('That JSON is not an exported document.')
    }
    return {
      html: '',
      json: doc as object,
      title: typeof record.title === 'string' ? record.title : fallbackTitle,
      warnings: [],
    }
  }

  if (extension === 'html' || extension === 'htm' || file.type === 'text/html') {
    const { title, body } = sanitiseHtml(source)
    return { html: body, title: title.trim() || fallbackTitle, warnings: [] }
  }

  if (extension === 'txt' || extension === 'text') {
    const html = source
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .filter((block) => block.trim())
      .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('\n')
    return { html, title: fallbackTitle, warnings: [] }
  }

  // Everything else is treated as Markdown, which degrades gracefully: a file
  // with no markup at all simply comes through as paragraphs.
  const html = markdownToHtml(source)
  // A leading `# Heading` is the document's title far more often than it is its
  // first line of prose, so it is lifted out rather than duplicated.
  const leading = source.match(/^\s*#\s+(.+)$/m)
  return {
    html,
    title: leading ? leading[1].trim().slice(0, 120) : fallbackTitle,
    warnings: [],
  }
}

/* ----------------------------  applying  -------------------------------- */

/**
 * One top-level block of a document: a paragraph, heading, list, table and so
 * on. `html` is what gets written back; `text` is what the diff compares, so
 * that a block whose wording is unchanged is treated as unchanged even if its
 * markup was re-emitted slightly differently.
 */
export interface DocumentBlock {
  html: string
  text: string
}

export function htmlToBlocks(html: string): DocumentBlock[] {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks: DocumentBlock[] = []

  for (const element of Array.from(parsed.body.children)) {
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    const outer = element.outerHTML
    // An empty paragraph is spacing, not content, and showing a run of them in
    // a review screen is noise the reviewer has to scroll past.
    if (!text && !/^<(hr|img|table)/i.test(outer)) continue
    blocks.push({ html: outer, text: text || outer })
  }

  return blocks
}

export function blocksToHtml(blocks: DocumentBlock[]): string {
  return blocks.map((block) => block.html).join('\n')
}

export type ImportMode = 'append' | 'replace'

/**
 * True when the document has no content worth preserving.
 *
 * ProseMirror always holds at least one node, so "empty" is not a zero size: a
 * fresh document is a single empty paragraph. Anything with actual text, or
 * more than one node, counts as having content.
 */
export function isDocumentEmpty(editor: Editor): boolean {
  const { doc } = editor.state
  if (doc.childCount > 1) return false
  return doc.textContent.trim().length === 0
}

/**
 * Decide where an uploaded file goes, rather than asking.
 *
 * An empty document is being filled, so the file becomes the document. A
 * document that already has content is being added to — silently discarding
 * someone's work because they dragged a file in is not a thing to do on a
 * guess. Both outcomes are one Ctrl+Z away, which is what makes deciding
 * automatically safe rather than presumptuous.
 */
export function chooseImportMode(editor: Editor): ImportMode {
  return isDocumentEmpty(editor) ? 'replace' : 'append'
}

/**
 * Put imported content into the live document.
 *
 * Both modes are ordinary editor commands rather than direct Y.Doc surgery, so
 * the change is a normal CRDT update: it merges with whatever a collaborator is
 * typing at the same moment, it lands in the shared undo history, and it
 * persists through the same debounced write as every other edit. `replace` in
 * particular is a delete-then-insert, not a document swap — a swap would
 * discard the shared history and hand every peer a document they cannot merge.
 */
export function applyImport(
  editor: Editor,
  content: string | object,
  mode: ImportMode,
): boolean {
  if (mode === 'replace') {
    return editor.chain().focus().selectAll().deleteSelection().insertContent(content).run()
  }

  const end = editor.state.doc.content.size
  return editor
    .chain()
    .focus()
    .insertContentAt(end, content, { updateSelection: true })
    .run()
}

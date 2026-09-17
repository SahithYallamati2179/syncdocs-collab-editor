import { describe, expect, it } from 'vitest'
import { markdownToHtml } from '../apps/web/lib/import.js'

/**
 * The Markdown converter is hand-rolled rather than a dependency, so it gets
 * the coverage a dependency would have brought with it. The cases below are
 * the ones that actually go wrong in converters like this: markup leaking out
 * of code spans, nesting collapsing, and hostile URLs surviving.
 *
 * Note this exercises markdownToHtml directly rather than readImportedFile,
 * which needs FileReader and DOMParser. This function is pure string work and
 * is where every interesting decision lives.
 */
describe('markdown import', () => {
  it('converts headings, capping at the three levels the schema has', () => {
    expect(markdownToHtml('# One')).toBe('<h1>One</h1>')
    expect(markdownToHtml('### Three')).toBe('<h3>Three</h3>')
    // The editor's schema has no h4; folding to h3 keeps the text, whereas
    // passing <h4> through would have TipTap drop the whole node.
    expect(markdownToHtml('##### Five')).toBe('<h3>Five</h3>')
  })

  it('applies inline emphasis, code and strikethrough', () => {
    expect(markdownToHtml('**bold** and *italic*')).toBe(
      '<p><strong>bold</strong> and <em>italic</em></p>',
    )
    expect(markdownToHtml('~~gone~~')).toBe('<p><s>gone</s></p>')
    expect(markdownToHtml('use `npm run dev`')).toBe('<p>use <code>npm run dev</code></p>')
  })

  /**
   * The classic failure of a naive converter: `**` inside backticks is not
   * emphasis, it is literal text that has to survive intact.
   */
  it('does not read markup inside a code span', () => {
    expect(markdownToHtml('`**not bold**`')).toBe('<p><code>**not bold**</code></p>')
    expect(markdownToHtml('`[a](b)`')).toBe('<p><code>[a](b)</code></p>')
  })

  it('escapes HTML in the source rather than passing it through', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
    expect(markdownToHtml('a < b && c > d')).toBe('<p>a &lt; b &amp;&amp; c &gt; d</p>')
  })

  /**
   * An imported file is untrusted input that is then replicated to every other
   * collaborator, so a javascript: link would be stored XSS aimed at all of
   * them. The label survives; the href does not.
   */
  it('strips dangerous URLs from links and images but keeps the text', () => {
    expect(markdownToHtml('[click](javascript:alert(1))')).toBe('<p>click</p>')
    expect(markdownToHtml('[ok](https://example.com)')).toBe(
      '<p><a href="https://example.com">ok</a></p>',
    )
    expect(markdownToHtml('![x](javascript:alert(1))')).toBe('<p>x</p>')
    expect(markdownToHtml('![x](https://example.com/a.png)')).toBe(
      '<p><img src="https://example.com/a.png" alt="x"></p>',
    )
  })

  it('builds bullet and numbered lists', () => {
    expect(markdownToHtml('- one\n- two')).toBe(
      '<ul>\n<li><p>one</p></li>\n<li><p>two</p></li>\n</ul>',
    )
    expect(markdownToHtml('1. one\n2. two')).toBe(
      '<ol>\n<li><p>one</p></li>\n<li><p>two</p></li>\n</ol>',
    )
  })

  it('nests an indented list inside its parent instead of flattening it', () => {
    const html = markdownToHtml('- outer\n  - inner\n- back')
    // Two opening <ul>, two closing, and the inner item between them.
    expect(html.match(/<ul>/g)).toHaveLength(2)
    expect(html.match(/<\/ul>/g)).toHaveLength(2)
    expect(html.indexOf('inner')).toBeGreaterThan(html.lastIndexOf('<ul>'))
    expect(html.indexOf('back')).toBeGreaterThan(html.indexOf('</ul>'))
  })

  it('keeps a fenced code block verbatim, markup and all', () => {
    const html = markdownToHtml('```ts\nconst a = "**x**"\n```')
    expect(html).toBe('<pre><code class="language-ts">const a = &quot;**x**&quot;</code></pre>')
  })

  it('reads a table with a header separator', () => {
    const html = markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<th>b</th>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<td>2</td>')
  })

  it('reads a blockquote, including the markup inside it', () => {
    expect(markdownToHtml('> **hi**')).toBe('<blockquote><p><strong>hi</strong></p></blockquote>')
  })

  it('reads a horizontal rule', () => {
    expect(markdownToHtml('---')).toBe('<hr>')
    expect(markdownToHtml('***')).toBe('<hr>')
  })

  it('joins consecutive lines into one paragraph and splits on a blank line', () => {
    expect(markdownToHtml('one\ntwo')).toBe('<p>one<br>two</p>')
    expect(markdownToHtml('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>')
  })

  it('produces nothing at all for empty or whitespace-only input', () => {
    expect(markdownToHtml('')).toBe('')
    expect(markdownToHtml('\n\n   \n')).toBe('')
  })

  it('treats plain prose with no markup as plain paragraphs', () => {
    // The fallback path: a .txt file mislabelled as markdown still imports
    // sensibly rather than losing its text.
    expect(markdownToHtml('Just a sentence.')).toBe('<p>Just a sentence.</p>')
  })
})

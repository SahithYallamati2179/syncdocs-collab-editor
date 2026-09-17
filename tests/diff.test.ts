import { describe, expect, it } from 'vitest'
import {
  applyDecisions,
  diffLines,
  diffWords,
  summarise,
  toWords,
  type DiffRow,
} from '../apps/web/lib/diff.js'

/**
 * The diff drives a review screen where each line is accepted or rejected
 * individually, so the property that actually matters is not "the diff looks
 * plausible" — it is that the decisions reconstruct exactly what the person
 * chose. Reject everything and you must get the original back byte for byte;
 * accept everything and you must get the incoming document. Anything less and
 * reviewing an import silently corrupts it.
 */

const identity = (value: string) => value
const run = (before: string[], after: string[]) => diffLines(before, after, identity)
const ids = (rows: DiffRow<string>[], op: string) =>
  new Set(rows.filter((row) => row.op === op).map((row) => row.id))
const allIds = (rows: DiffRow<string>[]) => new Set(rows.map((row) => row.id))

describe('line diff', () => {
  it('reports no changes for identical input', () => {
    const rows = run(['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(rows.map((row) => row.op)).toEqual(['equal', 'equal', 'equal'])
    expect(summarise(rows)).toEqual({ added: 0, removed: 0, unchanged: 3 })
  })

  it('detects a pure insertion', () => {
    const rows = run(['a', 'c'], ['a', 'b', 'c'])
    expect(summarise(rows)).toEqual({ added: 1, removed: 0, unchanged: 2 })
    expect(rows.find((row) => row.op === 'add')?.value).toBe('b')
  })

  it('detects a pure deletion', () => {
    const rows = run(['a', 'b', 'c'], ['a', 'c'])
    expect(summarise(rows)).toEqual({ added: 0, removed: 1, unchanged: 2 })
    expect(rows.find((row) => row.op === 'remove')?.value).toBe('b')
  })

  it('shows a modified line as a removal followed by an addition', () => {
    const rows = run(['a', 'old', 'c'], ['a', 'new', 'c'])
    const ops = rows.map((row) => row.op)
    expect(ops).toEqual(['equal', 'remove', 'add', 'equal'])
    // Red before green, matching how the review screen reads top to bottom.
    expect(rows[1].value).toBe('old')
    expect(rows[2].value).toBe('new')
  })

  it('handles an empty document on either side', () => {
    expect(summarise(run([], ['a', 'b']))).toEqual({ added: 2, removed: 0, unchanged: 0 })
    expect(summarise(run(['a', 'b'], []))).toEqual({ added: 0, removed: 2, unchanged: 0 })
    expect(summarise(run([], []))).toEqual({ added: 0, removed: 0, unchanged: 0 })
  })

  it('keeps every row id unique, since decisions are keyed on them', () => {
    const rows = run(['a', 'b', 'x', 'c'], ['a', 'y', 'b', 'c', 'z'])
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  /* ------------------------  the round trips  -------------------------- */

  it('reproduces the original when every change is rejected', () => {
    const before = ['intro', 'body one', 'body two', 'outro']
    const after = ['intro', 'rewritten', 'body two', 'extra', 'outro']
    const rows = run(before, after)
    expect(applyDecisions(rows, new Set())).toEqual(before)
  })

  it('reproduces the incoming document when every change is accepted', () => {
    const before = ['intro', 'body one', 'body two', 'outro']
    const after = ['intro', 'rewritten', 'body two', 'extra', 'outro']
    const rows = run(before, after)
    expect(applyDecisions(rows, allIds(rows))).toEqual(after)
  })

  it('accepting only the additions keeps the original lines as well', () => {
    const before = ['a', 'old']
    const after = ['a', 'new']
    const rows = run(before, after)
    // The deletion was refused, so 'old' survives alongside the accepted 'new'.
    expect(applyDecisions(rows, ids(rows, 'add'))).toEqual(['a', 'old', 'new'])
  })

  it('accepting only the deletions drops lines without adding any', () => {
    const before = ['a', 'old']
    const after = ['a', 'new']
    const rows = run(before, after)
    expect(applyDecisions(rows, ids(rows, 'remove'))).toEqual(['a'])
  })

  /**
   * The review screen lets decisions be made in any combination, so the round
   * trip has to hold for arbitrary subsets rather than only for all-or-nothing.
   * A seeded pass over many random documents is the cheapest way to be sure.
   */
  it('never loses or invents a line, for any combination of decisions', () => {
    let seed = 20260918
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']
    const makeDoc = () =>
      Array.from({ length: Math.floor(random() * 10) }, () => words[Math.floor(random() * words.length)])

    for (let round = 0; round < 300; round += 1) {
      const before = makeDoc()
      const after = makeDoc()
      const rows = run(before, after)

      expect(applyDecisions(rows, new Set())).toEqual(before)
      expect(applyDecisions(rows, allIds(rows))).toEqual(after)

      // And a random subset must still only ever contain lines that came from
      // one side or the other — never anything invented.
      const subset = new Set(rows.filter(() => random() > 0.5).map((row) => row.id))
      const mixed = applyDecisions(rows, subset)
      const available = [...before, ...after]
      for (const line of mixed) expect(available).toContain(line)
    }
  })

  it('still produces a usable result when the documents share nothing', () => {
    const rows = run(['a', 'b'], ['x', 'y'])
    expect(summarise(rows)).toEqual({ added: 2, removed: 2, unchanged: 0 })
    expect(applyDecisions(rows, allIds(rows))).toEqual(['x', 'y'])
    expect(applyDecisions(rows, new Set())).toEqual(['a', 'b'])
  })

  it('diffs a long document with one changed line without falling over', () => {
    const before = Array.from({ length: 2000 }, (_unused, index) => `line ${index}`)
    const after = [...before]
    after[1000] = 'line 1000 (edited)'

    const started = Date.now()
    const rows = run(before, after)
    // The prefix/suffix trim is what keeps this fast; without it the table
    // would be 2000x2000 for a single changed line.
    expect(Date.now() - started).toBeLessThan(1000)
    expect(summarise(rows)).toEqual({ added: 1, removed: 1, unchanged: 1999 })
    expect(applyDecisions(rows, allIds(rows))).toEqual(after)
  })
})

/**
 * Word-level highlighting inside a changed line. The indexes returned here are
 * used to wrap words in the block's real markup, so an index being off by one
 * does not merely look wrong -- it highlights the wrong word.
 */
describe('word diff', () => {
  const before = (a: string, b: string) => [...diffWords(a, b).beforeChanged].sort((x, y) => x - y)
  const after = (a: string, b: string) => [...diffWords(a, b).afterChanged].sort((x, y) => x - y)

  it('marks nothing when the lines match', () => {
    expect(diffWords('the cat sat', 'the cat sat')).toEqual({
      beforeChanged: new Set(),
      afterChanged: new Set(),
    })
  })

  it('marks a single substituted word on both sides', () => {
    // "the cat sat"  ->  "the dog sat"
    expect(before('the cat sat', 'the dog sat')).toEqual([1])
    expect(after('the cat sat', 'the dog sat')).toEqual([1])
  })

  it('marks an inserted word only on the incoming side', () => {
    expect(before('the cat sat', 'the big cat sat')).toEqual([])
    expect(after('the cat sat', 'the big cat sat')).toEqual([1])
  })

  it('marks a deleted word only on the original side', () => {
    expect(before('the big cat sat', 'the cat sat')).toEqual([1])
    expect(after('the big cat sat', 'the cat sat')).toEqual([])
  })

  it('marks several separated changes', () => {
    expect(before('a b c d e', 'a x c y e')).toEqual([1, 3])
    expect(after('a b c d e', 'a x c y e')).toEqual([1, 3])
  })

  it('marks a change at the very start and at the very end', () => {
    expect(before('start middle end', 'begin middle finish')).toEqual([0, 2])
    expect(after('start middle end', 'begin middle finish')).toEqual([0, 2])
  })

  /**
   * Two lines sharing no words are a replacement, not an edit. Marking every
   * word adds nothing over the row's own red or green background.
   */
  it('marks nothing when the lines have no words in common', () => {
    expect(diffWords('alpha beta', 'gamma delta')).toEqual({
      beforeChanged: new Set(),
      afterChanged: new Set(),
    })
  })

  it('treats any run of whitespace as a single separator', () => {
    expect(toWords('  the   cat\n\nsat  ')).toEqual(['the', 'cat', 'sat'])
    // Differing whitespace alone is not a word change.
    expect(diffWords('the cat sat', '  the   cat   sat ')).toEqual({
      beforeChanged: new Set(),
      afterChanged: new Set(),
    })
  })

  it('handles an empty line on either side', () => {
    expect(diffWords('', 'new text')).toEqual({
      beforeChanged: new Set(),
      afterChanged: new Set(),
    })
    expect(diffWords('old text', '')).toEqual({
      beforeChanged: new Set(),
      afterChanged: new Set(),
    })
  })

  /**
   * Every marked index has to be addressable in its own word list, or the
   * highlighter would try to wrap a word that is not there.
   */
  it('only ever returns indexes that exist on the matching side', () => {
    const pairs: [string, string][] = [
      ['one two three', 'one two three four'],
      ['the quick brown fox', 'the slow brown fox jumps'],
      ['a a a b', 'a b a a'],
      ['repeat repeat repeat', 'repeat once repeat'],
    ]

    for (const [a, b] of pairs) {
      const { beforeChanged, afterChanged } = diffWords(a, b)
      const aWords = toWords(a)
      const bWords = toWords(b)
      for (const index of beforeChanged) expect(aWords[index]).toBeDefined()
      for (const index of afterChanged) expect(bWords[index]).toBeDefined()
    }
  })
})

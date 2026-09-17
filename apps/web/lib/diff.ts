'use client'

/**
 * Line diff, used to review an incoming document before it lands.
 *
 * Written here rather than pulled from a package because the requirement is
 * narrow and the input is bounded: two lists of document blocks, compared by
 * their text. A general diff library would bring word-level and patch-format
 * machinery that nothing here uses.
 *
 * The algorithm is longest-common-subsequence with the common prefix and
 * suffix trimmed off first. The trim matters more than it looks: importing a
 * file usually changes a handful of blocks in a document that is otherwise
 * identical, and without it the O(n*m) table is built over the whole document
 * every time instead of over the few lines that actually differ.
 */

export type DiffOp = 'equal' | 'add' | 'remove'

export interface DiffRow<T> {
  /** Stable across re-renders, so accept/reject state can be keyed on it. */
  id: string
  op: DiffOp
  value: T
  /** Index in the original list, or null for an added row. */
  beforeIndex: number | null
  /** Index in the incoming list, or null for a removed row. */
  afterIndex: number | null
}

/**
 * Above this, the LCS table gets large enough to be worth avoiding. Falls back
 * to "replace everything wholesale", which is still correct — it is simply a
 * coarser review than a line-by-line one.
 */
const MAX_CELLS = 4_000_000

function buildRows<T>(
  before: T[],
  after: T[],
  key: (item: T) => string,
): DiffRow<T>[] {
  const rows: DiffRow<T>[] = []
  let counter = 0
  const push = (op: DiffOp, value: T, beforeIndex: number | null, afterIndex: number | null) => {
    counter += 1
    rows.push({ id: `${op}-${counter}`, op, value, beforeIndex, afterIndex })
  }

  // --- trim the identical head ---
  let start = 0
  while (start < before.length && start < after.length && key(before[start]) === key(after[start])) {
    push('equal', before[start], start, start)
    start += 1
  }

  // --- trim the identical tail ---
  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > start &&
    endAfter > start &&
    key(before[endBefore - 1]) === key(after[endAfter - 1])
  ) {
    endBefore -= 1
    endAfter -= 1
  }

  const midBefore = before.slice(start, endBefore)
  const midAfter = after.slice(start, endAfter)

  if (midBefore.length * midAfter.length > MAX_CELLS) {
    // Too big to diff meaningfully; present it as a wholesale swap.
    midBefore.forEach((value, index) => push('remove', value, start + index, null))
    midAfter.forEach((value, index) => push('add', value, null, start + index))
  } else {
    // --- LCS table over the middle only ---
    const rowsCount = midBefore.length
    const colsCount = midAfter.length
    const table: number[][] = Array.from({ length: rowsCount + 1 }, () =>
      new Array<number>(colsCount + 1).fill(0),
    )

    for (let i = rowsCount - 1; i >= 0; i -= 1) {
      for (let j = colsCount - 1; j >= 0; j -= 1) {
        table[i][j] =
          key(midBefore[i]) === key(midAfter[j])
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }

    let i = 0
    let j = 0
    while (i < rowsCount && j < colsCount) {
      if (key(midBefore[i]) === key(midAfter[j])) {
        push('equal', midBefore[i], start + i, start + j)
        i += 1
        j += 1
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        // Removal before addition, so a changed line reads as red-then-green
        // rather than the other way round.
        push('remove', midBefore[i], start + i, null)
        i += 1
      } else {
        push('add', midAfter[j], null, start + j)
        j += 1
      }
    }
    while (i < rowsCount) {
      push('remove', midBefore[i], start + i, null)
      i += 1
    }
    while (j < colsCount) {
      push('add', midAfter[j], null, start + j)
      j += 1
    }
  }

  // --- the identical tail we trimmed ---
  for (let offset = 0; offset < before.length - endBefore; offset += 1) {
    push('equal', before[endBefore + offset], endBefore + offset, endAfter + offset)
  }

  return rows
}

export function diffLines<T>(before: T[], after: T[], key: (item: T) => string): DiffRow<T>[] {
  return buildRows(before, after, key)
}

/**
 * Apply a review decision to produce the final list.
 *
 * `accepted` holds the row ids the person agreed to. The two ops mean opposite
 * things, which is the part worth being explicit about:
 *
 *  - accepting a `remove` drops the line; rejecting it keeps the original
 *  - accepting an `add` inserts the line; rejecting it leaves it out
 *
 * So rejecting everything reproduces the original document exactly, and
 * accepting everything reproduces the incoming one exactly. Both are asserted
 * in the tests, because a diff you cannot fully reject is a diff you cannot
 * trust.
 */
export function applyDecisions<T>(rows: DiffRow<T>[], accepted: ReadonlySet<string>): T[] {
  const out: T[] = []
  for (const row of rows) {
    if (row.op === 'equal') out.push(row.value)
    else if (row.op === 'add') {
      if (accepted.has(row.id)) out.push(row.value)
    } else if (!accepted.has(row.id)) {
      out.push(row.value)
    }
  }
  return out
}

export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

export function summarise<T>(rows: DiffRow<T>[]): DiffStats {
  return rows.reduce<DiffStats>(
    (stats, row) => {
      if (row.op === 'add') stats.added += 1
      else if (row.op === 'remove') stats.removed += 1
      else stats.unchanged += 1
      return stats
    },
    { added: 0, removed: 0, unchanged: 0 },
  )
}

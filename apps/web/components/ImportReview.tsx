'use client'

import { useMemo, useState } from 'react'
import { applyDecisions, diffLines, diffWords, summarise, type DiffRow } from '@/lib/diff'
import { highlightWords, type DocumentBlock } from '@/lib/import'
import { Icon } from '@/lib/icons'

interface ImportReviewProps {
  before: DocumentBlock[]
  after: DocumentBlock[]
  fileName: string
  onCancel: () => void
  onApply: (blocks: DocumentBlock[]) => void
}

/** Unchanged lines shown either side of a change, before collapsing the rest. */
const CONTEXT = 2

/** Shared empty set, so rows with no word diff do not allocate one each render. */
const EMPTY: ReadonlySet<number> = new Set()

interface Segment {
  kind: 'rows' | 'gap'
  rows: DiffRow<DocumentBlock>[]
}

/**
 * Collapse long stretches of untouched document.
 *
 * A review screen for a file dropped into a fifty-paragraph document is mostly
 * paragraphs nobody needs to read again. Keeping a couple of lines of context
 * either side of each change is what makes the changes findable rather than
 * buried.
 */
function segment(rows: DiffRow<DocumentBlock>[]): Segment[] {
  const interesting = new Set<number>()
  rows.forEach((row, index) => {
    if (row.op === 'equal') return
    for (let offset = -CONTEXT; offset <= CONTEXT; offset += 1) {
      interesting.add(index + offset)
    }
  })

  const segments: Segment[] = []
  let current: Segment | null = null

  rows.forEach((row, index) => {
    const kind: Segment['kind'] = interesting.has(index) ? 'rows' : 'gap'
    if (!current || current.kind !== kind) {
      current = { kind, rows: [] }
      segments.push(current)
    }
    current.rows.push(row)
  })

  return segments
}

/**
 * Pair each removed line with the added line that replaced it.
 *
 * The diff emits changes as a run of removals followed by a run of additions,
 * so within a run the nth removal corresponds to the nth addition. Pairing
 * them is what makes a word-level comparison possible: on their own, a removal
 * and an addition are two unrelated lines, and there is nothing to compare.
 *
 * Returns, per row id, the word positions that differ from its counterpart.
 * Rows with no counterpart -- a pure insertion or a pure deletion -- get
 * nothing, because every word in them is new or gone and highlighting all of
 * them says less than the row's own colour already does.
 */
function pairWordDiffs(rows: DiffRow<DocumentBlock>[]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>()

  let index = 0
  while (index < rows.length) {
    if (rows[index].op === 'equal') {
      index += 1
      continue
    }

    const removals: DiffRow<DocumentBlock>[] = []
    const additions: DiffRow<DocumentBlock>[] = []
    while (index < rows.length && rows[index].op !== 'equal') {
      if (rows[index].op === 'remove') removals.push(rows[index])
      else additions.push(rows[index])
      index += 1
    }

    const pairs = Math.min(removals.length, additions.length)
    for (let offset = 0; offset < pairs; offset += 1) {
      const before = removals[offset]
      const after = additions[offset]
      const { beforeChanged, afterChanged } = diffWords(before.value.text, after.value.text)
      result.set(before.id, beforeChanged)
      result.set(after.id, afterChanged)
    }
  }

  return result
}

export function ImportReview({
  before,
  after,
  fileName,
  onCancel,
  onApply,
}: ImportReviewProps) {
  const rows = useMemo(
    () => diffLines(before, after, (block) => block.text),
    [before, after],
  )

  // Everything starts accepted: the person chose to import this file, so the
  // default is "yes, apply it" and the review exists to take things back out.
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(rows.filter((row) => row.op !== 'equal').map((row) => row.id)),
  )
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const stats = useMemo(() => summarise(rows), [rows])
  const wordDiffs = useMemo(() => pairWordDiffs(rows), [rows])
  const changed = rows.filter((row) => row.op !== 'equal')
  const segments = useMemo(() => segment(rows), [rows])

  const toggle = (id: string) =>
    setAccepted((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const acceptedCount = changed.filter((row) => accepted.has(row.id)).length

  return (
    <>
      <div className="review-head">
        <div className="review-head__text">
          <strong>{fileName}</strong>
          <span>
            {stats.added} to add · {stats.removed} to remove · {stats.unchanged} unchanged
          </span>
        </div>
        <button
          type="button"
          className="btn btn--soft"
          onClick={() => setAccepted(new Set(changed.map((row) => row.id)))}
        >
          Accept all
        </button>
        <button type="button" className="btn btn--soft" onClick={() => setAccepted(new Set())}>
          Reject all
        </button>
      </div>

      <div className="review" role="list">
        {segments.map((seg, segIndex) =>
          seg.kind === 'gap' && seg.rows.length > 2 && !expanded.has(segIndex) ? (
            <button
              type="button"
              key={`gap-${segIndex}`}
              className="review__gap"
              onClick={() => setExpanded((current) => new Set(current).add(segIndex))}
            >
              <Icon name="chevronDown" size={13} />
              Show {seg.rows.length} unchanged lines
            </button>
          ) : (
            seg.rows.map((row) => {
              const isChange = row.op !== 'equal'
              const isAccepted = accepted.has(row.id)
              // A rejected change is shown struck through rather than removed,
              // so the decision stays visible and reversible in place.
              const state = !isChange ? 'equal' : isAccepted ? 'accepted' : 'rejected'

              return (
                <div className="review__row" data-op={row.op} data-state={state} key={row.id} role="listitem">
                  <span className="review__num">
                    {row.op === 'add' ? '' : (row.beforeIndex ?? 0) + 1}
                  </span>
                  <span className="review__sign" aria-hidden>
                    {row.op === 'add' ? '+' : row.op === 'remove' ? '−' : ''}
                  </span>

                  <span
                    className="review__text"
                    // The block's own markup is rendered so the reviewer sees a
                    // heading as a heading, with the words that actually differ
                    // marked inside it. Both the markup and the highlight have
                    // been through the importer's sanitiser by this point.
                    dangerouslySetInnerHTML={{
                      __html: highlightWords(row.value.html, wordDiffs.get(row.id) ?? EMPTY),
                    }}
                  />

                  {isChange && (
                    <span className="review__actions">
                      <button
                        type="button"
                        className="review__btn"
                        data-kind="accept"
                        data-on={isAccepted ? 'true' : 'false'}
                        title={row.op === 'add' ? 'Add this line' : 'Remove this line'}
                        onClick={() => !isAccepted && toggle(row.id)}
                      >
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        type="button"
                        className="review__btn"
                        data-kind="reject"
                        data-on={!isAccepted ? 'true' : 'false'}
                        title={row.op === 'add' ? 'Skip this line' : 'Keep this line'}
                        onClick={() => isAccepted && toggle(row.id)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </span>
                  )}
                </div>
              )
            })
          ),
        )}

        {changed.length === 0 && (
          <div className="empty">
            This file matches the document exactly. There is nothing to apply.
          </div>
        )}
      </div>

      <div className="review-foot">
        <span className="field__hint">
          {acceptedCount} of {changed.length} change{changed.length === 1 ? '' : 's'} accepted.
          Rejecting everything leaves the document exactly as it is.
        </span>
        <span className="topbar__spacer" />
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={changed.length === 0}
          onClick={() => onApply(applyDecisions(rows, accepted))}
        >
          <Icon name="check" size={15} />
          Apply {acceptedCount} change{acceptedCount === 1 ? '' : 's'}
        </button>
      </div>
    </>
  )
}

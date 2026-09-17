'use client'

import { useMemo, useState } from 'react'
import { applyDecisions, diffLines, summarise, type DiffRow } from '@/lib/diff'
import type { DocumentBlock } from '@/lib/import'
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
                    // heading as a heading. It has already been through the
                    // importer's sanitiser by this point.
                    dangerouslySetInnerHTML={{ __html: row.value.html }}
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

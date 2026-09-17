'use client'

import { useEffect, useRef } from 'react'
import { Icon } from '@/lib/icons'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  align?: 'center' | 'top'
  width?: number
}

/**
 * Minimal dialog: Escape closes, a click on the backdrop closes, focus moves
 * inside on open and the page behind stops scrolling. Not a full focus trap,
 * but enough that a keyboard user is never stranded.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  align = 'center',
  width,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  // Held in a ref so the Escape listener below always calls the current
  // handler without having to re-subscribe when its identity changes.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  /**
   * Move focus into the dialog, exactly once.
   *
   * This deliberately has an empty dependency list. It used to depend on
   * `onClose`, which callers pass as an inline arrow -- a new function on every
   * render of the parent. The parent re-renders on a timer (server stats poll
   * every few seconds, plus every metrics update), so the effect re-ran
   * constantly and each run called focus() again, throwing the caret back to
   * the first field in the dialog. Typing an email address into the Share
   * dialog was close to impossible: the cursor jumped out mid-word.
   */
  useEffect(() => {
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'input, textarea, button, [href], select',
    )
    focusable?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className={`overlay overlay--${align}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={cardRef}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <div className="modal__head">
          <span className="modal__title">{title}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  )
}

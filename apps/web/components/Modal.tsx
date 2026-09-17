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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'input, textarea, button, [href], select',
    )
    focusable?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

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

'use client'

import { useState } from 'react'
import { Modal } from './Modal'

interface PromptDialogProps {
  title: string
  label: string
  hint?: string
  placeholder?: string
  initialValue?: string
  submitLabel?: string
  allowRemove?: boolean
  onSubmit: (value: string) => void
  onRemove?: () => void
  onClose: () => void
}

export function PromptDialog({
  title,
  label,
  hint,
  placeholder,
  initialValue = '',
  submitLabel = 'Apply',
  allowRemove = false,
  onSubmit,
  onRemove,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onClose()
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          {allowRemove && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                onRemove?.()
                onClose()
              }}
              style={{ marginRight: 'auto' }}
            >
              Remove
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={!value.trim()}
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="field__label">{label}</span>
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        {hint && <span className="field__hint">{hint}</span>}
      </div>
    </Modal>
  )
}

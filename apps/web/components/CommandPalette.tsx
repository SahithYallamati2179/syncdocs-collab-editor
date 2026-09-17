'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from '@/lib/icons'

export interface Command {
  id: string
  label: string
  group: string
  icon: IconName
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.group} ${command.label}`.toLowerCase().includes(needle),
    )
  }, [commands, query])

  // Keep the highlight inside the list as it shrinks under the query.
  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, matches.length - 1)))
  }, [matches.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((current) => (current + 1) % Math.max(1, matches.length))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((current) => (current - 1 + matches.length) % Math.max(1, matches.length))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const command = matches[index]
        if (command) {
          onClose()
          command.run()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [matches, index, onClose])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [index])

  let lastGroup = ''

  return (
    <div
      className="overlay overlay--top"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          className="cmd-input"
          placeholder="Search commands…"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search commands"
        />
        <div className="cmd-list" ref={listRef} role="listbox">
          {matches.length === 0 && <div className="empty">No matching command.</div>}
          {matches.map((command, position) => {
            const header = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            return (
              <div key={command.id}>
                {header && <div className="cmd-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={position === index}
                  className="cmd-item"
                  data-active={position === index ? 'true' : 'false'}
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => {
                    onClose()
                    command.run()
                  }}
                >
                  <Icon name={command.icon} size={15} />
                  {command.label}
                  {command.hint && <span className="cmd-item__hint">{command.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

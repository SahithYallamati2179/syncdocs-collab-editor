'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { CollabSession } from './collab'
import type { Identity } from './identity'

/**
 * Comments live inside the same Y.Doc as the prose.
 *
 * That is the whole point: they inherit every property the document already
 * has. Two people can comment during a network partition and both comments
 * survive the merge; a comment written offline is in IndexedDB before it is
 * anywhere else; and the existing persistence pipeline stores them with no new
 * table, endpoint or sync path. A separate REST-backed comment store would have
 * needed its own conflict story.
 */

export interface CommentRecord {
  id: string
  parentId: string | null
  authorId: string
  authorName: string
  authorColor: string
  body: string
  createdAt: number
  resolved: boolean
  /**
   * The text that was selected when the comment was made.
   *
   * Stored as a copy, not as a pointer: the live anchor is the mark in the
   * prose, and this is what the panel shows so a thread still reads sensibly
   * after the underlying sentence has been rewritten — or deleted, which takes
   * the mark with it and would otherwise leave a comment about nothing.
   */
  quote: string
}

export interface CommentThread extends CommentRecord {
  replies: CommentRecord[]
}

const KEY = 'comments'

function commentsArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(KEY)
}

function toRecord(entry: Y.Map<unknown>): CommentRecord | null {
  const id = entry.get('id')
  if (typeof id !== 'string') return null
  return {
    id,
    parentId: (entry.get('parentId') as string | null) ?? null,
    authorId: String(entry.get('authorId') ?? ''),
    authorName: String(entry.get('authorName') ?? 'Anonymous'),
    authorColor: String(entry.get('authorColor') ?? '#6b7280'),
    body: String(entry.get('body') ?? ''),
    createdAt: Number(entry.get('createdAt') ?? 0),
    resolved: Boolean(entry.get('resolved')),
    quote: String(entry.get('quote') ?? ''),
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().slice(0, 18)
  }
  return `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`
}

export function addComment(
  doc: Y.Doc,
  identity: Identity,
  body: string,
  parentId: string | null = null,
  quote = '',
): string | null {
  const text = body.trim()
  if (!text) return null

  const id = newId()
  const entry = new Y.Map<unknown>()
  // Populate inside a transaction so peers observe one atomic insert rather
  // than an empty map that fills in field by field.
  doc.transact(() => {
    entry.set('id', id)
    entry.set('parentId', parentId)
    entry.set('authorId', identity.id)
    entry.set('authorName', identity.name)
    entry.set('authorColor', identity.color)
    entry.set('body', text)
    entry.set('createdAt', Date.now())
    entry.set('resolved', false)
    // Trimmed on the way in: a comment on three paragraphs of selected text
    // should not put three paragraphs in the sidebar.
    entry.set('quote', quote.replace(/\s+/g, ' ').trim().slice(0, 240))
    commentsArray(doc).push([entry])
  })
  return id
}

export function setResolved(doc: Y.Doc, id: string, resolved: boolean): void {
  const array = commentsArray(doc)
  doc.transact(() => {
    for (let index = 0; index < array.length; index += 1) {
      const entry = array.get(index)
      if (entry.get('id') === id) {
        entry.set('resolved', resolved)
        return
      }
    }
  })
}

export function deleteComment(doc: Y.Doc, id: string): void {
  const array = commentsArray(doc)
  doc.transact(() => {
    // Walk backwards: removing shifts every later index.
    for (let index = array.length - 1; index >= 0; index -= 1) {
      const entry = array.get(index)
      if (entry.get('id') === id || entry.get('parentId') === id) {
        array.delete(index, 1)
      }
    }
  })
}

export function readThreads(doc: Y.Doc): CommentThread[] {
  const records: CommentRecord[] = []
  commentsArray(doc).forEach((entry) => {
    const record = toRecord(entry)
    if (record) records.push(record)
  })

  const roots = records
    .filter((record) => record.parentId === null)
    .sort((a, b) => b.createdAt - a.createdAt)

  return roots.map((root) => ({
    ...root,
    replies: records
      .filter((record) => record.parentId === root.id)
      .sort((a, b) => a.createdAt - b.createdAt),
  }))
}

export function useComments(session: CollabSession | null): CommentThread[] {
  const [threads, setThreads] = useState<CommentThread[]>([])

  useEffect(() => {
    const doc = session?.doc
    if (!doc) {
      setThreads([])
      return
    }

    const read = () => setThreads(readThreads(doc))
    read()

    // `observeDeep` is required, not `observe`: toggling `resolved` mutates a
    // nested Y.Map and never touches the array itself.
    const array = commentsArray(doc)
    array.observeDeep(read)
    return () => array.unobserveDeep(read)
  }, [session])

  return threads
}

export function unresolvedCount(threads: CommentThread[]): number {
  return threads.filter((thread) => !thread.resolved).length
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

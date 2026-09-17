'use client'

import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import { authHeaders } from './auth'
import type { CollabSession } from './collab'

export const HTTP_URL = process.env.NEXT_PUBLIC_COLLAB_HTTP_URL ?? 'http://127.0.0.1:1234'

export const DEFAULT_TITLE = 'Untitled document'
const RECENT_KEY = 'collab-editor:recent'
const RECENT_MAX = 12
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface ServerDocument {
  name: string
  title: string
  bytes: number
  updatedAt: string
}

export interface SnapshotMeta {
  id: string
  createdAt: string
  bytes: number
}

export interface AclMember {
  email: string
  addedAt: string
}

export interface DocumentAcl {
  ownerId: string
  ownerEmail: string
  members: AclMember[]
  createdAt: string
}

export interface DocumentAccess {
  acl: DocumentAcl | null
  isOwner: boolean
  authRequired: boolean
}

export interface ServerStats {
  uptimeSeconds: number
  connections: number
  peakConnections: number
  openDocuments: number
  loads: number
  writes: number
  snapshots: number
  bytesWritten: number
  authFailures: number
}

export function isValidDocumentId(id: string): boolean {
  return NAME_PATTERN.test(id)
}

/** Must satisfy the server's document-name rule. */
export function newDocumentId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `doc-${random.slice(0, 12)}`
}

/* ----------------------------  recents  --------------------------------- */

export function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function rememberDocument(id: string): void {
  try {
    const next = [id, ...readRecents().filter((entry) => entry !== id)].slice(0, RECENT_MAX)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* non-fatal */
  }
}

/* ------------------------------  title  --------------------------------- */

/**
 * The title lives in the Y.Doc, so renaming it is a collaborative edit like any
 * other: it merges, it survives a partition, and it is persisted by the same
 * pipeline as the prose.
 */
export function useDocumentTitle(
  session: CollabSession | null,
): [string, (next: string) => void] {
  const [title, setTitle] = useState('')

  useEffect(() => {
    const doc = session?.doc
    if (!doc) {
      setTitle('')
      return
    }

    const meta = doc.getMap('meta')
    const read = () => {
      const value = meta.get('title')
      setTitle(typeof value === 'string' ? value : '')
    }
    read()
    meta.observe(read)
    return () => meta.unobserve(read)
  }, [session])

  const update = useCallback(
    (next: string) => {
      if (!session) return
      session.doc.getMap('meta').set('title', next.slice(0, 120))
    },
    [session],
  )

  return [title, update]
}

/* ------------------------------  server  -------------------------------- */

/**
 * Every call carries the bearer token, because the sync server enforces access
 * on these endpoints too — listing documents leaks names, and the access
 * endpoints change permissions. Guarding only the WebSocket would move the hole
 * rather than close it.
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(init.headers ?? {}), ...(await authHeaders()) }
  return fetch(`${HTTP_URL}${path}`, { ...init, headers })
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string }
    return data.error || fallback
  } catch {
    return fallback
  }
}

export async function fetchDocuments(signal?: AbortSignal): Promise<ServerDocument[]> {
  const response = await apiFetch('/api/documents', { signal })
  if (!response.ok) throw new Error(await readError(response, `Document list failed (${response.status})`))
  const data = (await response.json()) as { documents?: ServerDocument[] }
  return data.documents ?? []
}

export async function fetchDocumentAccess(documentId: string): Promise<DocumentAccess> {
  const response = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/access`)
  if (!response.ok) throw new Error(await readError(response, 'Could not read access settings.'))
  return (await response.json()) as DocumentAccess
}

export async function addDocumentMember(
  documentId: string,
  email: string,
): Promise<DocumentAccess> {
  const response = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!response.ok) throw new Error(await readError(response, 'Could not invite that address.'))
  return (await response.json()) as DocumentAccess
}

export async function removeDocumentMember(
  documentId: string,
  email: string,
): Promise<DocumentAccess> {
  const response = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/access`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!response.ok) throw new Error(await readError(response, 'Could not remove that person.'))
  return (await response.json()) as DocumentAccess
}

export async function fetchStats(signal?: AbortSignal): Promise<ServerStats> {
  const response = await apiFetch('/api/stats', { signal })
  if (!response.ok) throw new Error(`Stats failed (${response.status})`)
  return (await response.json()) as ServerStats
}

export async function fetchSnapshots(documentId: string): Promise<SnapshotMeta[]> {
  const response = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/snapshots`)
  if (!response.ok) throw new Error(await readError(response, 'Could not read version history.'))
  const data = (await response.json()) as { snapshots?: SnapshotMeta[] }
  return data.snapshots ?? []
}

/** Fetches one snapshot and decodes it into a detached Y.Doc for inspection. */
export async function fetchSnapshotDoc(documentId: string, snapshotId: string): Promise<Y.Doc> {
  const response = await apiFetch(
    `/api/documents/${encodeURIComponent(documentId)}/snapshots/${encodeURIComponent(snapshotId)}`,
  )
  if (!response.ok) throw new Error(await readError(response, 'Could not load that snapshot.'))
  const data = (await response.json()) as { state: string }

  const binary = atob(data.state)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const doc = new Y.Doc()
  Y.applyUpdate(doc, bytes)
  return doc
}

export function useServerDocuments(refreshToken = 0): {
  documents: ServerDocument[] | null
  error: string | null
} {
  const [documents, setDocuments] = useState<ServerDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchDocuments(controller.signal)
      .then((list) => {
        setDocuments(list)
        setError(null)
      })
      .catch((cause: Error) => {
        if (cause.name === 'AbortError') return
        setError('Sync server unreachable')
        setDocuments([])
      })
    return () => controller.abort()
  }, [refreshToken])

  return { documents, error }
}

export function useServerStats(intervalMs = 5000): ServerStats | null {
  const [stats, setStats] = useState<ServerStats | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchStats()
        .then((value) => {
          if (!cancelled) setStats(value)
        })
        .catch(() => {
          if (!cancelled) setStats(null)
        })
    }
    load()
    const timer = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [intervalMs])

  return stats
}

/** Rough workspace-usage percentage, against a nominal free-tier style quota. */
export const STORAGE_QUOTA_BYTES = 500 * 1024 * 1024

export function storagePercent(documents: ServerDocument[] | null): number {
  if (!documents || documents.length === 0) return 0
  const used = documents.reduce((total, document) => total + document.bytes, 0)
  return Math.min(100, Math.round((used / STORAGE_QUOTA_BYTES) * 1000) / 10)
}

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
  /** Empty for snapshots written before author tracking existed. */
  author: string
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
  linkAccess: LinkAccess
}

/**
 * What the bare URL grants on its own. Mirrors the server's type; the labels
 * live next to it so the dialog and the toast never drift apart.
 */
export type LinkAccess = 'restricted' | 'view' | 'edit'

export const LINK_ACCESS_OPTIONS: {
  id: LinkAccess
  label: string
  detail: string
  /** Emphasised under the detail line, the way the reference design does it. */
  note?: string
  icon: 'lock' | 'globe'
}[] = [
  {
    id: 'restricted',
    label: 'Only invited people',
    detail: 'Only you and the people you invite can open this. The link on its own does nothing.',
    icon: 'lock',
  },
  {
    id: 'view',
    label: 'Anyone with the link can view',
    detail: 'Anyone can read the document using this link.',
    note: 'No sign in required.',
    icon: 'globe',
  },
  {
    id: 'edit',
    label: 'Anyone with the link can edit',
    detail: 'Anyone can read and edit the document using this link.',
    note: 'No sign in required.',
    icon: 'globe',
  },
]

/** What this user may do here. `viewer` is enforced by the server, not the UI. */
export type Role = 'owner' | 'editor' | 'viewer'

export interface DocumentAccess {
  acl: DocumentAcl | null
  role: Role
  isOwner: boolean
  /** True when the server resolved this caller without a signed-in account. */
  isGuest: boolean
  linkAccess: LinkAccess
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

/**
 * Parse a success body, treating "this is not JSON" as its own failure.
 *
 * A 200 does not guarantee our server answered. A free-tier host waking up
 * returns an HTML holding page, a proxy returns an HTML error, and a server
 * running an older build answers an endpoint it does not know with its
 * framework's plain-text catch-all. All three are `response.ok`, and all three
 * make response.json() throw "Unexpected token <" — which tells the person
 * reading it nothing about what actually went wrong.
 */
async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(
      `${fallback} The sync server answered ${response.status} with something that was not ` +
        `JSON, which usually means it is still waking up, or is running an older build that ` +
        `does not have this feature yet.`,
    )
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
  return readJson<DocumentAccess>(response, 'Could not read access settings.')
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
  return readJson<DocumentAccess>(response, 'Could not invite that address.')
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
  return readJson<DocumentAccess>(response, 'Could not remove that person.')
}

/**
 * Permanently delete a document. Owner only; the server enforces that.
 *
 * There is no soft-delete or trash here, which is why the caller is expected
 * to confirm first — the server has no undo to offer.
 */
export async function deleteDocument(documentId: string): Promise<void> {
  const response = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error(await readError(response, 'Could not delete that document.'))
}

/**
 * Change what the bare link grants. Owner-only, enforced on the server; the
 * dialog hides the control for everyone else as a courtesy, not as the check.
 */
export async function setLinkAccess(
  documentId: string,
  linkAccess: LinkAccess,
): Promise<DocumentAccess> {
  const response = await apiFetch(
    `/api/documents/${encodeURIComponent(documentId)}/access/link`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ linkAccess }),
    },
  )
  if (!response.ok) throw new Error(await readError(response, 'Could not change link sharing.'))
  return readJson<DocumentAccess>(response, 'Could not change link sharing.')
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

/** How long to wait before retrying a failed document listing. */
const DOCUMENT_RETRY_MS = 8_000

export function useServerDocuments(refreshToken = 0): {
  documents: ServerDocument[] | null
  error: string | null
} {
  const [documents, setDocuments] = useState<ServerDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined

    fetchDocuments(controller.signal)
      .then((list) => {
        setDocuments(list)
        setError(null)
      })
      .catch((cause: Error) => {
        if (cause.name === 'AbortError') return
        setDocuments([])
        // Free hosting tiers sleep after a few minutes idle and answer the
        // first request with a gateway error while they wake. Without a retry
        // the explorer would sit on a failure message forever, because its
        // other trigger (the server write counter) is fetched from the same
        // server and is failing too.
        setError('Waking the sync server…')
        retry = setTimeout(() => setAttempt((value) => value + 1), DOCUMENT_RETRY_MS)
      })

    return () => {
      controller.abort()
      if (retry) clearTimeout(retry)
    }
  }, [refreshToken, attempt])

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

'use client'

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import { getAccessToken } from './auth'
import { type Identity, identityToken } from './identity'
import { authEnabled } from './supabase'
import { metrics } from './metrics'

const WS_URL = process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? 'ws://127.0.0.1:1234'

const GRACE_MS = 5_000
const FOOTPRINT_INTERVAL_MS = 2_000
const RTT_INTERVAL_MS = 4_000

export interface CollabSession {
  documentId: string
  doc: Y.Doc
  provider: HocuspocusProvider
  local: IndexeddbPersistence
  /** Report the editor character count so the footprint sampler can plot it. */
  reportCharCount(count: number): void
  /** Stamp the local awareness state so peers can measure presence latency. */
  ping(): void
  /** Close the socket for real — a simulated network partition. */
  disconnect(): void
  reconnect(): void
  /** Ask the provider to re-run the sync protocol against the server. */
  forceSync(): void
  /** Artificial egress delay, in milliseconds. 0 disables it. */
  setLag(ms: number): void
}

interface CacheEntry {
  session: CollabSession
  refs: number
  teardown: () => void
  graceTimer: ReturnType<typeof setTimeout> | null
}

/**
 * One session per document id, shared by every component that asks for it.
 *
 * This cache exists because a Y.Doc plus its providers is not something you
 * want tied to a component lifecycle: React StrictMode mounts effects twice in
 * development, and a naive create-in-useEffect opens two sockets and two
 * IndexedDB connections for the same document. Refcounting with a short grace
 * period survives that, and survives route changes that revisit the same doc.
 */
const cache = new Map<string, CacheEntry>()

function countItems(doc: Y.Doc): number {
  // doc.store.clients is internal Yjs state. It is the only place the struct
  // count (live items plus tombstones) is visible, and tombstone growth is
  // exactly what the footprint question is about, so it is worth reaching for.
  try {
    const store = (doc as unknown as { store: { clients: Map<number, unknown[]> } }).store
    let total = 0
    store.clients.forEach((structs) => {
      total += structs.length
    })
    return total
  } catch {
    return 0
  }
}


/**
 * Turn the WebSocket close reason into something worth reading.
 *
 * Hocuspocus does not forward the message thrown by onAuthenticate; a refusal
 * arrives as the bare code `permission-denied`, which is accurate and tells
 * the person nothing about what to do next. The REST /access call returns the
 * server's real sentence, and the shell prefers that when it has it -- this is
 * the fallback for when the socket is the only thing that answered.
 */
function humaniseAuthFailure(reason: string): string {
  if (!reason || reason === 'permission-denied') {
    return 'This document is private. Sign in if you were invited, or ask the owner for a shareable link.'
  }
  return reason
}

function createSession(documentId: string, identity: Identity): CacheEntry {
  // gc: true lets Yjs collapse tombstones left behind by deleted content once
  // nothing references them. Without it a long-lived document grows forever.
  const doc = new Y.Doc({ gc: true })

  const local = new IndexeddbPersistence(`collab-editor:${documentId}`, doc)

  // The socket is created explicitly rather than letting the provider make one.
  // HocuspocusProvider.disconnect() only detaches the provider from a shared
  // socket -- the connection itself stays open -- so a partition has to be
  // simulated at this level to be a real partition.
  const socket = new HocuspocusProviderWebsocket({ url: WS_URL })

  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: documentId,
    document: doc,
    // A function, not a string: the provider calls this again on every
    // reconnect, so an access token that expired during a long partition is
    // refreshed rather than replayed stale.
    token: async () => {
      if (!authEnabled) return identityToken(identity)
      // Signed out is a legitimate state: a document whose link level is view
      // or edit opens without an account. Hocuspocus will not connect at all
      // when no token arrives, so the guest sentinel has to be a real string;
      // it carries a display name purely so the visitor gets a cursor label.
      return (
        (await getAccessToken()) ??
        `guest:${JSON.stringify({ name: identity.name })}`
      )
    },
  })

  let charCount = 0
  let disconnectedAt: number | null = null
  let offlineEdits = 0
  let lagMs = 0
  const lastPingByClient = new Map<number, number>()
  const patchedSockets = new WeakSet<object>()

  /**
   * Lag is injected by wrapping the raw WebSocket's send. This delays *egress*
   * only, which is what a one-sided simulation can honestly claim: the server
   * still answers at full speed, so a measured round trip moves by roughly the
   * configured amount rather than twice it.
   */
  function patchSocketSend(): void {
    const raw = (socket as unknown as { webSocket: WebSocket | null }).webSocket
    if (!raw || patchedSockets.has(raw)) return
    patchedSockets.add(raw)

    const originalSend = raw.send.bind(raw)
    raw.send = ((data: Parameters<WebSocket['send']>[0]) => {
      if (lagMs <= 0) {
        originalSend(data)
        return
      }
      setTimeout(() => {
        // The socket may have closed while the message was held.
        if (raw.readyState === WebSocket.OPEN) originalSend(data)
      }, lagMs)
    }) as WebSocket['send']
  }

  local.on('synced', () => {
    metrics.recordEvent('info', 'Loaded local IndexedDB copy')
  })

  provider.on('status', (event: { status: string }) => {
    if (event.status === WebSocketStatus.Connected) {
      metrics.setStatus('connected')
      metrics.recordEvent('connect', 'WebSocket connected')
      patchSocketSend()
    } else if (event.status === WebSocketStatus.Connecting) {
      metrics.setStatus('connecting')
    } else {
      metrics.setStatus('disconnected')
      metrics.setSynced(false)
      if (disconnectedAt === null) {
        disconnectedAt = Date.now()
        metrics.recordEvent('disconnect', 'WebSocket lost')
      }
    }
  })

  // The synced event fires in both directions: `state` is false when the
  // provider goes out of sync (which happens as the socket closes) and true
  // when it has caught up. Treating every synced event as "caught up" makes the
  // convergence timer read zero.
  provider.on('synced', ({ state }: { state: boolean }) => {
    if (!state) {
      metrics.setSynced(false)
      return
    }

    metrics.setSynced(true)
    if (disconnectedAt !== null) {
      const elapsed = Date.now() - disconnectedAt
      metrics.setConvergence(elapsed)
      metrics.recordEvent(
        'sync',
        `Converged ${elapsed}ms after the partition, ${offlineEdits} offline edit(s) merged`,
      )
      disconnectedAt = null
    } else {
      metrics.recordEvent('sync', 'Initial sync complete')
    }
    offlineEdits = 0
    metrics.setOfflineEdits(0)
  })

  provider.on('authenticationFailed', (event: { reason: string }) => {
    metrics.recordEvent('error', `Access denied: ${event.reason}`)
    metrics.setAccessError(humaniseAuthFailure(event.reason))
    // Without this the provider retries forever against a server that has
    // already said no, which looks like a flapping connection rather than a
    // permissions problem.
    socket.disconnect()
  })

  // Round-trip timing, echoed by the server's onStateless hook.
  provider.on('stateless', ({ payload }: { payload: string }) => {
    try {
      const message = JSON.parse(payload) as { type?: string; t?: number }
      if (message.type === 'pong' && typeof message.t === 'number') {
        metrics.recordRoundTrip(Date.now() - message.t)
      }
    } catch {
      /* not ours */
    }
  })

  // Edits made while the socket is down are held in the Y.Doc and flushed on
  // reconnect. Counting them is how the UI shows the offline backlog.
  const updateHandler = (_update: Uint8Array, origin: unknown) => {
    if (origin === provider || origin === local) return
    if (socket.status !== WebSocketStatus.Connected) {
      offlineEdits += 1
      metrics.setOfflineEdits(offlineEdits)
    }
  }
  doc.on('update', updateHandler)

  const awareness = provider.awareness
  const awarenessHandler = () => {
    if (!awareness) return
    metrics.setPeers(Math.max(0, awareness.getStates().size - 1))

    awareness.getStates().forEach((rawState, clientId) => {
      if (clientId === awareness.clientID) return
      const state = rawState as { ping?: { t?: number } }
      const sentAt = state?.ping?.t
      if (typeof sentAt !== 'number') return
      if (lastPingByClient.get(clientId) === sentAt) return
      lastPingByClient.set(clientId, sentAt)

      const user = (rawState as { user?: { name?: string } }).user
      metrics.recordLatency(Date.now() - sentAt, user?.name ?? `client-${clientId}`)
    })
  }
  awareness?.on('change', awarenessHandler)

  const footprintTimer = setInterval(() => {
    const bytes = Y.encodeStateAsUpdate(doc).byteLength
    metrics.recordFootprint(bytes, charCount, countItems(doc))
  }, FOOTPRINT_INTERVAL_MS)

  const rttTimer = setInterval(() => {
    if (socket.status !== WebSocketStatus.Connected) return
    provider.sendStateless(JSON.stringify({ type: 'ping', t: Date.now() }))
  }, RTT_INTERVAL_MS)

  const session: CollabSession = {
    documentId,
    doc,
    provider,
    local,
    reportCharCount(count) {
      charCount = count
    },
    ping() {
      awareness?.setLocalStateField('ping', { t: Date.now() })
    },
    disconnect() {
      metrics.recordEvent('partition', 'Partition simulated: socket closed')
      socket.disconnect()
    },
    reconnect() {
      metrics.recordEvent('partition', 'Partition healed: reconnecting')
      void socket.connect()
    },
    forceSync() {
      metrics.recordEvent('info', 'Manual resync requested')
      provider.forceSync()
    },
    setLag(ms) {
      lagMs = Math.max(0, ms)
      metrics.setLag(lagMs)
      metrics.recordEvent(
        'info',
        lagMs > 0 ? `Injecting ${lagMs}ms of egress lag` : 'Lag injection cleared',
      )
      patchSocketSend()
    },
  }

  const teardown = () => {
    clearInterval(footprintTimer)
    clearInterval(rttTimer)
    awareness?.off('change', awarenessHandler)
    doc.off('update', updateHandler)
    provider.destroy()
    socket.destroy()
    local.destroy()
    doc.destroy()
  }

  return { session, refs: 0, teardown, graceTimer: null }
}

export function acquireSession(documentId: string, identity: Identity): CollabSession {
  let entry = cache.get(documentId)

  if (!entry) {
    entry = createSession(documentId, identity)
    cache.set(documentId, entry)
  }

  if (entry.graceTimer) {
    clearTimeout(entry.graceTimer)
    entry.graceTimer = null
  }

  entry.refs += 1
  return entry.session
}

export function releaseSession(documentId: string): void {
  const entry = cache.get(documentId)
  if (!entry) return

  entry.refs -= 1
  if (entry.refs > 0) return

  entry.graceTimer = setTimeout(() => {
    const current = cache.get(documentId)
    if (!current || current.refs > 0) return
    current.teardown()
    cache.delete(documentId)
  }, GRACE_MS)
}

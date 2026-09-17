import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import { authorize } from './access.js'
import { authenticate } from './auth.js'
import { config } from './config.js'
import { handleHttpRequest } from './http-routes.js'
import { metrics } from './metrics.js'
import { createStore } from './storage/index.js'

const store = createStore()

/** Last time a history snapshot was written, per document. */
const lastSnapshotAt = new Map<string, number>()

/**
 * The document title is authored inside the Y.Doc (so it merges like any other
 * edit) and denormalised into storage on write, so the explorer can list
 * documents by name without decoding every stored state.
 */
function readTitle(document: Y.Doc): string {
  const value = document.getMap('meta').get('title')
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : ''
}

const server = Server.configure({
  port: config.port,
  name: 'collab-editor-sync',

  // Coalesce persistence. `debounce` is the quiet period after the last edit;
  // `maxDebounce` guarantees a write even while someone types continuously.
  debounce: config.persistDebounceMs,
  maxDebounce: config.persistMaxDebounceMs,

  /**
   * Runs once per connection, before the client is allowed to join. Throwing
   * here closes the socket with an auth error, which the provider surfaces to
   * the UI. Whatever is returned becomes `context` on later hooks.
   */
  async onAuthenticate({ token, documentName }) {
    try {
      const user = await authenticate(token)
      // Claims ownership on first open, and rejects anyone the owner has not
      // invited. Throwing here closes the socket with a reason the provider
      // surfaces to the UI.
      const acl = await authorize(store, documentName, user)
      console.log(`[auth] ${user.email || user.name} -> ${documentName}`)
      return { user, acl }
    } catch (error) {
      metrics.authFailed()
      console.warn(`[auth] rejected for ${documentName}: ${(error as Error).message}`)
      throw error
    }
  },

  /**
   * Called once when the first client opens a document. The server holds one
   * Y.Doc per document in memory and every connected client talks to that
   * instance; subsequent joiners are served from memory, not storage.
   */
  async onLoadDocument({ documentName, document }) {
    const state = await store.load(documentName)
    if (state) {
      Y.applyUpdate(document, state)
      console.log(`[load] ${documentName} (${state.byteLength} bytes)`)
    } else {
      console.log(`[load] ${documentName} (new document)`)
    }
    metrics.documentOpened()
    return document
  },

  /**
   * Called on the debounce schedule above, and again when the last client
   * leaves. Note this is the only place the server writes: the sync protocol
   * itself is pure relay, so a storage outage degrades durability without
   * breaking live collaboration.
   */
  async onStoreDocument({ documentName, document }) {
    const state = Y.encodeStateAsUpdate(document)

    try {
      await store.store(documentName, state, readTitle(document))
    } catch (error) {
      // Do not rethrow: live collaboration does not depend on the write, and
      // killing the connection would turn a durability problem into an
      // availability one. It is recorded so /health stops claiming everything
      // is fine.
      const message = (error as Error).message
      metrics.storageFailed(message)
      console.error(`[store] FAILED for ${documentName}: ${message}`)
      return
    }

    metrics.documentWritten(state.byteLength)

    const now = Date.now()
    const previous = lastSnapshotAt.get(documentName) ?? 0
    if (now - previous >= config.snapshotIntervalMs) {
      lastSnapshotAt.set(documentName, now)
      await store.snapshot(documentName, state)
      metrics.snapshotWritten()
      console.log(`[snapshot] ${documentName} (${state.byteLength} bytes)`)
    }

    console.log(`[store] ${documentName} (${state.byteLength} bytes)`)
  },

  async onConnect() {
    metrics.connectionOpened()
  },

  /**
   * Echo endpoint for round-trip timing. The client stamps its own clock, the
   * server bounces the payload straight back, and the client subtracts — so the
   * number is a true RTT measured against one clock, with no skew to correct
   * for and no dependency on a second user being present.
   */
  async onStateless({ payload, connection }) {
    try {
      const message = JSON.parse(payload) as { type?: string }
      if (message.type === 'ping') {
        connection.sendStateless(JSON.stringify({ ...message, type: 'pong' }))
      }
    } catch {
      /* not ours; ignore */
    }
  },

  async onDisconnect({ documentName }) {
    metrics.connectionClosed()
    console.log(`[disconnect] ${documentName}`)
  },

  async afterUnloadDocument({ documentName }) {
    metrics.documentClosed()
    lastSnapshotAt.delete(documentName)
  },

  /**
   * Plain HTTP on the same port. Hocuspocus expects the promise to reject once
   * the response has been written, which is how it knows not to continue.
   */
  async onRequest({ request, response }) {
    const handled = await handleHttpRequest(request, response, store)
    if (handled) {
      // eslint-disable-next-line prefer-promise-reject-errors
      return Promise.reject()
    }
  },
})

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[${signal}] flushing documents and closing storage...`)
  try {
    await server.destroy()
    await store.close()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

server.listen().then(() => {
  console.log('----------------------------------------------------------')
  console.log(` collab-editor sync server`)
  console.log(` ws://127.0.0.1:${config.port}`)
  console.log(` storage : ${store.driver}`)
  console.log(` auth    : ${config.authMode}${config.authMode === 'supabase' ? ' (Google sign-in required)' : ' (no sign-in)'}`)
  console.log(` debounce: ${config.persistDebounceMs}ms (max ${config.persistMaxDebounceMs}ms)`)
  console.log('----------------------------------------------------------')
})

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AccessDenied,
  addMember,
  canAccess,
  filterAccessible,
  isOwner,
  removeMember,
} from './access.js'
import { authenticate, authRequired, type AuthedUser } from './auth.js'
import { config } from './config.js'
import { metrics } from './metrics.js'
import type { DocStore } from './storage/index.js'

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

/**
 * Identify the caller of a REST request.
 *
 * These endpoints are not decoration: they list documents and change who can
 * open them. Leaving them unauthenticated while the WebSocket is guarded would
 * simply move the hole, so they run through exactly the same verification.
 */
async function identify(request: IncomingMessage): Promise<AuthedUser | null> {
  const header = request.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) return null
  try {
    return await authenticate(token)
  } catch {
    return null
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    // A body this small cannot be legitimate for these endpoints; refusing
    // early avoids buffering whatever an unauthenticated caller sends.
    if (size > 16 * 1024) throw new Error('Request body too large.')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

export async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: DocStore,
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const route = url.pathname.replace(/\/+$/, '') || '/'
  const method = request.method ?? 'GET'

  if (method === 'OPTIONS') {
    send(response, 204, {})
    return true
  }

  if (route === '/health') {
    const stats = metrics.snapshot()
    const storageHealthy = stats.storageFailures === 0
    // Deliberately still 200 when storage is failing. This is the endpoint the
    // host's health check polls, and a 503 would restart the instance in a
    // loop -- turning a durability problem into an outage, when the relay is
    // in fact serving every connected client perfectly well. The degraded
    // status and the failure count say what is wrong without pulling the pin.
    send(response, 200, {
      status: storageHealthy ? 'ok' : 'degraded',
      driver: store.driver,
      authMode: config.authMode,
      authRequired: authRequired(),
      storageHealthy,
      storageFailures: stats.storageFailures,
      lastStorageError: stats.lastStorageError,
    })
    return true
  }

  if (route === '/api/stats') {
    send(response, 200, metrics.snapshot())
    return true
  }

  if (route === '/api/documents') {
    const user = await identify(request)
    if (authRequired() && !user) {
      send(response, 401, { error: 'Sign in to list documents.' })
      return true
    }
    try {
      const documents = await filterAccessible(store, await store.list(), user)
      send(response, 200, { documents })
    } catch (error) {
      send(response, 500, { error: (error as Error).message })
    }
    return true
  }

  // /api/documents/:name/snapshots[/:id]
  const snapshotMatch = route.match(/^\/api\/documents\/([^/]+)\/snapshots(?:\/([^/]+))?$/)
  if (snapshotMatch) {
    const name = decodeURIComponent(snapshotMatch[1])
    const id = snapshotMatch[2] ? decodeURIComponent(snapshotMatch[2]) : null
    const user = await identify(request)

    try {
      if (authRequired()) {
        if (!user) {
          send(response, 401, { error: 'Sign in to read version history.' })
          return true
        }
        const acl = await store.getAcl(name)
        if (!acl || !canAccess(acl, user)) {
          send(response, 403, { error: 'You do not have access to this document.' })
          return true
        }
      }

      if (!id) {
        send(response, 200, { snapshots: await store.listSnapshots(name) })
        return true
      }

      const state = await store.loadSnapshot(name, id)
      if (!state) {
        send(response, 404, { error: 'Snapshot not found.' })
        return true
      }
      // Base64 keeps this a plain JSON endpoint; the client decodes it into a
      // throwaway Y.Doc to read the historical content.
      send(response, 200, { id, state: Buffer.from(state).toString('base64') })
    } catch (error) {
      send(response, 400, { error: (error as Error).message })
    }
    return true
  }

  // /api/documents/:name/access
  const accessMatch = route.match(/^\/api\/documents\/([^/]+)\/access$/)
  if (accessMatch) {
    const name = decodeURIComponent(accessMatch[1])
    const user = await identify(request)

    if (!authRequired()) {
      send(response, 200, { acl: null, authRequired: false })
      return true
    }
    if (!user) {
      send(response, 401, { error: 'Sign in to manage access.' })
      return true
    }

    try {
      if (method === 'GET') {
        const acl = await store.getAcl(name)
        if (!acl || !canAccess(acl, user)) {
          send(response, 403, { error: 'You do not have access to this document.' })
          return true
        }
        send(response, 200, { acl, isOwner: isOwner(acl, user), authRequired: true })
        return true
      }

      if (method === 'POST' || method === 'DELETE') {
        const body = await readJsonBody(request)
        const email = typeof body.email === 'string' ? body.email : ''
        const acl =
          method === 'POST'
            ? await addMember(store, name, user, email)
            : await removeMember(store, name, user, email)
        send(response, 200, { acl, isOwner: isOwner(acl, user), authRequired: true })
        return true
      }

      send(response, 405, { error: 'Method not allowed.' })
    } catch (error) {
      const status = error instanceof AccessDenied ? 403 : 400
      send(response, status, { error: (error as Error).message })
    }
    return true
  }

  return false
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AccessDenied,
  addMember,
  authorize,
  deleteDocument,
  filterAccessible,
  isOwner,
  removeMember,
  type Role,
  setLinkAccess,
  visibleAcl,
} from './access.js'
import { authenticate, authRequired, type AuthedUser } from './auth.js'
import { config } from './config.js'
import { metrics } from './metrics.js'
import type { DocStore, DocumentAcl } from './storage/index.js'

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
 * One shape for every access response, so the client never has to reconcile
 * three slightly different payloads from the three endpoints that return one.
 */
function sendAccess(
  response: ServerResponse,
  acl: DocumentAcl | null,
  role: Role,
  user: AuthedUser,
): void {
  send(response, 200, {
    // Redacted for anyone who arrived through the link: the owner's address
    // and the collaborator list are not part of what a share link shares.
    acl: visibleAcl(acl, user),
    role,
    isOwner: acl ? isOwner(acl, user) : role === 'owner',
    isGuest: user.isGuest,
    linkAccess: acl?.linkAccess ?? 'edit',
    authRequired: authRequired(),
  })
}

/**
 * Map a thrown error to a status.
 *
 * A refusal aimed at a guest is 401, not 403: signing in genuinely might
 * change the answer, and 403 would tell the browser to stop trying. For a
 * signed-in caller the same refusal is final, so it stays 403.
 */
function statusFor(error: unknown, user: AuthedUser | null): number {
  if (!(error instanceof AccessDenied)) return 400
  return user?.isGuest ? 401 : 403
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
  try {
    // A missing header is not an error any more: authenticate() turns it into
    // a guest, and whether a guest may proceed is a per-document question that
    // only the link level can answer. A header that is present but invalid
    // still fails, and still yields null.
    return await authenticate(token)
  } catch {
    return null
  }
}

/** A signed-in caller, or null for a guest or a bad token. */
function signedIn(user: AuthedUser | null): AuthedUser | null {
  return user && !user.isGuest ? user : null
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
    const user = signedIn(await identify(request))
    if (authRequired() && !user) {
      // Deliberately an empty list rather than a 401. A guest following a
      // share link has no workspace to show, and painting an auth error across
      // the explorer of someone who is legitimately reading one document is
      // noise, not information.
      send(response, 200, { documents: [] })
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

  // /api/documents/:name  (DELETE only; the listing above handles GET)
  const documentMatch = route.match(/^\/api\/documents\/([^/]+)$/)
  if (documentMatch && method === 'DELETE') {
    const name = decodeURIComponent(documentMatch[1])
    const user = await identify(request)

    if (authRequired() && !user) {
      send(response, 401, { error: 'Your session has expired. Sign in again.' })
      return true
    }

    try {
      await deleteDocument(store, name, user as AuthedUser)
      send(response, 200, { deleted: name })
    } catch (error) {
      send(response, statusFor(error, user), { error: (error as Error).message })
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
          send(response, 401, { error: 'Your session has expired. Sign in again.' })
          return true
        }
        // authorize(), not a raw read: opening Version History is a perfectly
        // normal way to be the first person to touch a document, and should
        // claim ownership rather than 403 just because no WebSocket has
        // connected yet.
        await authorize(store, name, user)
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
      send(response, statusFor(error, user), { error: (error as Error).message })
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
      send(response, 401, { error: 'Your session has expired. Sign in again.' })
      return true
    }

    try {
      if (method === 'GET') {
        // authorize(), not a raw read: opening the Share dialog is often the
        // first thing that touches a brand-new document, and should claim
        // ownership rather than 403 just because the editor's WebSocket
        // hasn't connected (or finished connecting) yet.
        const { acl, role } = await authorize(store, name, user)
        sendAccess(response, acl, role, user)
        return true
      }

      if (method === 'POST' || method === 'DELETE') {
        const body = await readJsonBody(request)
        const email = typeof body.email === 'string' ? body.email : ''
        const acl =
          method === 'POST'
            ? await addMember(store, name, user, email)
            : await removeMember(store, name, user, email)
        sendAccess(response, acl, 'owner', user)
        return true
      }

      send(response, 405, { error: 'Method not allowed.' })
    } catch (error) {
      send(response, statusFor(error, user), { error: (error as Error).message })
    }
    return true
  }

  // /api/documents/:name/access/link
  const linkMatch = route.match(/^\/api\/documents\/([^/]+)\/access\/link$/)
  if (linkMatch) {
    const name = decodeURIComponent(linkMatch[1])
    const user = await identify(request)

    if (!authRequired()) {
      // Without sign-in every document is already open to anyone holding the
      // URL, so there is no level to choose between. Saying so plainly beats a
      // control that silently does nothing.
      send(response, 409, {
        error: 'Link sharing needs AUTH_MODE=supabase. Without it every link is already open.',
      })
      return true
    }
    if (!user) {
      send(response, 401, { error: 'Your session has expired. Sign in again.' })
      return true
    }
    if (method !== 'POST') {
      send(response, 405, { error: 'Method not allowed.' })
      return true
    }

    try {
      const body = await readJsonBody(request)
      const acl = await setLinkAccess(store, name, user, body.linkAccess)
      sendAccess(response, acl, 'owner', user)
    } catch (error) {
      send(response, statusFor(error, user), { error: (error as Error).message })
    }
    return true
  }

  return false
}

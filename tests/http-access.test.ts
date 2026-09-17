import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The REST surface, exercised over real HTTP.
 *
 * The access module has its own unit tests; this covers the layer above it —
 * routing, status codes, request bodies and auth headers — which is exactly
 * where the Share dialog bug lived. `GET /access` returning 403 on a document
 * nobody had claimed yet was invisible to a test that called authorize()
 * directly, because the module was never the broken part.
 *
 * HS256 is used for the tokens because a shared secret can be signed here;
 * production projects use the asymmetric JWKS path, but auth.ts picks the key
 * material per token from the header, so both reach the same code below.
 */
const SECRET = 'test-secret-that-is-long-enough-for-hs256'

process.env.AUTH_MODE = 'supabase'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_JWT_SECRET = SECRET
process.env.STORAGE_DRIVER = 'file'

let server: Server
let base: string
let dir: string

async function tokenFor(id: string, email: string): Promise<string> {
  return new SignJWT({ email, user_metadata: { full_name: email } })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

interface Called {
  status: number
  body: Record<string, unknown>
  headers: Headers
}

async function call(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
): Promise<Called> {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
    headers: response.headers,
  }
}

let ownerToken: string
let inviteeToken: string
let strangerToken: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'collab-http-'))
  process.env.DATA_DIR = dir

  const { handleHttpRequest } = await import('../apps/server/src/http-routes.js')
  const { createStore } = await import('../apps/server/src/storage/index.js')
  const store = createStore()

  server = createServer((request, response) => {
    void handleHttpRequest(request, response, store).then((handled) => {
      if (!handled) {
        response.writeHead(404)
        response.end()
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

  ownerToken = await tokenFor('http-owner', 'owner@example.com')
  inviteeToken = await tokenFor('http-invitee', 'invitee@example.com')
  strangerToken = await tokenFor('http-stranger', 'stranger@example.com')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
})

describe('access endpoints over HTTP', () => {
  it('refuses an unauthenticated caller with 401, not 403', async () => {
    // 403 would imply the document exists and this caller was judged; 401 is
    // the truthful "you have not said who you are".
    const result = await call('GET', '/api/documents/doc-http/access')
    expect(result.status).toBe(401)
    expect(result.headers.get('access-control-allow-origin')).toBeTruthy()
  })

  /**
   * The exact regression. Opening the Share dialog on a brand-new document is
   * often the first authenticated request that document ever sees — before the
   * editor's WebSocket has finished its handshake. It must claim ownership,
   * not 403.
   */
  it('claims ownership on the very first GET of a document nobody has opened', async () => {
    const result = await call('GET', '/api/documents/doc-http/access', ownerToken)
    expect(result.status).toBe(200)
    expect(result.body.isOwner).toBe(true)
    expect(result.body.role).toBe('owner')
    expect(result.body.linkAccess).toBe('restricted')
  })

  it('invites and revokes a member', async () => {
    const invited = await call('POST', '/api/documents/doc-http/access', ownerToken, {
      email: 'Invitee@Example.com',
    })
    expect(invited.status).toBe(200)
    expect((invited.body.acl as { members: { email: string }[] }).members).toEqual([
      expect.objectContaining({ email: 'invitee@example.com' }),
    ])

    const seen = await call('GET', '/api/documents/doc-http/access', inviteeToken)
    expect(seen.status).toBe(200)
    expect(seen.body.role).toBe('editor')
    expect(seen.body.isOwner).toBe(false)

    const revoked = await call('DELETE', '/api/documents/doc-http/access', ownerToken, {
      email: 'invitee@example.com',
    })
    expect(revoked.status).toBe(200)
    expect((revoked.body.acl as { members: unknown[] }).members).toEqual([])

    expect((await call('GET', '/api/documents/doc-http/access', inviteeToken)).status).toBe(403)
  })

  it('rejects a malformed invite with 400, keeping 403 for access denial', async () => {
    const bad = await call('POST', '/api/documents/doc-http/access', ownerToken, {
      email: 'not-an-email',
    })
    expect(bad.status).toBe(400)

    const denied = await call('POST', '/api/documents/doc-http/access', strangerToken, {
      email: 'someone@example.com',
    })
    expect(denied.status).toBe(403)
  })

  it('opens and closes the link, and reports the level back', async () => {
    expect((await call('GET', '/api/documents/doc-http/access', strangerToken)).status).toBe(403)

    const opened = await call('POST', '/api/documents/doc-http/access/link', ownerToken, {
      linkAccess: 'view',
    })
    expect(opened.status).toBe(200)
    expect(opened.body.linkAccess).toBe('view')

    const viewer = await call('GET', '/api/documents/doc-http/access', strangerToken)
    expect(viewer.status).toBe(200)
    expect(viewer.body.role).toBe('viewer')

    const editable = await call('POST', '/api/documents/doc-http/access/link', ownerToken, {
      linkAccess: 'edit',
    })
    expect(editable.body.linkAccess).toBe('edit')
    expect((await call('GET', '/api/documents/doc-http/access', strangerToken)).body.role).toBe(
      'editor',
    )

    await call('POST', '/api/documents/doc-http/access/link', ownerToken, {
      linkAccess: 'restricted',
    })
    expect((await call('GET', '/api/documents/doc-http/access', strangerToken)).status).toBe(403)
  })

  it('refuses a link change from a non-owner, and an unknown level from anyone', async () => {
    await call('POST', '/api/documents/doc-http/access', ownerToken, {
      email: 'invitee@example.com',
    })

    const byMember = await call('POST', '/api/documents/doc-http/access/link', inviteeToken, {
      linkAccess: 'edit',
    })
    expect(byMember.status).toBe(403)

    const nonsense = await call('POST', '/api/documents/doc-http/access/link', ownerToken, {
      linkAccess: 'public',
    })
    expect(nonsense.status).toBe(400)

    // Nothing moved.
    const acl = await call('GET', '/api/documents/doc-http/access', ownerToken)
    expect(acl.body.linkAccess).toBe('restricted')
  })

  it('does not put a link-shared document in a stranger document list', async () => {
    await call('POST', '/api/documents/doc-http/access/link', ownerToken, { linkAccess: 'edit' })

    const mine = await call('GET', '/api/documents', ownerToken)
    expect(mine.status).toBe(200)

    const theirs = await call('GET', '/api/documents', strangerToken)
    const names = (theirs.body.documents as { name: string }[]).map((entry) => entry.name)
    expect(names).not.toContain('doc-http')
  })

  it('answers preflight so a browser on another origin can reach any of this', async () => {
    const result = await call('OPTIONS', '/api/documents/doc-http/access')
    expect(result.status).toBe(204)
    expect(result.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  it('reports health without requiring a token', async () => {
    const result = await call('GET', '/health')
    expect(result.status).toBe(200)
    expect(result.body.authRequired).toBe(true)
    expect(result.body.driver).toBe('file')
  })
})

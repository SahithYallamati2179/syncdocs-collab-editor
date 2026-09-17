import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'
import { config } from './config.js'

export interface AuthedUser {
  id: string
  name: string
  email: string
  picture: string
  /**
   * True when nobody signed in. A guest has no identity to check against an
   * ACL, so what they may do depends entirely on the document's link level.
   *
   * The id is deliberately left empty for a guest. Ownership is an `ownerId`
   * comparison, and an empty id that can never match a stored one makes
   * "a guest accidentally owns something" impossible by construction rather
   * than by remembering to check.
   */
  isGuest: boolean
}

/**
 * What a signed-out browser presents instead of an access token.
 *
 * Hocuspocus will not open a connection at all when an onAuthenticate hook is
 * configured and no token arrives, so a guest cannot simply send nothing. The
 * sentinel carries a display name so an anonymous visitor still gets a cursor
 * label; that name is decoration and is never treated as an identity.
 */
export const GUEST_TOKEN = 'guest'
const GUEST_PREFIX = 'guest:'

function guestUser(token: string): AuthedUser {
  let name = 'Guest'
  if (token.startsWith(GUEST_PREFIX)) {
    try {
      const parsed = JSON.parse(token.slice(GUEST_PREFIX.length)) as { name?: unknown }
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        name = parsed.name.trim().slice(0, 64)
      }
    } catch {
      /* the label is optional; a malformed one is not worth refusing over */
    }
  }
  return { id: '', name, email: '', picture: '', isGuest: true }
}

function isGuestToken(token: string | undefined): boolean {
  return !token || token === GUEST_TOKEN || token.startsWith(GUEST_PREFIX)
}

/**
 * Resolve the connecting client to a user.
 *
 * AUTH_MODE=dev accepts the identity blob the browser generated for itself.
 * That is obviously not authentication -- it exists so the project runs with no
 * external service configured. AUTH_MODE=supabase is the real path: the browser
 * passes its Supabase access token (issued after Google sign-in) and the
 * signature is verified here, on the server, before the socket is allowed to
 * join a document.
 */
export async function authenticate(token: string | undefined): Promise<AuthedUser> {
  if (config.authMode === 'supabase') {
    // Absent or sentinel means "signed out", which is a legitimate state now
    // that a link can be opened without an account. A token that is *present
    // but invalid* still throws: silently downgrading a bad token to a guest
    // would turn every expired session into a confusing loss of access rather
    // than an auth error.
    if (isGuestToken(token)) return guestUser(token ?? '')
    return verifySupabaseJwt(token)
  }
  return acceptDevIdentity(token)
}

function acceptDevIdentity(token: string | undefined): AuthedUser {
  if (!token) throw new Error('Missing identity token.')
  try {
    const parsed = JSON.parse(token) as Partial<AuthedUser>
    if (!parsed.id) throw new Error('Identity token has no id.')
    return {
      id: String(parsed.id).slice(0, 64),
      name: String(parsed.name ?? 'Anonymous').slice(0, 64),
      email: '',
      picture: '',
      isGuest: false,
    }
  } catch {
    throw new Error('Malformed identity token.')
  }
}

/**
 * Lazily built so a misconfigured URL fails on first use with a clear message
 * rather than at import time, and so the key set is cached and rotated by jose
 * rather than fetched per connection.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!config.supabaseUrl) {
    throw new Error(
      'AUTH_MODE=supabase needs SUPABASE_URL (for asymmetric tokens) or SUPABASE_JWT_SECRET (legacy HS256).',
    )
  }
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`))
  }
  return jwks
}

async function verifySupabaseJwt(token: string | undefined): Promise<AuthedUser> {
  if (!token) throw new Error('Missing access token. Sign in to open this document.')

  let payload: JWTPayload
  try {
    // The algorithm in the header decides which key material applies: legacy
    // projects sign with the shared secret, current ones with a published key.
    const header = decodeProtectedHeader(token)

    if (header.alg === 'HS256') {
      if (!config.supabaseJwtSecret) {
        throw new Error('Token is HS256 but SUPABASE_JWT_SECRET is not set.')
      }
      const secret = new TextEncoder().encode(config.supabaseJwtSecret)
      ;({ payload } = await jwtVerify(token, secret))
    } else {
      ;({ payload } = await jwtVerify(token, getJwks()))
    }
  } catch (error) {
    throw new Error(`Invalid access token: ${(error as Error).message}`)
  }

  if (!payload.sub) throw new Error('Access token has no subject.')

  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')

  const email = text(payload.email) || text(metadata.email)
  const name =
    text(metadata.full_name) || text(metadata.name) || email.split('@')[0] || 'Anonymous'

  return {
    id: payload.sub,
    name: name.slice(0, 64),
    email: email.toLowerCase(),
    picture: text(metadata.avatar_url) || text(metadata.picture),
    isGuest: false,
  }
}

/** True when the deployment requires a verified identity. */
export function authRequired(): boolean {
  return config.authMode === 'supabase'
}

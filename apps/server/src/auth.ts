import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'
import { config } from './config.js'

export interface AuthedUser {
  id: string
  name: string
  email: string
  picture: string
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
  }
}

/** True when the deployment requires a verified identity. */
export function authRequired(): boolean {
  return config.authMode === 'supabase'
}

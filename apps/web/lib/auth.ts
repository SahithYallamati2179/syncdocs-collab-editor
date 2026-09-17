'use client'

import type { Session, User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { colorForUser } from './colors'
import type { Identity } from './identity'
import { authEnabled, CALLBACK_PATH, getSupabase, RETURN_TO_KEY } from './supabase'

export interface AuthState {
  /** Undefined while the session is still being restored from storage. */
  status: 'loading' | 'signed-in' | 'signed-out' | 'disabled'
  user: User | null
  identity: Identity | null
}

export function identityFromUser(user: User): Identity {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  const email = (user.email ?? text(metadata.email)).toLowerCase()
  const name = text(metadata.full_name) || text(metadata.name) || email.split('@')[0] || 'Signed in'

  return {
    id: user.id,
    name,
    email,
    picture: text(metadata.avatar_url) || text(metadata.picture),
    // Colour still comes from a hash of the stable id, so it survives sign-out
    // and sign-in and never depends on who else is in the room.
    color: colorForUser(user.id),
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    status: authEnabled ? 'loading' : 'disabled',
    user: null,
    identity: null,
  })

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    let cancelled = false

    const apply = (session: Session | null) => {
      if (cancelled) return
      setState(
        session?.user
          ? { status: 'signed-in', user: session.user, identity: identityFromUser(session.user) }
          : { status: 'signed-out', user: null, identity: null },
      )
    }

    supabase.auth.getSession().then(({ data }) => apply(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return state
}

export async function signInWithGoogle(returnTo?: string): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'Authentication is not configured.' }

  try {
    // Stashed rather than encoded in the redirect, so only one callback URL has
    // to be allow-listed in the Supabase dashboard.
    window.sessionStorage.setItem(RETURN_TO_KEY, returnTo ?? window.location.pathname)
  } catch {
    /* non-fatal */
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${CALLBACK_PATH}`,
      queryParams: { prompt: 'select_account' },
    },
  })

  return { error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut()
}

/**
 * The bearer token for the sync server and the REST endpoints.
 *
 * Reads through `getSession`, which refreshes an expired access token rather
 * than handing back a stale one. That matters because the WebSocket provider
 * calls this again on every reconnect, and a partition can easily outlast the
 * one-hour token lifetime.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** Authorization header for fetch, or an empty object when auth is off. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

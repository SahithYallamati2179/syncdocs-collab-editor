'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/**
 * Google sign-in is opt-in.
 *
 * With no Supabase project configured the app runs exactly as before: a random
 * per-browser identity and no access control. Configuring the two public
 * environment variables turns authentication on across the whole app. Keeping
 * that switch here means every other module can just ask `authEnabled`.
 */
export const authEnabled = Boolean(URL && ANON_KEY)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!authEnabled) return null
  if (!client) {
    client = createClient(URL, ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The OAuth redirect comes back with a code in the URL; supabase-js
        // exchanges it for a session on load.
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  }
  return client
}

/** Where the OAuth provider sends the browser back to. */
export const CALLBACK_PATH = '/auth/callback'
export const RETURN_TO_KEY = 'collab-editor:return-to'

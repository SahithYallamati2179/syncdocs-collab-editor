'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { newDocumentId, readRecents } from '@/lib/documents'
import { RETURN_TO_KEY } from '@/lib/supabase'

/**
 * Where Google sends the browser back to.
 *
 * supabase-js exchanges the code in the URL for a session as soon as it loads
 * (detectSessionInUrl), so this page only has to wait for that to land and then
 * put the person back where they started. Using one fixed callback path keeps
 * the Supabase redirect allow-list to a single entry.
 */
export default function AuthCallbackPage() {
  const router = useRouter()
  const auth = useAuth()
  const [tooSlow, setTooSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTooSlow(true), 8000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (auth.status !== 'signed-in') return

    let target = ''
    try {
      target = window.sessionStorage.getItem(RETURN_TO_KEY) ?? ''
      window.sessionStorage.removeItem(RETURN_TO_KEY)
    } catch {
      /* non-fatal */
    }

    if (!target || target.startsWith('/auth')) {
      const [recent] = readRecents()
      target = `/doc/${recent ?? newDocumentId()}`
    }

    router.replace(target)
  }, [auth.status, router])

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">
          {auth.status === 'signed-out' && tooSlow ? 'Sign-in did not complete' : 'Signing you in…'}
        </h1>
        {auth.status === 'signed-out' && tooSlow ? (
          <>
            <p className="auth-card__sub">
              Google sent you back without a session. This usually means the callback URL is not
              in the Supabase redirect allow-list.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => router.replace('/')}>
              Try again
            </button>
          </>
        ) : (
          <p className="auth-card__sub">Finishing up with Google.</p>
        )}
      </div>
    </main>
  )
}

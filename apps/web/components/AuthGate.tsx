'use client'

import { useState } from 'react'
import { signInWithGoogle, useAuth } from '@/lib/auth'
import { Icon } from '@/lib/icons'

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46"
      />
      <path
        fill="#FBBC05"
        d="M11.7 28.2a13 13 0 0 1 0-8.4v-5.7H4.3a22 22 0 0 0 0 19.8z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 2.9 30 1 24 1 15.4 1 7.9 5.9 4.3 13.1l7.4 5.7c1.7-5.2 6.6-9.3 12.3-9.3"
      />
    </svg>
  )
}

/**
 * Shown when the deployment requires sign-in and nobody is signed in.
 *
 * This is deliberately not a route guard on a separate page: the app is a
 * single shell, and bouncing to /signin would lose the document the person was
 * trying to open. Rendering in place means the link they followed still works
 * once they are back.
 */
export function SignInScreen({ returnTo }: { returnTo?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    const { error: cause } = await signInWithGoogle(returnTo)
    if (cause) {
      setError(cause)
      setBusy(false)
    }
    // On success the browser navigates away to Google, so nothing to reset.
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <span className="logo-mark" style={{ width: 40, height: 40, borderRadius: 11 }}>
          <Icon name="file" size={20} />
        </span>
        <h1 className="auth-card__title">SyncDocs</h1>
        <p className="auth-card__sub">
          Real-time collaborative documents. Sign in to open and share documents with your
          Google account.
        </p>

        <button type="button" className="btn google-btn" onClick={start} disabled={busy}>
          <GoogleMark />
          {busy ? 'Redirecting to Google…' : 'Continue with Google'}
        </button>

        {error && (
          <div className="notice" style={{ marginTop: 14, borderColor: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <p className="auth-card__fine">
          Only documents you own or have been invited to will be listed.
        </p>
      </div>
    </main>
  )
}

/**
 * Blocks children until a session exists, when auth is enabled.
 *
 * `allowGuest` is set on the document route, because a document whose link
 * level is view or edit is meant to open without an account -- putting a
 * sign-in wall in front of it would defeat the entire point of sharing the
 * link. The route is not left unguarded: the server still decides, and a
 * signed-out visitor to a restricted document gets the access-denied screen
 * with a sign-in button on it.
 *
 * Every other route still requires a session. A guest has no workspace to
 * list and cannot claim a new document, so there is nothing for them there.
 */
export function AuthGate({
  children,
  allowGuest = false,
}: {
  children: React.ReactNode
  allowGuest?: boolean
}) {
  const auth = useAuth()

  if (auth.status === 'disabled') return <>{children}</>

  if (auth.status === 'loading') {
    return (
      <main className="auth-screen">
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Checking your session…</span>
      </main>
    )
  }

  if (auth.status === 'signed-out' && !allowGuest) return <SignInScreen />

  return <>{children}</>
}

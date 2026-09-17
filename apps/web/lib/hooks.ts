'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAuth } from './auth'
import { acquireSession, releaseSession, type CollabSession } from './collab'
import { getIdentity, type Identity } from './identity'
import { metrics, type MetricsSnapshot } from './metrics'
import { authEnabled } from './supabase'

const EMPTY_IDENTITY: Identity = {
  id: '',
  name: '',
  color: 'var(--primary)',
  email: '',
  picture: '',
}

/**
 * Who you are.
 *
 * With Google sign-in configured this is the verified session user, and the
 * same id the sync server sees in the token. Without it, a random per-browser
 * identity so the project still runs with no setup. Either way it resolves in
 * an effect, because neither source is readable during SSR and a mismatch
 * would break hydration.
 */
export function useIdentity(): Identity {
  const auth = useAuth()
  const [local, setLocal] = useState<Identity | null>(null)

  useEffect(() => {
    // Two cases need the local identity now. Auth switched off entirely, and
    // auth on but signed out -- a guest following a share link still has to
    // have a name and a colour, or their cursor is unlabelled and, worse,
    // useCollabSession refuses to open a session for an identity with no id
    // and the document never loads at all.
    //
    // This is a display identity, not a claim. The server treats a guest as
    // anonymous whatever name the client sends.
    if (!authEnabled || auth.status === 'signed-out') setLocal(getIdentity())
  }, [auth.status])

  return useMemo(() => {
    // While the session is still being restored, `local` is null and this
    // stays empty on purpose: opening a socket under a guest identity and
    // then swapping it for the real one a moment later would reconnect every
    // signed-in user once per page load.
    if (authEnabled) return auth.identity ?? local ?? EMPTY_IDENTITY
    return local ?? EMPTY_IDENTITY
  }, [auth.identity, local])
}

export function useCollabSession(documentId: string | null): CollabSession | null {
  const identity = useIdentity()
  const [session, setSession] = useState<CollabSession | null>(null)

  useEffect(() => {
    if (!documentId || !identity.id) return

    // A refusal belongs to the document that was refused, so opening a
    // different one starts from a clean slate rather than inheriting the error.
    metrics.setAccessError(null)
    const active = acquireSession(documentId, identity)
    setSession(active)

    return () => {
      setSession(null)
      releaseSession(documentId)
    }
  }, [documentId, identity.id, identity])

  return session
}

export function useMetrics(): MetricsSnapshot {
  return useSyncExternalStore(metrics.subscribe, metrics.getSnapshot, metrics.getServerSnapshot)
}

export interface PresencePeer {
  clientId: number
  name: string
  color: string
  isSelf: boolean
}

export function usePresence(session: CollabSession | null): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([])

  useEffect(() => {
    const awareness = session?.provider.awareness
    if (!awareness) return

    const read = () => {
      const next: PresencePeer[] = []
      awareness.getStates().forEach((rawState, clientId) => {
        const user = (rawState as { user?: { name?: string; color?: string } }).user
        if (!user?.name) return
        next.push({
          clientId,
          name: user.name,
          color: user.color ?? '#898781',
          isSelf: clientId === awareness.clientID,
        })
      })
      next.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name))
      setPeers(next)
    }

    read()
    awareness.on('change', read)
    return () => awareness.off('change', read)
  }, [session])

  return peers
}

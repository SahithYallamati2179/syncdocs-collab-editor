'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAuth } from './auth'
import { acquireSession, AWAY_AFTER_MS, releaseSession, type CollabSession } from './collab'
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

/**
 * `online`  - connected, and interacted recently.
 * `away`    - connected, but idle past AWAY_AFTER_MS.
 * `offline` - not connected at all. Only ever reported for people we know
 *             about from the access list, since someone who is not connected
 *             leaves no trace in awareness to report on.
 */
export type PresenceStatus = 'online' | 'away' | 'offline'

export interface PresencePeer {
  clientId: number
  name: string
  color: string
  isSelf: boolean
  status: PresenceStatus
  /** Present for a connected peer; used to render "active 3m ago". */
  lastActiveAt: number | null
  /** Set for an invited member who is not currently connected. */
  email?: string
}

export function usePresence(session: CollabSession | null): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([])

  useEffect(() => {
    const awareness = session?.provider.awareness
    if (!awareness) return

    const read = () => {
      const now = Date.now()
      const next: PresencePeer[] = []
      awareness.getStates().forEach((rawState, clientId) => {
        const state = rawState as {
          user?: { name?: string; color?: string }
          activity?: { at?: number }
        }
        const user = state.user
        if (!user?.name) return

        const lastActiveAt = typeof state.activity?.at === 'number' ? state.activity.at : null
        // A peer whose build predates the activity stamp has no `activity`
        // field at all. Treating that as online is the right default: they are
        // demonstrably connected, and showing them as permanently away would
        // be worse than not knowing.
        const idle = lastActiveAt !== null && now - lastActiveAt > AWAY_AFTER_MS

        next.push({
          clientId,
          name: user.name,
          color: user.color ?? '#898781',
          isSelf: clientId === awareness.clientID,
          status: idle ? 'away' : 'online',
          lastActiveAt,
        })
      })
      next.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name))
      setPeers(next)
    }

    read()
    awareness.on('change', read)

    // Awareness only fires on change, and going idle is the absence of one, so
    // the transition to "away" needs its own tick or nobody ever looks idle.
    const timer = setInterval(read, 10_000)

    return () => {
      awareness.off('change', read)
      clearInterval(timer)
    }
  }, [session])

  return peers
}

/**
 * The people who have access but are not connected right now.
 *
 * Kept separate from `usePresence` because it answers a different question
 * from a different source: awareness knows who is here, and the ACL knows who
 * could be. Merging them is the caller's job, and only the Share dialog and
 * the presence popover actually want both.
 */
export function offlineMembers(
  connected: PresencePeer[],
  members: { email: string }[],
  ownerEmail: string,
  selfEmail: string,
): PresencePeer[] {
  const here = new Set(connected.map((peer) => peer.name.toLowerCase()))
  const everyone = [ownerEmail, ...members.map((member) => member.email)].filter(Boolean)

  return everyone
    .filter((email) => {
      const normalised = email.toLowerCase()
      if (normalised === selfEmail.toLowerCase()) return false
      // Names in awareness are display names, so this match is best-effort:
      // it suppresses the obvious duplicate without claiming to be exact.
      return !here.has(normalised) && !here.has(normalised.split('@')[0])
    })
    .map((email, index) => ({
      clientId: -1 - index,
      name: email,
      color: 'var(--ink-3)',
      isSelf: false,
      status: 'offline' as const,
      lastActiveAt: null,
      email,
    }))
}

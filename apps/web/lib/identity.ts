'use client'

import { colorForUser } from './colors'

export interface Identity {
  id: string
  name: string
  color: string
  /** Empty in dev mode; the Google account address once signed in. */
  email: string
  /** Empty in dev mode; the Google profile picture once signed in. */
  picture: string
}

const STORAGE_KEY = 'collab-editor:identity'

const ADJECTIVES = ['Swift', 'Quiet', 'Bright', 'Calm', 'Keen', 'Bold', 'Warm', 'Clever']
const ANIMALS = ['Otter', 'Falcon', 'Heron', 'Lynx', 'Marten', 'Ibis', 'Tapir', 'Vireo']

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  return Math.random().toString(36).slice(2, 18)
}

function randomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  return `${adjective} ${animal}`
}

/**
 * The dev-mode identity: random, per browser profile, and not authentication.
 * Used only when no Supabase project is configured, so the project still runs
 * with zero setup. When Google sign-in is on, the identity comes from the
 * session instead (see lib/auth.ts).
 */
export function getIdentity(): Identity {
  if (typeof window === 'undefined') {
    return { id: 'server', name: 'Server', color: colorForUser('server'), email: '', picture: '' }
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Identity>
      if (parsed.id && parsed.name) {
        return {
          id: parsed.id,
          name: parsed.name,
          color: colorForUser(parsed.id),
          email: '',
          picture: '',
        }
      }
    }
  } catch {
    /* localStorage can be unavailable in private mode; fall through */
  }

  const id = randomId()
  const identity: Identity = {
    id,
    name: randomName(),
    color: colorForUser(id),
    email: '',
    picture: '',
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    /* non-fatal: the identity just will not survive a reload */
  }

  return identity
}

export function setDisplayName(name: string): Identity {
  const current = getIdentity()
  const next: Identity = { ...current, name: name.trim().slice(0, 40) || current.name }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* non-fatal */
  }
  return next
}

/** The token a dev-mode client presents to the sync server. */
export function identityToken(identity: Identity): string {
  return JSON.stringify({ id: identity.id, name: identity.name })
}

import type { AuthedUser } from './auth.js'
import { authRequired } from './auth.js'
import type { DocStore, DocumentAcl } from './storage/index.js'

export class AccessDenied extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDenied'
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isOwner(acl: DocumentAcl, user: AuthedUser): boolean {
  return acl.ownerId === user.id
}

export function canAccess(acl: DocumentAcl, user: AuthedUser): boolean {
  if (isOwner(acl, user)) return true
  const email = normaliseEmail(user.email)
  if (!email) return false
  return acl.members.some((member) => normaliseEmail(member.email) === email)
}

/**
 * Decide whether `user` may open `documentName`, claiming ownership if the
 * document has no access record yet.
 *
 * Claiming on first open is what lets document creation stay a purely
 * client-side act — the client picks an id and navigates to it, and the server
 * records who got there first. The alternative, a create endpoint, would add a
 * round trip and a failure mode for something that needs neither.
 *
 * In dev mode this is a no-op: there are no verified identities to check
 * against, so pretending to enforce access would be theatre.
 */
export async function authorize(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
): Promise<DocumentAcl | null> {
  if (!authRequired()) return null

  const existing = await store.getAcl(documentName)

  if (!existing) {
    const acl: DocumentAcl = {
      ownerId: user.id,
      ownerEmail: normaliseEmail(user.email),
      members: [],
      createdAt: new Date().toISOString(),
    }
    await store.setAcl(documentName, acl)
    return acl
  }

  if (!canAccess(existing, user)) {
    throw new AccessDenied(
      'You do not have access to this document. Ask the owner to invite your Google account.',
    )
  }

  return existing
}

export async function addMember(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
  email: string,
): Promise<DocumentAcl> {
  const acl = await store.getAcl(documentName)
  if (!acl) throw new AccessDenied('This document has no owner yet.')
  if (!isOwner(acl, user)) throw new AccessDenied('Only the owner can invite people.')

  const target = normaliseEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    throw new Error('That does not look like an email address.')
  }
  if (target === normaliseEmail(acl.ownerEmail)) {
    throw new Error('The owner already has access.')
  }
  if (acl.members.some((member) => normaliseEmail(member.email) === target)) {
    return acl
  }

  const next: DocumentAcl = {
    ...acl,
    members: [...acl.members, { email: target, addedAt: new Date().toISOString() }],
  }
  await store.setAcl(documentName, next)
  return next
}

export async function removeMember(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
  email: string,
): Promise<DocumentAcl> {
  const acl = await store.getAcl(documentName)
  if (!acl) throw new AccessDenied('This document has no owner yet.')
  if (!isOwner(acl, user)) throw new AccessDenied('Only the owner can remove people.')

  const target = normaliseEmail(email)
  const next: DocumentAcl = {
    ...acl,
    members: acl.members.filter((member) => normaliseEmail(member.email) !== target),
  }
  await store.setAcl(documentName, next)
  return next
}

/**
 * Filter a document listing down to what this user may see. Without this the
 * explorer would leak every document name on the server to every signed-in
 * user, which is an access-control hole even though the content stays closed.
 */
export async function filterAccessible<T extends { name: string }>(
  store: DocStore,
  documents: T[],
  user: AuthedUser | null,
): Promise<T[]> {
  if (!authRequired()) return documents
  if (!user) return []

  const visible: T[] = []
  for (const document of documents) {
    const acl = await store.getAcl(document.name)
    // A document with no access record has never been opened by an
    // authenticated user, so nobody owns it yet and nobody should see it listed.
    if (acl && canAccess(acl, user)) visible.push(document)
  }
  return visible
}

import type { AuthedUser } from './auth.js'
import { authRequired } from './auth.js'
import type { DocStore, DocumentAcl, LinkAccess } from './storage/index.js'
import { isLinkAccess } from './storage/index.js'

export class AccessDenied extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDenied'
  }
}

/**
 * What a particular user may do with a particular document.
 *
 * `viewer` is a real, enforced state rather than a UI hint: the WebSocket
 * connection is marked read-only for it, so a viewer who edits the DOM by hand
 * still cannot land an update on the server.
 */
export type Role = 'owner' | 'editor' | 'viewer'

export interface AccessResult {
  /** null only in dev mode, where there is no access control to report. */
  acl: DocumentAcl | null
  role: Role
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isOwner(acl: DocumentAcl, user: AuthedUser): boolean {
  return acl.ownerId === user.id
}

/**
 * The single source of truth for "what is this person allowed to do here".
 *
 * Membership is checked before the link level so an invited editor keeps
 * editing even while the link is set to view-only -- the link level raises the
 * floor for strangers, it does not lower the ceiling for people you invited.
 */
export function roleFor(acl: DocumentAcl, user: AuthedUser): Role | null {
  if (isOwner(acl, user)) return 'owner'

  const email = normaliseEmail(user.email)
  if (email && acl.members.some((member) => normaliseEmail(member.email) === email)) {
    return 'editor'
  }

  if (acl.linkAccess === 'edit') return 'editor'
  if (acl.linkAccess === 'view') return 'viewer'
  return null
}

export function canAccess(acl: DocumentAcl, user: AuthedUser): boolean {
  return roleFor(acl, user) !== null
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
 * against, so pretending to enforce access would be theatre. Everyone is
 * reported as an owner, which is the honest description of a deployment with
 * no access control at all.
 */
export async function authorize(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
): Promise<AccessResult> {
  if (!authRequired()) return { acl: null, role: 'owner' }

  const existing = await store.getAcl(documentName)

  if (!existing) {
    const acl: DocumentAcl = {
      ownerId: user.id,
      ownerEmail: normaliseEmail(user.email),
      members: [],
      createdAt: new Date().toISOString(),
      // A new document starts closed. Opening it up is a decision the owner
      // makes in the Share dialog, never a default they have to discover.
      linkAccess: 'restricted',
    }
    await store.setAcl(documentName, acl)
    return { acl, role: 'owner' }
  }

  const role = roleFor(existing, user)
  if (!role) {
    throw new AccessDenied(
      'You do not have access to this document. Ask the owner to invite your Google account, or to turn on link sharing.',
    )
  }

  return { acl: existing, role }
}

/**
 * Resolve the caller to an owner, or refuse.
 *
 * Every mutation below starts here rather than with a raw store read, so that
 * the very first person to open the Share dialog on a brand-new document
 * claims ownership exactly as the WebSocket handshake would. Without it there
 * is a race whose outcome depends on which of the two happens to arrive first.
 */
async function requireOwner(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
  action: string,
): Promise<DocumentAcl> {
  const { acl } = await authorize(store, documentName, user)
  if (!acl) throw new Error('Access control is not enabled for this deployment.')
  if (!isOwner(acl, user)) throw new AccessDenied(`Only the owner can ${action}.`)
  return acl
}

export async function addMember(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
  email: string,
): Promise<DocumentAcl> {
  const acl = await requireOwner(store, documentName, user, 'invite people')

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
  const acl = await requireOwner(store, documentName, user, 'remove people')

  const target = normaliseEmail(email)
  const next: DocumentAcl = {
    ...acl,
    members: acl.members.filter((member) => normaliseEmail(member.email) !== target),
  }
  await store.setAcl(documentName, next)
  return next
}

/**
 * Change what the bare URL grants.
 *
 * Owner-only, and validated against the known levels rather than trusted: this
 * value comes from a JSON body, and writing an unrecognised string would leave
 * roleFor() falling through to "no access" for everyone including people who
 * were properly invited.
 */
export async function setLinkAccess(
  store: DocStore,
  documentName: string,
  user: AuthedUser,
  level: unknown,
): Promise<DocumentAcl> {
  if (!isLinkAccess(level)) {
    throw new Error('Unknown link access level. Expected restricted, view or edit.')
  }
  const acl = await requireOwner(store, documentName, user, 'change link sharing')
  if (acl.linkAccess === level) return acl

  const next: DocumentAcl = { ...acl, linkAccess: level as LinkAccess }
  await store.setAcl(documentName, next)
  return next
}

/**
 * Filter a document listing down to what this user may see. Without this the
 * explorer would leak every document name on the server to every signed-in
 * user, which is an access-control hole even though the content stays closed.
 *
 * Link sharing deliberately does not widen this. A link-shared document is
 * reachable by anyone holding its URL, but it is not *theirs*, and listing it
 * in every account's explorer would turn "shared with one colleague" into a
 * workspace-wide broadcast. You see a link-shared document by following the
 * link; it joins your explorer only once the owner invites you.
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
    if (!acl) continue
    const role = roleFor(acl, user)
    if (role === 'owner' || (role === 'editor' && !isLinkOnly(acl, user))) visible.push(document)
  }
  return visible
}

/** True when this user's only claim on the document is the link itself. */
function isLinkOnly(acl: DocumentAcl, user: AuthedUser): boolean {
  if (isOwner(acl, user)) return false
  const email = normaliseEmail(user.email)
  return !email || !acl.members.some((member) => normaliseEmail(member.email) === email)
}

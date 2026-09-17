/**
 * Persistence contract.
 *
 * A note on what is stored: we persist the *merged* Y.Doc state
 * (Y.encodeStateAsUpdate(doc)), not an append-only log of updates. An update
 * log grows without bound and turns document load into an O(history) merge --
 * exactly the memory-footprint failure this project is meant to avoid. Yjs can
 * merge a full state update just as cheaply as a delta, so the merged form is
 * strictly better for the primary row. History lives in snapshot(), which is
 * written on a slow interval and can be pruned independently.
 */
export interface DocumentMeta {
  name: string
  title: string
  bytes: number
  updatedAt: string
}

export const DEFAULT_TITLE = 'Untitled document'

export interface DocStore {
  readonly driver: string
  /** Returns the persisted state, or null for a document that has never been saved. */
  load(name: string): Promise<Uint8Array | null>
  /**
   * Upsert the current merged state. Called debounced, never per keystroke.
   * The title is denormalised out of the document so the explorer can list
   * documents without decoding every stored Y.Doc.
   */
  store(name: string, state: Uint8Array, title: string): Promise<void>
  /**
   * Append an immutable point-in-time copy (version history).
   *
   * `author` is the display name of whoever last edited before this snapshot
   * was taken, denormalised out of the document's own meta map. It is a label
   * for the history view, not an authorisation fact -- the person who typed
   * last is not necessarily the only contributor to the version.
   */
  snapshot(name: string, state: Uint8Array, author: string): Promise<void>
  /** Documents that exist in storage, newest first. */
  list(): Promise<DocumentMeta[]>
  /** Version history for one document, newest first. */
  listSnapshots(name: string): Promise<SnapshotMeta[]>
  /** The stored bytes of one snapshot, or null if it is gone. */
  loadSnapshot(name: string, id: string): Promise<Uint8Array | null>
  /** The access-control record, or null for a document nobody has claimed. */
  getAcl(name: string): Promise<DocumentAcl | null>
  setAcl(name: string, acl: DocumentAcl): Promise<void>
  /**
   * Permanently remove a document, its snapshots and its access record.
   *
   * The ACL goes too, deliberately. Leaving it behind would keep the name
   * claimed forever: a later visitor would be refused by an owner record for a
   * document that no longer exists, and the owner could never reuse the id.
   */
  remove(name: string): Promise<void>
  close(): Promise<void>
}

/**
 * Who may open a document.
 *
 * Ownership is claimed by the first authenticated user to open a document that
 * has no record yet, which is what makes "create" a client-side action with no
 * extra endpoint. Members are stored by lowercased email because that is the
 * only identifier the owner knows before the invitee has ever signed in — a
 * Supabase user id does not exist until first login.
 */
export interface DocumentAcl {
  ownerId: string
  ownerEmail: string
  members: AclMember[]
  createdAt: string
  /** How much the bare URL grants on its own. See {@link LinkAccess}. */
  linkAccess: LinkAccess
}

/**
 * What the link alone is worth.
 *
 * `restricted` - the URL grants nothing; the opener must be the owner or an
 *                invited member. This is the default, and the only level at
 *                which a document name is a secret worth keeping.
 * `view`       - any signed-in account holding the link may read, not write.
 * `edit`       - any signed-in account holding the link may edit.
 *
 * Note that even the open levels still require a verified sign-in. That is a
 * deliberate limit rather than an oversight: presence, cursor attribution and
 * the per-user undo stack all key off an identity, and a truly anonymous
 * editor would have none. It also keeps one property worth having -- every
 * edit in this system is attributable to an account.
 */
export type LinkAccess = 'restricted' | 'view' | 'edit'

export const LINK_ACCESS_LEVELS: readonly LinkAccess[] = ['restricted', 'view', 'edit']

export function isLinkAccess(value: unknown): value is LinkAccess {
  return typeof value === 'string' && (LINK_ACCESS_LEVELS as readonly string[]).includes(value)
}

/**
 * Fill in fields that records written by an older build do not have.
 *
 * Both drivers run stored ACLs through this on the way out, so the rest of the
 * server can treat `linkAccess` as always present. The default is deliberately
 * the closed one: a document saved before link sharing existed was shared with
 * nobody, and must not silently become link-readable on upgrade.
 */
export type StoredAcl = Partial<Omit<DocumentAcl, 'linkAccess'>> & { linkAccess?: unknown }

export function withAclDefaults(stored: StoredAcl): DocumentAcl {
  return {
    ownerId: stored.ownerId ?? '',
    ownerEmail: stored.ownerEmail ?? '',
    members: Array.isArray(stored.members) ? stored.members : [],
    createdAt: stored.createdAt ?? new Date(0).toISOString(),
    linkAccess: isLinkAccess(stored.linkAccess) ? stored.linkAccess : 'restricted',
  }
}

export interface AclMember {
  email: string
  addedAt: string
}

export interface SnapshotMeta {
  id: string
  createdAt: string
  bytes: number
  /** Empty when the snapshot predates author tracking. */
  author: string
}

/**
 * Document names arrive from untrusted clients and are used as storage keys.
 * The file driver turns them into paths, so anything outside this character
 * class is rejected rather than sanitised -- silently rewriting a name would
 * merge two unrelated documents into one.
 */
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/

export function assertSafeDocumentName(name: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      'Invalid document name "' + name + '". Expected 1-64 chars of [A-Za-z0-9_-].',
    )
  }
}

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
  /** Append an immutable point-in-time copy (version history). */
  snapshot(name: string, state: Uint8Array): Promise<void>
  /** Documents that exist in storage, newest first. */
  list(): Promise<DocumentMeta[]>
  /** Version history for one document, newest first. */
  listSnapshots(name: string): Promise<SnapshotMeta[]>
  /** The stored bytes of one snapshot, or null if it is gone. */
  loadSnapshot(name: string, id: string): Promise<Uint8Array | null>
  /** The access-control record, or null for a document nobody has claimed. */
  getAcl(name: string): Promise<DocumentAcl | null>
  setAcl(name: string, acl: DocumentAcl): Promise<void>
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
}

export interface AclMember {
  email: string
  addedAt: string
}

export interface SnapshotMeta {
  id: string
  createdAt: string
  bytes: number
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

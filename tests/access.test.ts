import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Access control is the one part of this app where a bug is a security bug
 * rather than a sync bug, so it gets its own suite.
 *
 * AUTH_MODE has to be set before the server modules load, because config.ts
 * reads the environment at import time. That is why everything here is imported
 * dynamically inside beforeAll rather than at the top of the file.
 */
process.env.AUTH_MODE = 'supabase'
process.env.SUPABASE_URL = 'https://example.supabase.co'

type AccessModule = typeof import('../apps/server/src/access.js')
type StorageModule = typeof import('../apps/server/src/storage/file-store.js')

let access: AccessModule
let FileStore: StorageModule['FileStore']
let dir: string
let store: InstanceType<StorageModule['FileStore']>

const owner = {
  id: 'user-owner',
  name: 'Owner',
  email: 'Owner@Example.com',
  picture: '',
  isGuest: false,
}
const invited = {
  id: 'user-invited',
  name: 'Invited',
  email: 'invited@example.com',
  picture: '',
  isGuest: false,
}
const stranger = {
  id: 'user-stranger',
  name: 'Stranger',
  email: 'stranger@example.com',
  picture: '',
  isGuest: false,
}
/** Nobody signed in. Carries no id at all, which is the point. */
const guest = { id: '', name: 'Guest', email: '', picture: '', isGuest: true }

beforeAll(async () => {
  access = await import('../apps/server/src/access.js')
  ;({ FileStore } = await import('../apps/server/src/storage/file-store.js'))
  dir = await mkdtemp(path.join(tmpdir(), 'collab-acl-'))
  store = new FileStore(dir)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('document access control', () => {
  it('gives ownership to the first user who opens an unclaimed document', async () => {
    const { acl, role } = await access.authorize(store, 'doc-alpha', owner)
    expect(role).toBe('owner')
    expect(acl?.ownerId).toBe(owner.id)
    // Emails are normalised on the way in so a case difference at sign-in
    // cannot lock someone out of their own document.
    expect(acl?.ownerEmail).toBe('owner@example.com')
    expect(acl?.members).toEqual([])
    // A new document is closed until its owner decides otherwise.
    expect(acl?.linkAccess).toBe('restricted')
  })

  it('does not transfer ownership when someone else opens it later', async () => {
    await expect(access.authorize(store, 'doc-alpha', stranger)).rejects.toThrow(
      /do not have access/i,
    )
    const acl = await store.getAcl('doc-alpha')
    expect(acl?.ownerId).toBe(owner.id)
  })

  it('lets the owner invite someone, who can then open it as an editor', async () => {
    await access.addMember(store, 'doc-alpha', owner, 'Invited@Example.com')
    const { acl, role } = await access.authorize(store, 'doc-alpha', invited)
    expect(role).toBe('editor')
    expect(acl?.members.map((member) => member.email)).toEqual(['invited@example.com'])
  })

  it('refuses to let a non-owner invite anyone', async () => {
    await expect(
      access.addMember(store, 'doc-alpha', invited, 'someone-else@example.com'),
    ).rejects.toThrow(/only the owner/i)

    const acl = await store.getAcl('doc-alpha')
    expect(acl?.members).toHaveLength(1)
  })

  it('refuses to let a non-owner remove anyone', async () => {
    await expect(
      access.removeMember(store, 'doc-alpha', invited, 'invited@example.com'),
    ).rejects.toThrow(/only the owner/i)
  })

  it('rejects a malformed email rather than storing it', async () => {
    await expect(access.addMember(store, 'doc-alpha', owner, 'not-an-email')).rejects.toThrow(
      /email address/i,
    )
  })

  it('is idempotent when the same person is invited twice', async () => {
    await access.addMember(store, 'doc-alpha', owner, 'invited@example.com')
    const acl = await store.getAcl('doc-alpha')
    expect(acl?.members).toHaveLength(1)
  })

  it('revokes access when the owner removes someone', async () => {
    await access.removeMember(store, 'doc-alpha', owner, 'invited@example.com')
    await expect(access.authorize(store, 'doc-alpha', invited)).rejects.toThrow(
      /do not have access/i,
    )
  })

  it('never hides a document from its own owner', async () => {
    const { acl, role } = await access.authorize(store, 'doc-alpha', owner)
    expect(acl?.ownerId).toBe(owner.id)
    expect(role).toBe('owner')
  })

  it('lists only the documents a user may open', async () => {
    await access.authorize(store, 'doc-beta', invited)
    await access.authorize(store, 'doc-gamma', stranger)

    const all = [{ name: 'doc-alpha' }, { name: 'doc-beta' }, { name: 'doc-gamma' }]

    expect((await access.filterAccessible(store, all, owner)).map((d) => d.name)).toEqual([
      'doc-alpha',
    ])
    expect((await access.filterAccessible(store, all, invited)).map((d) => d.name)).toEqual([
      'doc-beta',
    ])
    // An anonymous caller sees nothing at all, rather than the full name list.
    expect(await access.filterAccessible(store, all, null)).toEqual([])
  })

  it('does not treat an empty email as a match for a member', async () => {
    const noEmail = {
      id: 'user-no-email',
      name: 'No Email',
      email: '',
      picture: '',
      isGuest: false,
    }
    await access.addMember(store, 'doc-beta', invited, 'someone@example.com')
    await expect(access.authorize(store, 'doc-beta', noEmail)).rejects.toThrow(
      /do not have access/i,
    )
  })

  /**
   * Regression coverage for a real bug: addMember/removeMember used to read
   * the ACL with a plain store.getAcl() instead of authorize(), so calling
   * either of them before any WebSocket had ever connected to the document
   * threw "This document has no owner yet." — which is exactly what the Share
   * dialog does on a brand-new document if you open it before the editor's
   * socket finishes its handshake. The REST path now claims ownership itself,
   * the same way the WebSocket path always has.
   */
  it('lets the very first HTTP call on a brand-new document claim ownership via addMember', async () => {
    // No authorize()/WS call has ever touched this name.
    const acl = await access.addMember(store, 'doc-delta', owner, 'invited@example.com')
    expect(acl.ownerId).toBe(owner.id)
    expect(acl.members.map((member) => member.email)).toEqual(['invited@example.com'])
  })

  it('lets the very first HTTP call on a brand-new document claim ownership via removeMember', async () => {
    const acl = await access.removeMember(store, 'doc-epsilon', owner, 'nobody@example.com')
    expect(acl.ownerId).toBe(owner.id)
  })

  it('refuses invite/remove from an invited member who is not the owner', async () => {
    await access.authorize(store, 'doc-zeta', owner)
    await access.addMember(store, 'doc-zeta', owner, 'invited@example.com')

    // `invited` genuinely has access to doc-zeta (they are a member), so this
    // exercises the isOwner() check inside addMember/removeMember, not the
    // authorize() access check above it.
    await expect(
      access.addMember(store, 'doc-zeta', invited, 'someone-else@example.com'),
    ).rejects.toThrow(/only the owner/i)
    await expect(
      access.removeMember(store, 'doc-zeta', invited, 'owner@example.com'),
    ).rejects.toThrow(/only the owner/i)
  })

  it('refuses invite/remove from someone with no access at all, with the generic denial', async () => {
    await access.authorize(store, 'doc-eta', owner)
    // `stranger` has never been invited to doc-eta, so this should fail at the
    // authorize() check -- before ever reaching the owner-only logic -- and
    // say "you do not have access" rather than something that confirms the
    // document exists and has an owner.
    await expect(
      access.addMember(store, 'doc-eta', stranger, 'someone@example.com'),
    ).rejects.toThrow(/do not have access/i)
  })
})

describe('link sharing', () => {
  it('keeps a document closed until the owner opens it', async () => {
    await access.authorize(store, 'doc-link', owner)
    await expect(access.authorize(store, 'doc-link', stranger)).rejects.toThrow(
      /do not have access/i,
    )
  })

  it('lets anyone with the link read once set to view, but not write', async () => {
    const acl = await access.setLinkAccess(store, 'doc-link', owner, 'view')
    expect(acl.linkAccess).toBe('view')

    const { role } = await access.authorize(store, 'doc-link', stranger)
    // 'viewer' is what index.ts turns into connection.readOnly, so this single
    // assertion is what stands between a view link and a write.
    expect(role).toBe('viewer')
  })

  it('lets anyone with the link write once set to edit', async () => {
    await access.setLinkAccess(store, 'doc-link', owner, 'edit')
    const { role } = await access.authorize(store, 'doc-link', stranger)
    expect(role).toBe('editor')
  })

  it('closes the link again when set back to restricted', async () => {
    await access.setLinkAccess(store, 'doc-link', owner, 'restricted')
    await expect(access.authorize(store, 'doc-link', stranger)).rejects.toThrow(
      /do not have access/i,
    )
  })

  /**
   * The link level raises the floor for strangers; it must not lower the
   * ceiling for people the owner explicitly invited. Someone invited as an
   * editor keeps editing even while the link is view-only.
   */
  it('does not demote an invited editor when the link is view-only', async () => {
    await access.addMember(store, 'doc-link', owner, 'invited@example.com')
    await access.setLinkAccess(store, 'doc-link', owner, 'view')

    expect((await access.authorize(store, 'doc-link', invited)).role).toBe('editor')
    expect((await access.authorize(store, 'doc-link', stranger)).role).toBe('viewer')
    // And the owner is never demoted by their own link setting.
    expect((await access.authorize(store, 'doc-link', owner)).role).toBe('owner')
  })

  it('refuses to change link sharing for anyone but the owner', async () => {
    await expect(access.setLinkAccess(store, 'doc-link', invited, 'edit')).rejects.toThrow(
      /only the owner/i,
    )
    await expect(access.setLinkAccess(store, 'doc-link', stranger, 'edit')).rejects.toThrow(
      /only the owner/i,
    )

    // The stranger above is a viewer via the link, so they reach the owner
    // check rather than the access check -- but either way nothing moved.
    expect((await store.getAcl('doc-link'))?.linkAccess).toBe('view')
  })

  /**
   * An unrecognised level would fall through every branch of roleFor() and
   * lock out the owner's own invitees, so it is rejected before it is written
   * rather than stored and puzzled over later.
   */
  it('rejects an unknown link level instead of storing it', async () => {
    for (const bad of ['public', '', 'EDIT', null, 7]) {
      await expect(access.setLinkAccess(store, 'doc-link', owner, bad)).rejects.toThrow(
        /unknown link access level/i,
      )
    }
    expect((await store.getAcl('doc-link'))?.linkAccess).toBe('view')
  })

  /**
   * A link-shared document is reachable by URL, but it is not the visitor's
   * document. Listing it in their explorer would turn "shared with one
   * colleague" into a workspace-wide broadcast.
   */
  it('does not add a link-shared document to a stranger explorer', async () => {
    await access.setLinkAccess(store, 'doc-link', owner, 'edit')
    const all = [{ name: 'doc-link' }]

    expect(await access.filterAccessible(store, all, stranger)).toEqual([])
    // The owner and the explicitly invited member still see it.
    expect((await access.filterAccessible(store, all, owner)).map((d) => d.name)).toEqual([
      'doc-link',
    ])
    expect((await access.filterAccessible(store, all, invited)).map((d) => d.name)).toEqual([
      'doc-link',
    ])
  })

  /**
   * Records written before link sharing existed have no linkAccess field at
   * all. Reading one back must produce the closed level -- an undefined level
   * would match no branch of roleFor() and lock the owner out of their own
   * document.
   */
  it('treats an ACL stored without a link level as restricted', async () => {
    const legacy = {
      ownerId: owner.id,
      ownerEmail: 'owner@example.com',
      members: [],
      createdAt: new Date().toISOString(),
    }
    await store.setAcl('doc-legacy', legacy as never)

    const acl = await store.getAcl('doc-legacy')
    expect(acl?.linkAccess).toBe('restricted')
    expect((await access.authorize(store, 'doc-legacy', owner)).role).toBe('owner')
    await expect(access.authorize(store, 'doc-legacy', stranger)).rejects.toThrow(
      /do not have access/i,
    )
  })
})

/**
 * Anonymous access, which is what "Anyone with the link — no sign in required"
 * actually means. This is the part where a mistake is a security bug rather
 * than a sync bug, so it gets the most pointed cases: a guest must never own
 * anything, never see who else was invited, and never get in anywhere the
 * owner did not open up.
 */
describe('guests (no sign-in)', () => {
  it('refuses a guest on a restricted document', async () => {
    await access.authorize(store, 'doc-guest', owner)
    await expect(access.authorize(store, 'doc-guest', guest)).rejects.toThrow(/private/i)
  })

  it('lets a guest read a view link and edit an edit link', async () => {
    await access.setLinkAccess(store, 'doc-guest', owner, 'view')
    expect((await access.authorize(store, 'doc-guest', guest)).role).toBe('viewer')

    await access.setLinkAccess(store, 'doc-guest', owner, 'edit')
    expect((await access.authorize(store, 'doc-guest', guest)).role).toBe('editor')
  })

  /**
   * The one that matters most. Claim-on-first-open is how documents come into
   * existence; if a guest could trigger it, anyone could mint and own
   * documents on the deployment just by guessing names.
   */
  it('never lets a guest claim an unclaimed document', async () => {
    await expect(access.authorize(store, 'doc-unclaimed', guest)).rejects.toThrow(/sign in/i)
    // And nothing was written, so the real owner can still claim it.
    expect(await store.getAcl('doc-unclaimed')).toBeNull()
    expect((await access.authorize(store, 'doc-unclaimed', owner)).role).toBe('owner')
  })

  /**
   * A guest's id is the empty string, so an ACL with an empty ownerId is the
   * one shape where a naive `acl.ownerId === user.id` would hand ownership to
   * every anonymous visitor at once. Two independent things prevent it, and
   * both are asserted here because either one alone would be load-bearing:
   *
   *  1. Both drivers treat a record with no ownerId as no record at all, so
   *     it never reaches the comparison.
   *  2. isOwner() refuses a guest outright, and refuses an empty ownerId
   *     outright, for the case where such a record is held in memory anyway.
   */
  it('never treats a guest as the owner of a record with an empty ownerId', async () => {
    const corrupt = {
      ownerId: '',
      ownerEmail: '',
      members: [],
      createdAt: new Date().toISOString(),
      linkAccess: 'edit' as const,
    }

    expect(access.isOwner(corrupt, guest)).toBe(false)
    // Not even a signed-in user with an empty id, which dev mode cannot
    // produce but a malformed token might.
    expect(access.isOwner(corrupt, { ...guest, isGuest: false })).toBe(false)

    await store.setAcl('doc-empty-owner', corrupt)
    // The driver declines to load it, so the document reads as unclaimed...
    expect(await store.getAcl('doc-empty-owner')).toBeNull()
    // ...which means a guest is told to sign in, not handed the document.
    await expect(access.authorize(store, 'doc-empty-owner', guest)).rejects.toThrow(/sign in/i)
  })

  it('refuses every mutation from a guest, however the link is set', async () => {
    await access.setLinkAccess(store, 'doc-guest', owner, 'edit')
    await expect(access.addMember(store, 'doc-guest', guest, 'x@y.com')).rejects.toThrow(
      /sign in/i,
    )
    await expect(access.removeMember(store, 'doc-guest', guest, 'x@y.com')).rejects.toThrow(
      /sign in/i,
    )
    await expect(access.setLinkAccess(store, 'doc-guest', guest, 'restricted')).rejects.toThrow(
      /sign in/i,
    )
    expect((await store.getAcl('doc-guest'))?.linkAccess).toBe('edit')
  })

  /**
   * A share link shares the document, not the guest list. Handing back the
   * owner's address and every collaborator's would turn a view link into a way
   * to harvest addresses.
   */
  it('hides the owner address and member list from a link visitor', async () => {
    await access.addMember(store, 'doc-guest', owner, 'invited@example.com')
    const acl = (await store.getAcl('doc-guest'))!

    const forGuest = access.visibleAcl(acl, guest)
    expect(forGuest?.ownerEmail).toBe('')
    expect(forGuest?.members).toEqual([])

    // A signed-in stranger on the same link is no better placed.
    expect(access.visibleAcl(acl, stranger)?.members).toEqual([])

    // The owner and the invited member see the real thing.
    expect(access.visibleAcl(acl, owner)?.ownerEmail).toBe('owner@example.com')
    expect(access.visibleAcl(acl, invited)?.members).toHaveLength(1)
  })

  it('shows a guest no documents at all in the explorer', async () => {
    const all = [{ name: 'doc-guest' }, { name: 'doc-alpha' }]
    expect(await access.filterAccessible(store, all, guest)).toEqual([])
  })
})

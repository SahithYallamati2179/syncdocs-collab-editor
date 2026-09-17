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
}
const invited = {
  id: 'user-invited',
  name: 'Invited',
  email: 'invited@example.com',
  picture: '',
}
const stranger = {
  id: 'user-stranger',
  name: 'Stranger',
  email: 'stranger@example.com',
  picture: '',
}

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
    const acl = await access.authorize(store, 'doc-alpha', owner)
    expect(acl?.ownerId).toBe(owner.id)
    // Emails are normalised on the way in so a case difference at sign-in
    // cannot lock someone out of their own document.
    expect(acl?.ownerEmail).toBe('owner@example.com')
    expect(acl?.members).toEqual([])
  })

  it('does not transfer ownership when someone else opens it later', async () => {
    await expect(access.authorize(store, 'doc-alpha', stranger)).rejects.toThrow(
      /do not have access/i,
    )
    const acl = await store.getAcl('doc-alpha')
    expect(acl?.ownerId).toBe(owner.id)
  })

  it('lets the owner invite someone, who can then open it', async () => {
    await access.addMember(store, 'doc-alpha', owner, 'Invited@Example.com')
    const acl = await access.authorize(store, 'doc-alpha', invited)
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
    const acl = await access.authorize(store, 'doc-alpha', owner)
    expect(acl?.ownerId).toBe(owner.id)
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
    const noEmail = { id: 'user-no-email', name: 'No Email', email: '', picture: '' }
    await access.addMember(store, 'doc-beta', invited, 'someone@example.com')
    await expect(access.authorize(store, 'doc-beta', noEmail)).rejects.toThrow(
      /do not have access/i,
    )
  })
})

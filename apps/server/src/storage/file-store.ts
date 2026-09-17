import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  assertSafeDocumentName,
  DEFAULT_TITLE,
  type DocStore,
  type DocumentAcl,
  type DocumentMeta,
  type SnapshotMeta,
} from './types.js'

/**
 * Zero-dependency persistence: one binary file per document, plus a snapshots
 * folder for history. This is the default driver so the project runs
 * immediately after npm install with no database to provision.
 */
export class FileStore implements DocStore {
  readonly driver = 'file'
  private readonly root: string

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir)
  }

  private docPath(name: string): string {
    assertSafeDocumentName(name)
    return path.join(this.root, name + '.bin')
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  async load(name: string): Promise<Uint8Array | null> {
    try {
      const buffer = await fs.readFile(this.docPath(name))
      return new Uint8Array(buffer)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async store(name: string, state: Uint8Array, title: string): Promise<void> {
    const target = this.docPath(name)
    await this.ensureDir(path.dirname(target))
    // Write to a temp file then rename. A crash mid-write must not leave a
    // truncated Y.Doc on disk, which would be unrecoverable.
    const temp = target + '.' + process.pid + '.tmp'
    await fs.writeFile(temp, state)
    await fs.rename(temp, target)
    await fs.writeFile(
      path.join(this.root, name + '.meta.json'),
      JSON.stringify({ title, updatedAt: new Date().toISOString() }),
    )
  }

  private async readTitle(name: string): Promise<string> {
    try {
      const raw = await fs.readFile(path.join(this.root, name + '.meta.json'), 'utf8')
      const parsed = JSON.parse(raw) as { title?: unknown }
      return typeof parsed.title === 'string' && parsed.title ? parsed.title : DEFAULT_TITLE
    } catch {
      return DEFAULT_TITLE
    }
  }

  async snapshot(name: string, state: Uint8Array): Promise<void> {
    assertSafeDocumentName(name)
    const dir = path.join(this.root, 'snapshots', name)
    await this.ensureDir(dir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.writeFile(path.join(dir, stamp + '.bin'), state)
  }

  async list(): Promise<DocumentMeta[]> {
    await this.ensureDir(this.root)
    const entries = await fs.readdir(this.root, { withFileTypes: true })
    const docs: DocumentMeta[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.bin')) continue
      const name = entry.name.slice(0, -4)
      const stat = await fs.stat(path.join(this.root, entry.name))
      docs.push({
        name,
        title: await this.readTitle(name),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      })
    }

    return docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listSnapshots(name: string): Promise<SnapshotMeta[]> {
    assertSafeDocumentName(name)
    const dir = path.join(this.root, 'snapshots', name)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }

    const snapshots: SnapshotMeta[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.bin')) continue
      const stat = await fs.stat(path.join(dir, entry))
      snapshots.push({
        id: entry.slice(0, -4),
        createdAt: stat.mtime.toISOString(),
        bytes: stat.size,
      })
    }
    return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async loadSnapshot(name: string, id: string): Promise<Uint8Array | null> {
    assertSafeDocumentName(name)
    // Snapshot ids are generated from a timestamp, but they arrive back from
    // the client, so they get the same treatment as a document name.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
    try {
      const buffer = await fs.readFile(path.join(this.root, 'snapshots', name, id + '.bin'))
      return new Uint8Array(buffer)
    } catch {
      return null
    }
  }

  async getAcl(name: string): Promise<DocumentAcl | null> {
    assertSafeDocumentName(name)
    try {
      const raw = await fs.readFile(path.join(this.root, name + '.acl.json'), 'utf8')
      const parsed = JSON.parse(raw) as DocumentAcl
      return parsed.ownerId ? parsed : null
    } catch {
      return null
    }
  }

  async setAcl(name: string, acl: DocumentAcl): Promise<void> {
    assertSafeDocumentName(name)
    await this.ensureDir(this.root)
    await fs.writeFile(path.join(this.root, name + '.acl.json'), JSON.stringify(acl, null, 2))
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

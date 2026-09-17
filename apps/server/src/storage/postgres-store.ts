import pg from 'pg'
import {
  assertSafeDocumentName,
  DEFAULT_TITLE,
  type DocStore,
  type DocumentAcl,
  type DocumentMeta,
  type SnapshotMeta,
  withAclDefaults,
} from './types.js'

const UPSERT_SQL =
  'insert into documents (name, title, state, updated_at) values ($1, $2, $3, now()) ' +
  'on conflict (name) do update set title = excluded.title, state = excluded.state, updated_at = now()'

const LIST_SQL =
  'select name, title, octet_length(state)::text as bytes, updated_at ' +
  'from documents order by updated_at desc limit 100'

const LIST_SNAPSHOTS_SQL =
  'select id::text as id, created_at, octet_length(state)::text as bytes, ' +
  "coalesce(author, '') as author " +
  'from document_snapshots where document_name = $1 order by created_at desc limit 50'

/**
 * Postgres driver (Supabase free tier, Neon, or any Postgres).
 * Run sql/schema.sql once before enabling STORAGE_DRIVER=postgres.
 */
export class PostgresStore implements DocStore {
  readonly driver = 'postgres'
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString)
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      // Hosted Postgres requires TLS but often presents a chain Node has no
      // root for. Local connections skip TLS entirely.
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    })
  }

  async load(name: string): Promise<Uint8Array | null> {
    assertSafeDocumentName(name)
    const result = await this.pool.query<{ state: Buffer }>(
      'select state from documents where name = $1',
      [name],
    )
    const row = result.rows[0]
    return row ? new Uint8Array(row.state) : null
  }

  async store(name: string, state: Uint8Array, title: string): Promise<void> {
    assertSafeDocumentName(name)
    await this.pool.query(UPSERT_SQL, [name, title || DEFAULT_TITLE, Buffer.from(state)])
  }

  async snapshot(name: string, state: Uint8Array, author: string): Promise<void> {
    assertSafeDocumentName(name)
    await this.pool.query(
      'insert into document_snapshots (document_name, state, author) values ($1, $2, $3)',
      [name, Buffer.from(state), author.slice(0, 80)],
    )
  }

  async list(): Promise<DocumentMeta[]> {
    const result = await this.pool.query<{
      name: string
      title: string
      bytes: string
      updated_at: Date
    }>(LIST_SQL)

    return result.rows.map((row) => ({
      name: row.name,
      title: row.title || DEFAULT_TITLE,
      bytes: Number(row.bytes),
      updatedAt: row.updated_at.toISOString(),
    }))
  }

  async listSnapshots(name: string): Promise<SnapshotMeta[]> {
    assertSafeDocumentName(name)
    const result = await this.pool.query<{
      id: string
      created_at: Date
      bytes: string
      author: string
    }>(LIST_SNAPSHOTS_SQL, [name])

    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      bytes: Number(row.bytes),
      author: row.author ?? '',
    }))
  }

  async loadSnapshot(name: string, id: string): Promise<Uint8Array | null> {
    assertSafeDocumentName(name)
    if (!/^\d{1,19}$/.test(id)) return null
    const result = await this.pool.query<{ state: Buffer }>(
      'select state from document_snapshots where document_name = $1 and id = $2',
      [name, id],
    )
    const row = result.rows[0]
    return row ? new Uint8Array(row.state) : null
  }

  async getAcl(name: string): Promise<DocumentAcl | null> {
    assertSafeDocumentName(name)
    const result = await this.pool.query<{
      owner_id: string
      owner_email: string
      members: unknown
      link_access: string | null
      created_at: Date
    }>(
      'select owner_id, owner_email, members, link_access, created_at ' +
        'from document_access where document_name = $1',
      [name],
    )
    const row = result.rows[0]
    if (!row?.owner_id) return null
    // The column is nullable for rows written before link sharing existed;
    // withAclDefaults turns that into the closed level rather than undefined.
    return withAclDefaults({
      ownerId: row.owner_id,
      ownerEmail: row.owner_email ?? '',
      members: Array.isArray(row.members) ? (row.members as DocumentAcl['members']) : [],
      linkAccess: row.link_access ?? undefined,
      createdAt: row.created_at.toISOString(),
    })
  }

  async setAcl(name: string, acl: DocumentAcl): Promise<void> {
    assertSafeDocumentName(name)
    await this.pool.query(
      'insert into document_access (document_name, owner_id, owner_email, members, link_access) ' +
        'values ($1, $2, $3, $4::jsonb, $5) ' +
        'on conflict (document_name) do update set owner_id = excluded.owner_id, ' +
        'owner_email = excluded.owner_email, members = excluded.members, ' +
        'link_access = excluded.link_access',
      [name, acl.ownerId, acl.ownerEmail, JSON.stringify(acl.members), acl.linkAccess],
    )
  }

  /**
   * Prove the database is reachable and has the schema, at startup.
   *
   * Without this the first sign of trouble is a failed persist minutes later,
   * logged against a document name, long after the deploy that caused it. The
   * timeout matters as much as the query: an unreachable host does not refuse
   * the connection, it hangs, so waiting indefinitely here would replace a
   * clear failure with a silent one.
   */
  async preflight(timeoutMs = 10_000): Promise<{ ok: boolean; detail: string }> {
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `no response within ${timeoutMs}ms — the host is probably unreachable from here ` +
                '(a wrong host hangs rather than refusing)',
            ),
          ),
        timeoutMs,
      )
    })

    try {
      const check = this.pool.query<{ present: string }>(
        "select string_agg(table_name, ',' order by table_name) as present " +
          'from information_schema.tables ' +
          "where table_schema = 'public' " +
          "and table_name in ('documents','document_snapshots','document_access')",
      )

      const result = await Promise.race([check, timeout])
      const present = (result.rows[0]?.present ?? '').split(',').filter(Boolean)
      const missing = ['document_access', 'document_snapshots', 'documents'].filter(
        (table) => !present.includes(table),
      )

      if (missing.length > 0) {
        return {
          ok: false,
          detail: `connected, but these tables are missing: ${missing.join(', ')}. Run apps/server/sql/schema.sql once.`,
        }
      }
      return { ok: true, detail: `connected, all ${present.length} tables present` }
    } catch (error) {
      return { ok: false, detail: (error as Error).message }
    }
  }

  async remove(name: string): Promise<void> {
    assertSafeDocumentName(name)
    const client = await this.pool.connect()
    try {
      // One transaction: a half-deleted document whose ACL survived would be
      // permanently unreachable and permanently unclaimable.
      await client.query('begin')
      // Snapshots cascade from documents, but delete them explicitly so the
      // rows go even when no documents row was ever written.
      await client.query('delete from document_snapshots where document_name = $1', [name])
      await client.query('delete from documents where name = $1', [name])
      await client.query('delete from document_access where document_name = $1', [name])
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

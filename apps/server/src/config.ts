import 'dotenv/config'

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export type AuthMode = 'dev' | 'supabase'
export type StorageDriver = 'file' | 'postgres'

export const config = {
  port: num(process.env.PORT, 1234),

  /**
   * `dev`      - trust the identity the client sends. Zero external
   *              dependencies, which is what makes `npm run dev` work with no
   *              setup at all. Not authentication.
   * `supabase` - require a Supabase-issued JWT (Google sign-in) and enforce
   *              per-document access control.
   */
  authMode: (process.env.AUTH_MODE as AuthMode) ?? 'dev',

  /**
   * Supabase signs access tokens either with the project's shared HS256 secret
   * (legacy projects) or with an asymmetric key published at JWKS (current
   * default). Providing the URL is enough for the asymmetric case; the secret is
   * only needed for the legacy one. Both are supported, chosen per token.
   */
  supabaseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',

  /**
   * `file`     - one .bin per document under DATA_DIR. No database needed.
   * `postgres` - a `documents` row per document, plus a `document_snapshots`
   *              history table. See sql/schema.sql.
   */
  storageDriver: (process.env.STORAGE_DRIVER as StorageDriver) ?? 'file',
  dataDir: process.env.DATA_DIR ?? './.data',
  databaseUrl: process.env.DATABASE_URL ?? '',

  /**
   * The server does not write on every keystroke. Hocuspocus coalesces the
   * onStoreDocument calls: `debounce` is the quiet period after the last edit,
   * `maxDebounce` is the hard ceiling so a continuously-typing user still gets
   * durable writes.
   */
  persistDebounceMs: num(process.env.PERSIST_DEBOUNCE_MS, 2000),
  persistMaxDebounceMs: num(process.env.PERSIST_MAX_DEBOUNCE_MS, 10_000),
  snapshotIntervalMs: num(process.env.SNAPSHOT_INTERVAL_MS, 300_000),

  corsOrigin: process.env.CORS_ORIGIN ?? '*',
} as const

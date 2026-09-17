/**
 * Server-side counters, exposed at GET /api/stats so the browser metrics lab
 * can show what the server thinks is happening alongside what the client
 * measures. Intentionally in-memory: these are diagnostics, not business data.
 */
export interface ServerStats {
  startedAt: string
  uptimeSeconds: number
  connections: number
  peakConnections: number
  openDocuments: number
  loads: number
  writes: number
  snapshots: number
  bytesWritten: number
  lastWriteAt: string | null
  authFailures: number
  /** Persist failures since boot. Non-zero means documents are memory-only. */
  storageFailures: number
  lastStorageError: string | null
}

const startedAt = Date.now()

const counters = {
  connections: 0,
  peakConnections: 0,
  openDocuments: 0,
  loads: 0,
  writes: 0,
  snapshots: 0,
  bytesWritten: 0,
  lastWriteAt: null as number | null,
  authFailures: 0,
  storageFailures: 0,
  lastStorageError: null as string | null,
}

export const metrics = {
  connectionOpened(): void {
    counters.connections += 1
    counters.peakConnections = Math.max(counters.peakConnections, counters.connections)
  },
  connectionClosed(): void {
    counters.connections = Math.max(0, counters.connections - 1)
  },
  documentOpened(): void {
    counters.openDocuments += 1
    counters.loads += 1
  },
  documentClosed(): void {
    counters.openDocuments = Math.max(0, counters.openDocuments - 1)
  },
  documentWritten(bytes: number): void {
    counters.writes += 1
    counters.bytesWritten += bytes
    counters.lastWriteAt = Date.now()
  },
  snapshotWritten(): void {
    counters.snapshots += 1
  },
  authFailed(): void {
    counters.authFailures += 1
  },

  /**
   * A write that never lands is the worst kind of failure: the app looks
   * healthy because the relay still holds every document in memory, and the
   * loss only shows up after a restart. Counting these makes it visible in
   * /health and /api/stats instead of scrolling past in the logs.
   */
  storageFailed(message: string): void {
    counters.storageFailures += 1
    counters.lastStorageError = message.slice(0, 300)
  },
  snapshot(): ServerStats {
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      connections: counters.connections,
      peakConnections: counters.peakConnections,
      openDocuments: counters.openDocuments,
      loads: counters.loads,
      writes: counters.writes,
      snapshots: counters.snapshots,
      bytesWritten: counters.bytesWritten,
      lastWriteAt: counters.lastWriteAt ? new Date(counters.lastWriteAt).toISOString() : null,
      authFailures: counters.authFailures,
      storageFailures: counters.storageFailures,
      lastStorageError: counters.lastStorageError,
    }
  },
}

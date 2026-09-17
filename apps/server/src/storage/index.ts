import { config } from '../config.js'
import { analyseDatabaseUrl, redactDatabaseUrl } from './database-url.js'
import { FileStore } from './file-store.js'
import { PostgresStore } from './postgres-store.js'
import type { DocStore } from './types.js'

export * from './types.js'
export * from './database-url.js'

export function createStore(): DocStore {
  if (config.storageDriver === 'postgres') {
    // Checked before the pool is built, so a bad connection string is reported
    // as a bad connection string rather than as whatever the driver happens to
    // throw thirty seconds later.
    const problems = analyseDatabaseUrl(config.databaseUrl)

    for (const problem of problems.filter((entry) => entry.level === 'warning')) {
      console.warn(`[storage] WARNING: ${problem.message}`)
    }

    const errors = problems.filter((problem) => problem.level === 'error')
    if (errors.length > 0) {
      const detail = errors.map((problem) => `  - ${problem.message}`).join('\n')
      throw new Error(`Cannot start with STORAGE_DRIVER=postgres:\n${detail}`)
    }

    console.log(`[storage] postgres -> ${redactDatabaseUrl(config.databaseUrl)}`)
    return new PostgresStore(config.databaseUrl)
  }
  return new FileStore(config.dataDir)
}

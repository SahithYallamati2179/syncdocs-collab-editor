import { config } from '../config.js'
import { FileStore } from './file-store.js'
import { PostgresStore } from './postgres-store.js'
import type { DocStore } from './types.js'

export * from './types.js'

export function createStore(): DocStore {
  if (config.storageDriver === 'postgres') {
    if (!config.databaseUrl) {
      throw new Error('STORAGE_DRIVER=postgres requires DATABASE_URL to be set.')
    }
    return new PostgresStore(config.databaseUrl)
  }
  return new FileStore(config.dataDir)
}

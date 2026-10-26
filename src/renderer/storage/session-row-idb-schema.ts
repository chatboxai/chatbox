import { MESSAGE_TREE, TREE_MESSAGE_ID } from './session-row-idb-tree'
import { reportDbOpenSucceeded, toDbOpenError, watchDbOpenBlocked, watchDbVersionChange } from './db-schema-guard'

interface IndexSchema {
  name: string
  keyPath: string | string[]
  unique?: boolean
}
interface StoreSchema {
  name: string
  keyPath: string[]
  indexes?: IndexSchema[]
}
const index = (name: string, ...keyPath: string[]): IndexSchema => ({ name, keyPath })
const sessionIndex: IndexSchema = { name: 'bySession', keyPath: 'sessionId' }
const schema: StoreSchema[] = [
  { name: 'threads', keyPath: ['sessionId', 'threadId'], indexes: [sessionIndex] },
  { name: 'messages', keyPath: ['sessionId', 'messageId'], indexes: [sessionIndex] },
  { name: 'tokenCache', keyPath: ['sessionId', 'messageId', 'cacheKey'] },
  { name: 'rowTransferStage', keyPath: ['stageId', 'kind', 'id'] },
  {
    name: 'transcriptThreads',
    keyPath: ['sessionId', 'threadId'],
    indexes: [
      sessionIndex,
      index('bySummaryOrder', 'sessionId', 'searchOrder', 'threadId'),
      index('bySessionNonemptyOrder', 'sessionId', 'nonempty', 'order', 'threadId'),
    ],
  },
  {
    name: MESSAGE_TREE,
    keyPath: ['sessionId', 'threadId', 'messageId'],
    indexes: [
      { name: TREE_MESSAGE_ID, keyPath: ['sessionId', 'messageId'], unique: true },
      index('byStatus', 'status', 'sessionId', 'threadId', 'messageId'),
    ],
  },
]
function sameKeyPath(actual: string | string[] | null, expected: string | string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

/** Check every present object before adding anything. A shape conflict must preserve the disk. */
function inspect(db: IDBDatabase, tx: IDBTransaction, create: boolean): boolean {
  let missing = false
  for (const definition of schema) {
    if (!db.objectStoreNames.contains(definition.name)) {
      missing = true
      if (!create) continue
      db.createObjectStore(definition.name, { keyPath: definition.keyPath })
    }
    const store = tx.objectStore(definition.name)
    if (!sameKeyPath(store.keyPath, definition.keyPath) || store.autoIncrement)
      throw new Error(`Incompatible IndexedDB store: ${definition.name}`)
    for (const definitionIndex of definition.indexes ?? []) {
      if (!store.indexNames.contains(definitionIndex.name)) {
        missing = true
        if (!create) continue
        store.createIndex(definitionIndex.name, definitionIndex.keyPath, definitionIndex)
      }
      const stored = store.index(definitionIndex.name)
      if (
        !sameKeyPath(stored.keyPath, definitionIndex.keyPath) ||
        stored.unique !== (definitionIndex.unique ?? false) ||
        stored.multiEntry
      )
        throw new Error(`Incompatible IndexedDB index: ${definition.name}.${definitionIndex.name}`)
    }
  }
  return missing
}

/** Versionless probe followed by a conditional additive upgrade, fenced against close/reinitialize. */
export async function openSessionRowDatabase(
  name: string,
  isCurrent: () => boolean,
  onReleased: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
  function open(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version)
      let failure: unknown
      watchDbOpenBlocked(name, request)
      request.onupgradeneeded = () => {
        try {
          if (!isCurrent()) throw new Error('Session row database opening was canceled')
          const tx = request.transaction!
          inspect(request.result, tx, false)
          inspect(request.result, tx, true)
        } catch (error) {
          failure = error
          request.transaction!.abort()
        }
      }
      request.onerror = () => reject(failure ?? request.error)
      request.onsuccess = () => {
        const db = request.result
        if (!isCurrent()) {
          db.close()
          reject(new Error('Session row database opening was canceled'))
          return
        }
        watchDbVersionChange(name, db, () => onReleased(db))
        resolve(db)
      }
    })
  }
  try {
    let nextVersion: number | undefined
    for (let attempt = 0; attempt < 4; attempt++) {
      let db: IDBDatabase
      try {
        db = await open(nextVersion)
      } catch (error) {
        if (nextVersion !== undefined && error instanceof DOMException && error.name === 'VersionError') {
          nextVersion = undefined
          continue
        }
        throw error
      }
      try {
        const present = schema.map(({ name }) => name).filter((name) => db.objectStoreNames.contains(name))
        // IndexedDB rejects empty transaction scopes. A database with no required stores needs an upgrade.
        const missing = present.length === 0 || inspect(db, db.transaction(present, 'readonly'), false)
        if (!missing) {
          reportDbOpenSucceeded(name)
          return db
        }
        nextVersion = db.version + 1
      } catch (error) {
        db.close()
        throw error
      }
      db.close()
    }
    throw new Error('Session row database schema changed repeatedly; retry initialization')
  } catch (error) {
    throw toDbOpenError(name, error)
  }
}

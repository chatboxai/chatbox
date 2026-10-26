import { MESSAGE_TREE } from './session-row-idb-tree'
import { readTreeMessage, encodeTreeMetadata } from './session-row-idb-tree'
import { v4 as uuid } from 'uuid'
import {
  SessionRowConflictError,
  validTokenCachedValue,
  validTokenCacheResult,
  validateTokenCacheRequest,
  type SessionTokenCacheRequest,
  type SessionTokenCacheResult,
  type SessionTokenCacheEntry,
  type SessionTokenCachedValue,
} from '@chatbox/core/ports'
import type { TranscriptMessageMetadata } from '@chatbox/core/persistence'
import { readTranscriptCommit } from './session-row-idb-transcript'
import { SESSION_ROW_THREAD_STORE, SESSION_ROW_TOKEN_CACHE_STORE } from './session-row-idb-records'

interface StoredTokenValue {
  sessionId: string
  messageId: string
  cacheKey: string
  payloadId: string
  value: SessionTokenCachedValue
}
const get = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
async function transaction<T>(db: IDBDatabase, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = db.transaction([SESSION_ROW_THREAD_STORE, MESSAGE_TREE, SESSION_ROW_TOKEN_CACHE_STORE], 'readwrite')
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Token cache transaction aborted'))
  })
  try {
    const value = await action(tx)
    await done
    return value
  } catch (error) {
    try {
      tx.abort()
    } catch {}
    await done.catch(() => {})
    throw error
  }
}
export async function readIndexedDBTokenCache(db: IDBDatabase, request: SessionTokenCacheRequest) {
  validateTokenCacheRequest(request)
  return transaction(db, async (tx) => {
    const commit = await readTranscriptCommit(tx, request.sessionId)
    if (commit?.revision !== request.expectedRevision)
      throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit?.revision ?? null)
    const metadata = tx.objectStore(MESSAGE_TREE)
    const cache = tx.objectStore(SESSION_ROW_TOKEN_CACHE_STORE)
    const entries: SessionTokenCacheEntry[] = []
    for (const messageId of new Set(request.messageIds)) {
      const row = await readTreeMessage(tx, request.sessionId, messageId)
      if (!row) continue
      if (!row.tokenPayloadId) {
        row.tokenPayloadId = uuid()
        await get(metadata.put(encodeTreeMetadata(row)))
      }
      const cached = await get<StoredTokenValue | undefined>(
        cache.get([request.sessionId, messageId, request.cacheKey])
      )
      entries.push({
        sessionId: request.sessionId,
        messageId,
        payloadId: row.tokenPayloadId,
        payloadBytes: row.payloadBytes,
        ...(cached?.payloadId === row.tokenPayloadId && validTokenCachedValue(cached.value)
          ? { value: cached.value }
          : {}),
      })
    }
    return { ...commit, entries }
  })
}
export async function acceptIndexedDBTokenCache(
  db: IDBDatabase,
  results: readonly SessionTokenCacheResult[]
): Promise<void> {
  if (results.length > 16) throw new Error('Token cache write exceeds page size')
  await transaction(db, async (tx) => {
    const cache = tx.objectStore(SESSION_ROW_TOKEN_CACHE_STORE)
    for (const result of results) {
      if (!validTokenCacheResult(result)) continue
      const { identity, cacheKey, value } = result
      const row = await readTreeMessage(tx, identity.sessionId, identity.messageId)
      if (row?.tokenPayloadId !== identity.payloadId) continue
      const prior = await get<StoredTokenValue | undefined>(
        cache.get([identity.sessionId, identity.messageId, cacheKey])
      )
      if (prior?.payloadId === identity.payloadId && !prior.value.approximate && value.approximate) continue
      await get(
        cache.put({
          sessionId: identity.sessionId,
          messageId: identity.messageId,
          payloadId: identity.payloadId,
          cacheKey,
          value,
        })
      )
    }
  })
}

import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore, IDBIndex } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { transcriptFixture } from '../../../../packages/chatbox-core/src/ports/testing/session-transcript-contract'
import {
  IndexedDBSessionRowStore,
  SESSION_ROW_DB_NAME,
  SESSION_ROW_MESSAGE_STORE,
  SESSION_ROW_THREAD_STORE,
} from '../SessionRowStorage'
import { TRANSCRIPT_MESSAGES } from '../session-row-idb-transcript'
import { revisionHead } from '../session-row-idb-records'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => vi.restoreAllMocks())

it('reads commit metadata and only the requested transcript bodies', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(transcriptFixture())
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const full = vi.spyOn(store, 'readSnapshot')
  await store.readCommit('transcript')
  expect(
    get.mock.instances.filter((instance) => (instance as IDBObjectStore).name === SESSION_ROW_MESSAGE_STORE)
  ).toHaveLength(0)
  expect(full).not.toHaveBeenCalled()
  get.mockClear()
  await store.readTranscriptWindow({ sessionId: 'transcript', origin: { messageId: 'recent-2' }, limit: 2 })
  expect(
    get.mock.calls
      .filter((_args, index) => (get.mock.instances[index] as IDBObjectStore).name === SESSION_ROW_MESSAGE_STORE)
      .map((args) => args[0])
  ).toEqual([
    ['transcript', 'recent-2'],
    ['transcript', 'recent-3'],
  ])
  store.close()
})

it('rejects malformed revision-head identities and revisions', async () => {
  const store = new IndexedDBSessionRowStore()
  const fixture = transcriptFixture()
  await store.writeRows(fixture)
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve(request.result)
  })
  for (const commit of [
    { ...fixture, record: { ...fixture.record, id: 'wrong' } },
    { ...fixture, revision: 0 },
  ]) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(SESSION_ROW_THREAD_STORE, 'readwrite')
      tx.objectStore(SESSION_ROW_THREAD_STORE).put(revisionHead('transcript', commit))
      tx.oncomplete = () => resolve()
    })
    await expect(store.readCommit('transcript')).rejects.toThrow('commit metadata')
  }
  db.close()
  store.close()
})

it('preserves complete Unicode bodies and their byte counts in transcript pages', async () => {
  const store = new IndexedDBSessionRowStore()
  const fixture = transcriptFixture()
  const message = fixture.rows.messages[0].message
  const text = '工具🦋"\\\u0000'.repeat(40_000)
  message.contentParts = [{ type: 'text', text }]
  const serialized = JSON.stringify(message)
  const payloadBytes = new TextEncoder().encode(serialized).length
  expect(payloadBytes).toBeGreaterThan(256 * 1024)
  expect(payloadBytes).toBeGreaterThan(serialized.length)
  await store.writeRows(fixture)
  const page = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 1 })
  expect(page?.payloadBytes).toBe(payloadBytes)
  expect(page?.messages[0].message).toEqual(message)

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  expect(db.objectStoreNames.contains('payloads')).toBe(false)
  const storedRow = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(SESSION_ROW_MESSAGE_STORE, 'readonly')
    const request = tx.objectStore(SESSION_ROW_MESSAGE_STORE).get(['transcript', message.id])
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
  expect(storedRow).toEqual({ ...fixture.rows.messages[0], selectedDepth: 0 })
  const storedMetadata = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(TRANSCRIPT_MESSAGES, 'readonly')
    const request = tx.objectStore(TRANSCRIPT_MESSAGES).get(['transcript', message.id])
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
  expect(storedMetadata).toHaveProperty('payloadBytes', payloadBytes)
  expect(storedMetadata).not.toHaveProperty('navigation')
  expect((await store.readCommit('transcript'))?.revision).toBe(1)
  db.close()
  store.close()
})

it('reads selected bodies using only the revision head and requested message ids', async () => {
  const store = new IndexedDBSessionRowStore()
  const fixture = transcriptFixture()
  const archived = fixture.rows.threads.find((thread) => thread.seq !== -1)!
  fixture.rows.threads.push(
    ...Array.from({ length: 100 }, (_, index) => ({
      ...archived,
      threadId: `empty-${index}`,
      seq: index + 100,
      rootMessageId: null,
      activeLeafMessageId: null,
    }))
  )
  await store.writeRows(fixture)
  const all = vi.spyOn(IDBIndex.prototype, 'getAll')
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const result = await store.readMessages({
    sessionId: 'transcript',
    messageIds: ['recent-2', 'old-0', 'recent-2', 'missing'],
    expectedRevision: 1,
  })
  expect(result?.messages.map((row) => row.messageId)).toEqual(['recent-2', 'old-0'])
  expect(all).not.toHaveBeenCalled()
  expect(
    get.mock.calls.filter(
      (_call, index) => (get.mock.instances[index] as IDBObjectStore).name === SESSION_ROW_THREAD_STORE
    )
  ).toHaveLength(1)
  expect(
    get.mock.calls
      .filter((_call, index) => (get.mock.instances[index] as IDBObjectStore).name === SESSION_ROW_MESSAGE_STORE)
      .map(([key]) => key)
  ).toEqual([
    ['transcript', 'recent-2'],
    ['transcript', 'old-0'],
    ['transcript', 'missing'],
  ])
  await expect(
    store.readMessages({ sessionId: 'transcript', messageIds: ['old-0'], expectedRevision: 2 })
  ).rejects.toMatchObject({ name: 'SessionRowConflictError' })
  store.close()
})

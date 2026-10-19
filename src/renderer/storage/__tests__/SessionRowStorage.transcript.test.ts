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

it('uses only thin stores for commit, navigation, and target ancestry', async () => {
  const store = new IndexedDBSessionRowStore()
  await store.writeRows(transcriptFixture())
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const full = vi.spyOn(store, 'readSnapshot')
  await store.readCommit('transcript')
  await store.readNavigationPage({ sessionId: 'transcript', origin: 'head', limit: 3 })
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

it('upgrades v2 rows additively and can repair missing projections without changing the commit', async () => {
  const fixture = transcriptFixture()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(SESSION_ROW_DB_NAME, 2)
    open.onupgradeneeded = () => {
      const threads = open.result.createObjectStore(SESSION_ROW_THREAD_STORE, { keyPath: ['sessionId', 'threadId'] })
      threads.createIndex('bySession', 'sessionId')
      const messages = open.result.createObjectStore(SESSION_ROW_MESSAGE_STORE, { keyPath: ['sessionId', 'messageId'] })
      messages.createIndex('bySession', 'sessionId')
      for (const row of fixture.rows.threads) threads.put(row)
      threads.put(revisionHead('transcript', fixture))
      for (const row of fixture.rows.messages) messages.put(row)
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  db.close()
  const store = new IndexedDBSessionRowStore()
  await store.initialize()
  expect(
    (await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'tail', limit: 2 }))?.messages.map(
      (row) => row.messageId
    )
  ).toEqual(['active-1', 'active-2'])
  const upgraded = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve(request.result)
  })
  expect(upgraded.version).toBe(3)
  await new Promise<void>((resolve) => {
    const tx = upgraded.transaction(TRANSCRIPT_MESSAGES, 'readwrite')
    const request = tx.objectStore(TRANSCRIPT_MESSAGES).get(['transcript', 'old-0'])
    request.onsuccess = () => {
      const { navigation: _navigation, ...row } = request.result
      tx.objectStore(TRANSCRIPT_MESSAGES).put(row)
    }
    tx.oncomplete = () => resolve()
  })
  expect(
    (await store.readNavigationPage({ sessionId: 'transcript', origin: 'head', limit: 1 }))?.needsProjection
  ).toEqual(['old-0'])
  await store.repairNavigationProjections({ sessionId: 'transcript', messageIds: ['old-0'], expectedRevision: 1 })
  expect(
    (await store.readNavigationPage({ sessionId: 'transcript', origin: 'head', limit: 1 }))?.needsProjection
  ).toEqual([])
  expect((await store.readCommit('transcript'))?.revision).toBe(1)
  upgraded.close()
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

it('reuses the chunk manifest size when writing and repairing long-message navigation', async () => {
  const store = new IndexedDBSessionRowStore()
  const fixture = transcriptFixture()
  const message = fixture.rows.messages[0].message
  message.contentParts = [{ type: 'text', text: 'x'.repeat(256 * 1024) }]
  const payloadBytes = new TextEncoder().encode(JSON.stringify(message)).length
  const stringify = vi.spyOn(JSON, 'stringify')
  await store.writeRows(fixture)
  expect(stringify.mock.calls.some(([value]) => value === message)).toBe(false)
  const page = await store.readTranscriptWindow({ sessionId: 'transcript', origin: 'head', limit: 1 })
  expect(page?.payloadBytes).toBe(payloadBytes)
  expect(
    (await store.readNavigationPage({ sessionId: 'transcript', origin: 'head', limit: 1 }))?.entries[0].preview
  ).toHaveLength(300)
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

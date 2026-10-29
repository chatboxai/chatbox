import { MESSAGE_TREE } from '../session-row-idb-tree'
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
import { REVISION_HEAD_THREAD_ID, revisionHead } from '../session-row-idb-records'

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
  expect(storedRow).toMatchObject({
    message: fixture.rows.messages[0].message,
    messageId: message.id,
    siblingOrder: fixture.rows.messages[0].siblingOrder,
  })
  expect(storedRow).not.toHaveProperty('selectedDepth')
  expect(storedRow).not.toHaveProperty('selected')
  const storedMetadata = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(MESSAGE_TREE, 'readonly')
    const request = tx.objectStore(MESSAGE_TREE).index('byMessage').get(['transcript', message.id])
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
  const archived = fixture.rows.threads.find((thread) => thread.threadOrder !== -1)!
  fixture.rows.threads.push(
    ...Array.from({ length: 100 }, (_, index) => ({
      ...archived,
      threadId: `empty-${index}`,
      threadOrder: index + 100,
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

it.each([false, true])(
  'traverses sparse archive orders and consecutive empty threads with empty active=%s',
  async (emptyActive) => {
    const store = new IndexedDBSessionRowStore()
    try {
      const fixture = transcriptFixture(emptyActive)
      for (const thread of fixture.rows.threads)
        if (thread.threadOrder >= 0) thread.threadOrder = thread.threadOrder * 10 + 4
      const empty = fixture.rows.threads.find((thread) => thread.threadId === 'empty')!
      for (const threadOrder of [1, 15, 40])
        fixture.rows.threads.push({ ...empty, threadId: `empty-${threadOrder}`, threadOrder })
      fixture.rows.threads.reverse()
      await store.writeRows(fixture)
      const neighboring = transcriptFixture()
      neighboring.rows.sessionId = neighboring.record.id = 'transcript-next'
      for (const row of [...neighboring.rows.threads, ...neighboring.rows.messages]) row.sessionId = 'transcript-next'
      await store.writeRows(neighboring)

      const collect = async (direction: 'older' | 'newer') => {
        let page = await store.readTranscriptWindow({
          sessionId: 'transcript',
          origin: direction === 'newer' ? 'head' : 'tail',
          limit: 4,
        })
        let result: string[] = []
        for (let remaining = 8; remaining > 0; remaining--) {
          if (!page) throw new Error('Expected transcript page')
          expect(page.messages.every((row) => row.sessionId === 'transcript')).toBe(true)
          const ids = page.messages.map((row) => row.messageId)
          result = direction === 'newer' ? [...result, ...ids] : [...ids, ...result]
          const cursor = page[direction]
          if (!cursor) return result
          page = await store.readTranscriptWindow({ sessionId: 'transcript', cursor, limit: 4 })
        }
        throw new Error('Transcript pagination did not terminate')
      }
      const expected = [
        'old-0',
        'old-1',
        'old-2',
        'recent-0',
        'recent-1',
        'recent-2',
        'recent-3',
        ...(emptyActive ? [] : ['active-0', 'active-1', 'active-2']),
      ]
      expect(await collect('newer')).toEqual(expected)
      expect(await collect('older')).toEqual(expected)
      expect((await store.readThread({ sessionId: 'transcript', threadId: 'empty-40' }))?.thread).toMatchObject({
        threadId: 'empty-40',
        rootMessageId: null,
        threadOrder: 40,
      })
      const anchor = await store.readTranscriptWindow({
        sessionId: 'transcript',
        origin: { threadId: 'empty-40', edge: 'head' },
        limit: 2,
      })
      expect(anchor?.messages).toEqual([])
      expect(anchor?.anchor).toEqual({ threadId: 'empty-40', messageId: null })
      expect(anchor?.newer === null).toBe(emptyActive)
      expect(await store.readThread({ sessionId: 'transcript', threadId: REVISION_HEAD_THREAD_ID })).toBeNull()
    } finally {
      store.close()
    }
  }
)

it('stores canonical thread fields and returns lightweight thread views', async () => {
  const store = new IndexedDBSessionRowStore()
  const fixture = transcriptFixture()
  await store.writeRows(fixture)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const tx = db.transaction(SESSION_ROW_THREAD_STORE, 'readonly')
    const requests = fixture.rows.threads.map((thread) =>
      tx.objectStore(SESSION_ROW_THREAD_STORE).get([thread.sessionId, thread.threadId])
    )
    const persisted = await Promise.all(
      requests.map(
        (request) =>
          new Promise<unknown>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
      )
    )
    expect(persisted).toEqual(fixture.rows.threads)
    for (const thread of persisted) {
      expect(thread).not.toHaveProperty('nonempty')
      expect(thread).not.toHaveProperty('order')
      expect(thread).not.toHaveProperty('searchOrder')
    }
    const read = await store.readThread({ sessionId: 'transcript', threadId: 'old' })
    expect(read?.thread).toMatchObject({
      threadOrder: 0,
      summary: fixture.rows.threads.find((thread) => thread.threadId === 'old')!.summary,
      control: { generatingAssistantCount: 0 },
    })
    expect(read?.thread).not.toHaveProperty('compactionPoints')
  } finally {
    db.close()
    store.close()
  }
})

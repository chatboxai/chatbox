import 'fake-indexeddb/auto'
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  createSessionRowRelationsContract,
  generatingRelationFixture,
  relationFixture,
} from '../../../../packages/chatbox-core/src/ports/testing/session-row-relations-contract'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { SESSION_ROW_DB_NAME, SESSION_ROW_MESSAGE_STORE } from '../session-row-idb-records'
const stores: IndexedDBSessionRowStore[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  while (stores.length) stores.pop()?.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})
describe('IndexedDB row relations', () => {
  for (const test of createSessionRowRelationsContract(() => {
    const store = new IndexedDBSessionRowStore()
    stores.push(store)
    return store
  }))
    it(test.name, test.run)
})

it('reads generating metadata from one shared thread graph without loading bodies', async () => {
  const store = new IndexedDBSessionRowStore()
  stores.push(store)
  await store.writeRows(generatingRelationFixture())
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const cursor = vi.spyOn(IDBIndex.prototype, 'openKeyCursor')
  const page = await store.readMessageRelationsPage({
    sessionId: 'transcript',
    threadId: 'old',
    expectedRevision: 1,
    selector: { kind: 'status', status: 'generating' },
    limit: 200,
  })
  expect(page?.status === 'ready' && page.rows.length).toBe(200)
  expect(cursor).not.toHaveBeenCalled()
  expect(
    get.mock.instances.filter((item) => [SESSION_ROW_MESSAGE_STORE].includes((item as IDBObjectStore).name))
  ).toHaveLength(0)
  expect(get.mock.instances.filter((item) => (item as IDBObjectStore).name === 'messageTree')).toHaveLength(0)
})

it('invalidates prefetched links after another window commits a different path', async () => {
  const first = new IndexedDBSessionRowStore(),
    other = new IndexedDBSessionRowStore()
  stores.push(first, other)
  const snapshot = relationFixture()
  await first.writeRows(snapshot)
  await first.prefetchThreadLinks({ sessionId: 'transcript', threadId: 'old', expectedRevision: 1 })
  snapshot.revision = 2
  snapshot.rows.messages.find((row) => row.messageId === 'old-0')!.activeChildId = 'inactive'
  snapshot.rows.threads.find((row) => row.threadId === 'old')!.activeLeafMessageId = 'inactive'
  await other.writeRows(snapshot, 1)
  const membership = await first.readMessageMetadata({
    sessionId: 'transcript',
    messageIds: ['old-1', 'inactive'],
    expectedRevision: 2,
  })
  expect(membership?.status === 'ready' && membership.rows.map((row) => row.selected)).toEqual([false, true])
})

it('discards an aborted background prefetch and reloads on the next request', async () => {
  const store = new IndexedDBSessionRowStore()
  stores.push(store)
  await store.writeRows(relationFixture())
  const controller = new AbortController()
  controller.abort()
  await expect(
    store.prefetchThreadLinks({
      sessionId: 'transcript',
      threadId: 'old',
      expectedRevision: 1,
      signal: controller.signal,
    })
  ).rejects.toThrow()
  await expect(
    store.prefetchThreadLinks({ sessionId: 'transcript', threadId: 'old', expectedRevision: 1 })
  ).resolves.toBeUndefined()
})

it.each([1, 2, 3])('pages thread summaries across sparse archive orders with a limit of %i', async (limit) => {
  const store = new IndexedDBSessionRowStore()
  stores.push(store)
  const fixture = relationFixture()
  for (const thread of fixture.rows.threads)
    if (thread.threadOrder >= 0) thread.threadOrder = thread.threadOrder * 10 + 4
  await store.writeRows(fixture)
  const neighboring = relationFixture()
  neighboring.rows.sessionId = neighboring.record.id = 'transcript-next'
  for (const row of [...neighboring.rows.threads, ...neighboring.rows.messages]) row.sessionId = 'transcript-next'
  await store.writeRows(neighboring)

  const first = await store.readThreadSummariesPage({ sessionId: 'transcript', limit })
  if (!first?.nextCursor) throw new Error('Expected thread page continuation')
  const threads = [...first.threads]
  let cursor = first.nextCursor
  for (let remaining = 4; remaining > 0; remaining--) {
    const page = await store.readThreadSummariesPage({ sessionId: 'transcript', limit, cursor })
    if (!page) throw new Error('Expected thread page')
    expect(page.revision).toBe(1)
    threads.push(...page.threads)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }
  expect(threads.map((thread) => [thread.threadId, thread.threadOrder, thread.summary?.messageCount])).toEqual([
    ['active', -1, 3],
    ['recent', 24, 4],
    ['empty', 14, 0],
    ['old', 4, 3],
  ])
  expect(threads.every((thread) => thread.sessionId === 'transcript')).toBe(true)
  expect(threads.every((thread) => thread.control?.generatingAssistantCount === 0)).toBe(true)
  await expect(
    store.readThreadSummariesPage({ sessionId: 'transcript-next', limit, cursor: first.nextCursor })
  ).rejects.toThrow('Invalid thread summary page')

  await store.writeRows({ ...fixture, revision: 2 }, 1)
  await expect(
    store.readThreadSummariesPage({ sessionId: 'transcript', limit, cursor: first.nextCursor })
  ).rejects.toMatchObject({ name: 'SessionRowConflictError' })
})

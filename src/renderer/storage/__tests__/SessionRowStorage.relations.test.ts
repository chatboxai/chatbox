import 'fake-indexeddb/auto'
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  createSessionRowRelationsContract,
  generatingRelationFixture,
} from '../../../../packages/chatbox-core/src/ports/testing/session-row-relations-contract'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { SESSION_ROW_DB_NAME, SESSION_ROW_MESSAGE_STORE, SESSION_ROW_PAYLOAD_STORE } from '../session-row-idb-records'
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

it('reads generating identities through index keys and hydrates only metadata', async () => {
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
  expect(cursor).toHaveBeenCalledTimes(1)
  expect(
    get.mock.instances.filter((item) =>
      [SESSION_ROW_MESSAGE_STORE, SESSION_ROW_PAYLOAD_STORE].includes((item as IDBObjectStore).name)
    )
  ).toHaveLength(0)
  expect(get.mock.instances.filter((item) => (item as IDBObjectStore).name === 'transcriptMessages')).toHaveLength(201)
})

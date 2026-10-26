import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { testTokenCache } from '../../../../packages/chatbox-core/src/ports/testing/session-token-cache-contract'
import { IndexedDBSessionRowStore, SESSION_ROW_MESSAGE_STORE } from '../SessionRowStorage'
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => vi.restoreAllMocks())
it('reads and accepts counts from thin projections while payload updates invalidate them', async () => {
  const store = new IndexedDBSessionRowStore()
  await testTokenCache(store)
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  await store.readTokenCache({
    sessionId: 'transcript',
    messageIds: ['active-2'],
    expectedRevision: 3,
    cacheKey: 'history-breakdown-v1:default:0:0',
  })
  expect(get.mock.instances.map((objectStore) => (objectStore as IDBObjectStore).name)).not.toContain(
    SESSION_ROW_MESSAGE_STORE
  )
  expect(get.mock.instances.map((objectStore) => (objectStore as IDBObjectStore).name)).not.toContain('payloads')
  store.close()
})

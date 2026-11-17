import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { contextSnapshot } from '../../../../packages/chatbox-core/src/persistence/session-context-read.test-support'
import {
  testTokenCache,
  tokenCacheKey,
} from '../../../../packages/chatbox-core/src/ports/testing/session-token-cache-contract'
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

it.each([1, 16, 17, 100])('persists a batch of %i token counts across database reopen', async (count) => {
  const store = new IndexedDBSessionRowStore()
  const snapshot = contextSnapshot({
    id: 'batch',
    type: 'chat',
    name: 'Batch',
    messages: Array.from({ length: count }, (_, index) => ({
      id: `message-${index}`,
      role: 'user',
      contentParts: [{ type: 'text', text: `Message ${index}` }],
    })),
  })
  await store.writeRows(snapshot)
  const request = {
    sessionId: 'batch',
    messageIds: snapshot.rows.messages.map((row) => row.messageId),
    expectedRevision: 1,
    cacheKey: tokenCacheKey,
  }
  const initial = await store.readTokenCache(request)
  expect(initial?.entries).toHaveLength(count)
  const value = { text: 12, attachments: 0, toolCalls: 0, approximate: false }
  const results = initial!.entries.map((identity) => ({ identity, cacheKey: tokenCacheKey, value }))
  try {
    await expect(
      store.acceptTokenCache(Array.from({ length: 101 }, (_, index) => results[index % count]))
    ).rejects.toThrow('Token cache write exceeds page size')
    expect((await store.readTokenCache(request))?.entries.every((entry) => entry.value === undefined)).toBe(true)
    await store.acceptTokenCache(results)
    store.close()
    const reopened = await store.readTokenCache(request)
    expect(reopened?.entries).toHaveLength(count)
    expect(reopened?.entries.map((entry) => entry.value)).toEqual(Array.from({ length: count }, () => value))
  } finally {
    store.close()
  }
})

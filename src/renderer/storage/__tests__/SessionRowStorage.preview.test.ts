import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  branchPreviewFixture,
  createSessionBranchPreviewContract,
  previewMessage,
} from '../../../../packages/chatbox-core/src/ports/testing/session-branch-preview-contract'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { SESSION_ROW_DB_NAME, SESSION_ROW_MESSAGE_STORE } from '../session-row-idb-records'

const stores: IndexedDBSessionRowStore[] = []
function createStore() {
  const store = new IndexedDBSessionRowStore()
  stores.push(store)
  return store
}
afterEach(async () => {
  vi.restoreAllMocks()
  while (stores.length) stores.pop()?.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SESSION_ROW_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('IndexedDB compact branch preview', () => {
  for (const test of createSessionBranchPreviewContract(createStore)) it(test.name, test.run)

  it.each([1200, 2000])(
    'aggregates a %i follow-up path in one readonly transaction without loading bodies',
    async (count) => {
      const store = createStore()
      await store.writeRows(
        branchPreviewFixture([
          previewMessage('user', 'user'),
          ...Array.from({ length: count }, (_, index) => previewMessage(`a${index}`, 'assistant')),
        ])
      )
      const relations = vi.spyOn(store, 'readMessageRelationsPage')
      const metadata = vi.spyOn(store, 'readMessageMetadata')
      const bodies = vi.spyOn(store, 'readMessages')
      const snapshots = vi.spyOn(store, 'readSnapshot')
      const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
      const get = vi.spyOn(IDBObjectStore.prototype, 'get')
      const all = vi.spyOn(IDBObjectStore.prototype, 'getAll')
      const preview = await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user' })
      expect(preview).toEqual({
        sessionId: 'transcript',
        revision: 1,
        threadId: 'old',
        headMessageId: 'user',
        headRole: 'user',
        pairedReplyMessageId: 'a0',
        followupCount: count - 1,
      })
      for (const read of [relations, metadata, bodies, snapshots]) expect(read).not.toHaveBeenCalled()
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(transaction.mock.calls[0][1]).toBe('readonly')
      expect(
        get.mock.instances.filter((store) => [SESSION_ROW_MESSAGE_STORE].includes((store as IDBObjectStore).name))
      ).toHaveLength(0)
      expect(
        all.mock.instances.filter((store) =>
          [SESSION_ROW_MESSAGE_STORE, 'transcriptMessages'].includes((store as IDBObjectStore).name)
        )
      ).toHaveLength(0)
    }
  )

  it('keeps one consistent revision while a concurrent branch change waits for the read transaction', async () => {
    const store = createStore()
    await store.writeRows(branchPreviewFixture([previewMessage('user', 'user'), previewMessage('reply', 'assistant')]))
    const originalGet = IDBObjectStore.prototype.get
    let changedWrite: Promise<unknown> | undefined
    let queued = false
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      const request = originalGet.call(this, key)
      if (!queued && this.name === 'transcriptMessages') {
        queued = true
        const changed = branchPreviewFixture([
          previewMessage('user', 'user'),
          previewMessage('reply', 'assistant'),
          previewMessage('later', 'user'),
        ])
        changed.revision = 2
        changedWrite = store.writeRows(changed, 1)
      }
      return request
    })
    expect(
      await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 1 })
    ).toMatchObject({ revision: 1, followupCount: 0 })
    expect(queued).toBe(true)
    await changedWrite
    expect(
      await store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user', expectedRevision: 2 })
    ).toMatchObject({ revision: 2, followupCount: 1 })
  })
})

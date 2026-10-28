import 'fake-indexeddb/auto'
import type { SessionStoredRow } from '@chatbox/core/ports'
import { storageRowFixture } from '@chatbox/core/ports/testing/session-row-fixtures'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { transcriptFixture } from '../../../../packages/chatbox-core/src/ports/testing/session-transcript-contract'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { REVISION_HEAD_THREAD_ID, SESSION_ROW_THREAD_STORE } from '../session-row-idb-records'

const opened: IndexedDBSessionRowStore[] = []
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const store of opened.splice(0)) store.close()
})

function setup() {
  const store = new IndexedDBSessionRowStore()
  opened.push(store)
  return store
}

it('reads the export header once and iterates complete rows without repeated head requests', async () => {
  const store = setup()
  const source = storageRowFixture(transcriptFixture())
  source.rows.messages[0].message.contentParts = [{ type: 'text', text: '完整正文😀\u0000'.repeat(40000) }]
  await store.writeRows(source)
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  expect(await store.readExportCommit(source.record.id)).toEqual({ record: source.record, revision: source.revision })
  expect(get.mock.calls).toEqual([[[source.record.id, REVISION_HEAD_THREAD_ID]]])
  get.mockClear()
  const rows: SessionStoredRow[] = []
  for await (const row of store.iterateRows({ sessionId: source.record.id, consistency: 'export' })) rows.push(row)
  expect(
    rows
      .filter((row) => row.kind === 'thread')
      .map((row) => row.thread.threadId)
      .sort()
  ).toEqual(source.rows.threads.map((row) => row.threadId).sort())
  expect(
    rows
      .filter((row) => row.kind === 'message')
      .map((row) => row.message)
      .sort(byMessageId)
  ).toEqual([...source.rows.messages].sort(byMessageId))
  expect(
    get.mock.instances.filter((instance) => (instance as IDBObjectStore).name === SESSION_ROW_THREAD_STORE)
  ).toHaveLength(0)
})

it('preserves cancellation and rejects revision requirements during export iteration', async () => {
  const store = setup()
  const source = storageRowFixture(transcriptFixture())
  await store.writeRows(source)
  const invalid = store.iterateRows({ sessionId: source.record.id, consistency: 'export', expectedRevision: 1 })
  await expect(invalid.next()).rejects.toThrow('Export row iteration cannot require a revision')

  const controller = new AbortController()
  const rows = store.iterateRows({ sessionId: source.record.id, consistency: 'export', signal: controller.signal })
  expect(await rows.next()).toMatchObject({ done: false, value: { kind: 'thread' } })
  controller.abort()
  await expect(rows.next()).rejects.toMatchObject({ name: 'AbortError' })
})

function byMessageId(left: { messageId: string }, right: { messageId: string }): number {
  return left.messageId.localeCompare(right.messageId)
}

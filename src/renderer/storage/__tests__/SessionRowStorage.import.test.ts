import 'fake-indexeddb/auto'
import { prepareSessionRowsFixture } from '@chatbox/core/ports/testing/session-row-fixtures'
import type { MessageRow } from '@chatbox/core/session/session-tree'
import type {
  SessionRowImportIssue,
  SessionRowImportIssueHandler,
  SessionRowImportWriter,
  SessionRowSnapshot,
} from '@chatbox/core/ports'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import {
  REVISION_HEAD_THREAD_ID,
  ROW_TRANSFER_STAGE,
  SESSION_ROW_MESSAGE_STORE,
  SESSION_ROW_THREAD_STORE,
} from '../session-row-idb-records'
const opened: IndexedDBSessionRowStore[] = []
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const row of opened.splice(0)) row.close()
})
it('keeps old live rows when a replacement transaction aborts after deleting them', async () => {
  const rows = store()
  await rows.writeRows(fixture('old'))
  const before = await rows.readSnapshot('import')
  const next = { ...fixture('replacement'), revision: 2 }
  const writer = await rows.stageImportRows(next.record, 'failed-transaction')
  await append(writer, next)
  await writer.prepare()
  const put = IDBObjectStore.prototype.put
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    if (this.name === SESSION_ROW_MESSAGE_STORE) throw new Error('controlled insert failure')
    return put.call(this, value, key)
  })
  await expect(writer.publish()).rejects.toThrow('controlled insert failure')
  failure.mockRestore()
  expect(await rows.readSnapshot('import')).toEqual(before)
  await writer.dispose()
  expect(await rows.readSnapshot('import')).toEqual(before)
})
it('retries an aborted publication using its prepared in-memory index', async () => {
  const rows = store(),
    source = fixture('replacement')
  await rows.writeRows(fixture('old'))
  const before = await rows.readSnapshot(source.record.id)
  const writer = await rows.stageImportRows(source.record, 'retry-publication')
  await append(writer, source)
  await writer.prepare()
  const put = IDBObjectStore.prototype.put
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    const request = put.call(this, value, key)
    if (
      this.name === SESSION_ROW_THREAD_STORE &&
      typeof value === 'object' &&
      value !== null &&
      'commitRevision' in value
    )
      this.transaction.abort()
    return request
  })
  await expect(writer.publish()).rejects.toThrow()
  failure.mockRestore()
  expect(await rows.readSnapshot(source.record.id)).toEqual(before)
  await writer.publish()
  await writer.publish()
  expect(await rows.readSnapshot(source.record.id)).toMatchObject({
    revision: 2,
    rows: { messages: source.rows.messages.map((row) => ({ messageId: row.messageId, message: row.message })) },
  })
})
function store() {
  const result = new IndexedDBSessionRowStore()
  opened.push(result)
  return result
}
function fixture(text = 'body'): SessionRowSnapshot {
  const tree = prepareSessionRowsFixture({
    id: 'import',
    name: 'Import',
    type: 'chat',
    messages: [
      { id: 'a', role: 'user', contentParts: [{ type: 'text', text }] },
      { id: 'b', role: 'assistant', contentParts: [{ type: 'text', text: 'reply' }] },
    ],
  })
  return {
    record: tree.session,
    revision: 1,
    rows: { sessionId: tree.session.id, threads: tree.threads, messages: tree.messages },
  }
}
const append = (writer: SessionRowImportWriter, source: SessionRowSnapshot, onIssue?: SessionRowImportIssueHandler) =>
  writer.appendRows(
    [
      ...source.rows.threads.map((thread) => ({
        kind: 'thread' as const,
        thread: { ...thread, activeLeafMessageId: null },
      })),
      ...source.rows.messages.map((message) => ({ kind: 'message' as const, message })),
    ],
    onIssue
  )
it('keeps staging invisible and preserves committed rows after reopening and cleanup', async () => {
  const rows = store(),
    old = fixture('old')
  await rows.writeRows(old)
  const snapshot = await rows.readSnapshot(old.record.id)
  const next = { ...fixture('new😀'.repeat(40000)), revision: 2 }
  const writer = await rows.stageImportRows(next.record, 'job')
  await append(writer, next)
  await writer.prepare()
  expect(await rows.readSnapshot(old.record.id)).toEqual(snapshot)
  await writer.publish()
  await writer.publish()
  rows.close()
  const reopened = store()
  const result = await reopened.readMessages({ sessionId: old.record.id, messageIds: ['a', 'b'] })
  expect(result?.messages[0].message.contentParts).toEqual(next.rows.messages[0].message.contentParts)
  expect(await membership(reopened, old.record.id, ['a', 'b'], 2)).toEqual([true, true])
  const threadState = await reopened.readThreadState({
    sessionId: old.record.id,
    threadId: old.record.activeThreadId,
    expectedRevision: 2,
  })
  expect(threadState?.status === 'ready' && threadState.thread.summary.messageCount).toBe(2)
  const published = await reopened.readSnapshot(old.record.id)
  reopened.close()
  const recovered = store()
  await recovered.disposeImportRows(writer.candidateId)
  await recovered.disposeImportRows(writer.candidateId)
  expect(await recovered.readSnapshot(old.record.id)).toEqual(published)
})
it('retains published rows during candidate cleanup', async () => {
  const rows = store(),
    source = fixture(),
    writer = await rows.stageImportRows(source.record, 'job')
  await append(writer, source)
  await writer.prepare()
  await writer.publish()
  await writer.dispose()
  expect(await rows.hasRows(source.record.id)).toBe(true)
})
it.each(['cycle', 'missing-parent', 'compaction', 'duplicate-sibling'])(
  'preserves usable imported rows and reports repaired relationships: %s',
  async (kind) => {
    const rows = store(),
      source = fixture()
    if (kind === 'missing-parent') source.rows.messages[1].parentMessageId = 'absent'
    if (kind === 'cycle')
      source.rows.messages.push(
        ...['c', 'd'].map((id, index) => ({
          ...source.rows.messages[1],
          messageId: id,
          parentMessageId: index ? 'c' : 'd',
          activeChildId: null,
          message: { ...source.rows.messages[1].message, id },
        }))
      )
    if (kind === 'compaction')
      source.rows.threads[0].compactionPoints = [{ boundaryMessageId: 'a', summaryMessageId: 'absent', createdAt: 1 }]
    if (kind === 'duplicate-sibling')
      source.rows.messages.push({
        ...source.rows.messages[1],
        messageId: 'c',
        message: { ...source.rows.messages[1].message, id: 'c' },
      })
    const writer = await rows.stageImportRows(source.record, 'job')
    await append(writer, source)
    const issues: SessionRowImportIssue[] = []
    expect(await writer.prepare((issue) => issues.push(issue))).toMatchObject({
      messageCount: kind === 'missing-parent' ? 1 : kind === 'duplicate-sibling' ? 3 : 2,
      skipSession: false,
    })
    expect(issues.length).toBeGreaterThan(0)
    await writer.publish()
    const restored = await rows.readSnapshot(source.record.id)
    expect(restored?.rows.messages.find((row) => row.messageId === 'a')?.message).toEqual(
      source.rows.messages[0].message
    )
    expect(restored?.rows.threads[0].compactionPoints).toEqual([])
    if (kind === 'cycle') expect(issues.filter((issue) => issue.action === 'skipped')).toHaveLength(2)
    if (kind === 'duplicate-sibling')
      expect(
        new Set(restored?.rows.messages.filter((row) => row.parentMessageId === 'a').map((row) => row.siblingOrder))
          .size
      ).toBe(2)
    await writer.dispose()
  }
)

it.each([
  { empty: false, converted: false },
  { empty: true, converted: false },
  { empty: false, converted: true },
  { empty: true, converted: true },
])('prepares imported branch navigation: %j', async ({ empty, converted }) => {
  const rows = store(),
    source = fixture('fork'),
    point = source.rows.messages[0],
    selected = source.rows.messages[1]
  point.forkPivotId = point.messageId
  selected.branchId = 'original'
  const other = {
    ...selected,
    messageId: 'other',
    siblingOrder: selected.siblingOrder + 1,
    branchId: 'alternative',
    message: { ...selected.message, id: 'other' },
  }
  source.rows.messages.push(other)
  if (empty) {
    point.activeChildId = null
    point.pendingBranchId = 'empty'
    point.pendingBranchOrder = selected.siblingOrder + 2
  } else point.activeChildId = 'other'
  const expected = {
    pivotId: 'a',
    branchPointId: 'a',
    selectedBranchId: empty ? 'empty' : 'alternative',
    count: empty ? 3 : 2,
    position: empty ? 2 : 1,
  }
  const forks = new Map([['a', expected]])
  const consume = vi.spyOn(forks, Symbol.iterator)
  const writer = await rows.stageImportRows(source.record, 'job')
  await append(writer, source)
  await writer.prepare(undefined, converted ? forks : undefined)
  expect(consume).toHaveBeenCalledTimes(converted ? 1 : 0)
  await writer.publish()
  const result = await rows.readMessages({ sessionId: source.record.id, messageIds: ['a', 'b', 'other'] })
  expect(result?.messages[0].fork).toEqual(expected)
  expect(await membership(rows, source.record.id, ['a', 'b', 'other'], source.revision)).toEqual(
    empty ? [true, false, false] : [true, false, true]
  )
})

it.each(['append-skip', 'repair'])('rebuilds fork projections after %s', async (change) => {
  const rows = store(),
    source = fixture(),
    point = source.rows.messages[0]
  point.forkPivotId = point.messageId
  source.rows.messages[1].branchId = 'original'
  if (change === 'repair') source.rows.threads[0].rootMessageId = 'missing'
  const writer = await rows.stageImportRows(source.record, 'job')
  await append(writer, source)
  if (change === 'append-skip') await writer.appendMessage(source.rows.messages[0])
  const forks = new Map([['a', { pivotId: 'a', branchPointId: 'a', selectedBranchId: 'stale', count: 9, position: 8 }]])
  const consume = vi.spyOn(forks, Symbol.iterator)
  await writer.prepare(undefined, forks)
  expect(consume).not.toHaveBeenCalled()
  await writer.publish()
  const result = await rows.readMessages({ sessionId: source.record.id, messageIds: ['a'] })
  expect(result?.messages[0].fork).toEqual({
    pivotId: 'a',
    branchPointId: 'a',
    selectedBranchId: 'original',
    count: 1,
    position: 0,
  })
})

it('accepts an empty converted fork map while deriving the selected path and summary', async () => {
  const rows = store(),
    source = fixture(),
    writer = await rows.stageImportRows(source.record, 'job')
  await append(writer, source)
  const forks = new Map<string, NonNullable<MessageRow['fork']>>(),
    consume = vi.spyOn(forks, Symbol.iterator)
  await writer.prepare(undefined, forks)
  expect(consume).toHaveBeenCalledOnce()
  await writer.publish()
  const result = await rows.readSnapshot(source.record.id)
  expect(result?.rows.messages.every((row) => !row.fork)).toBe(true)
  expect(await membership(rows, source.record.id, ['a', 'b'], source.revision)).toEqual([true, true])
  expect(result?.rows.threads[0].summary?.messageCount).toBe(2)
})

it('skips thread identities reserved for the persisted revision head', async () => {
  const rows = store(),
    source = fixture()
  source.rows.threads[0].threadId = '__chatbox_internal_revision_head__'
  source.record.activeThreadId = source.rows.threads[0].threadId
  const writer = await rows.stageImportRows(source.record, 'job')
  const issues: SessionRowImportIssue[] = []
  await writer.appendRows([{ kind: 'thread', thread: source.rows.threads[0] }], (issue) => issues.push(issue))
  expect(issues).toEqual([expect.objectContaining({ action: 'skipped', reason: 'invalid-row' })])
  await writer.prepare()
  expect(writer.record.activeThreadId).not.toBe(source.record.activeThreadId)
  await writer.dispose()
  expect(await rows.hasRows(source.record.id)).toBe(false)
})

it('keeps first duplicate IDs and repairs stale references without losing message content', async () => {
  const rows = store(),
    source = fixture('first')
  source.rows.threads[0].rootMessageId = 'absent'
  source.rows.messages[1].activeChildId = 'absent'
  source.rows.messages[1].forkPivotId = 'absent'
  const writer = await rows.stageImportRows(source.record, 'duplicates')
  await append(writer, source)
  const issues: SessionRowImportIssue[] = []
  await writer.appendRows(
    [
      {
        kind: 'message',
        message: {
          ...source.rows.messages[0],
          message: { ...source.rows.messages[0].message, contentParts: [{ type: 'text', text: 'replacement' }] },
        },
      },
    ],
    (issue) => issues.push(issue)
  )
  expect(await writer.prepare((issue) => issues.push(issue))).toMatchObject({ messageCount: 2, skipSession: false })
  await writer.publish()
  const restored = await rows.readSnapshot(source.record.id)
  expect(restored?.rows.messages.find((row) => row.messageId === 'a')?.message).toEqual(source.rows.messages[0].message)
  expect(restored?.rows.messages.find((row) => row.messageId === 'b')).toMatchObject({ activeChildId: null })
  expect(restored?.rows.messages.find((row) => row.messageId === 'b')?.forkPivotId).toBeUndefined()
  expect(issues.map((issue) => issue.reason)).toEqual(
    expect.arrayContaining(['duplicate-row', 'thread-root', 'selected-child', 'fork-reference'])
  )
})

it('marks an entirely unusable candidate for skipping while keeping the existing session', async () => {
  const rows = store(),
    old = fixture('old')
  await rows.writeRows(old)
  const source = { ...fixture('broken'), revision: 2 }
  source.rows.messages[0].parentMessageId = 'missing'
  const writer = await rows.stageImportRows(source.record, 'unusable')
  await append(writer, source)
  const issues: SessionRowImportIssue[] = []
  expect(await writer.prepare((issue) => issues.push(issue))).toMatchObject({ messageCount: 0, skipSession: true })
  expect(await writer.prepare()).toMatchObject({ messageCount: 0, skipSession: true })
  expect(issues.filter((issue) => issue.action === 'skipped')).toHaveLength(2)
  expect((await rows.readSnapshot(source.record.id))?.rows.messages[0].message).toEqual(old.rows.messages[0].message)
  await writer.dispose()
})

it('keeps usable branches, normalizes conflicting sibling order and removes orphan descendants', async () => {
  const rows = store()
  const source = fixture('preserved😀'.repeat(1000))
  const activeThreadId = source.record.activeThreadId
  source.record.activeThreadId = 'missing-active'
  const base = source.rows.messages[1]
  const make = (messageId: string, parentMessageId: string, siblingOrder: number, threadId = base.threadId) => ({
    ...base,
    messageId,
    parentMessageId,
    activeChildId: null,
    siblingOrder,
    threadId,
    message: { ...base.message, id: messageId },
  })
  source.rows.messages.push(
    make('c', 'a', base.siblingOrder),
    make('d', 'a', base.siblingOrder + 1),
    make('orphan', 'absent', 0),
    make('descendant', 'orphan', 0),
    make('missing-thread', 'a', 0, 'absent-thread')
  )
  const writer = await rows.stageImportRows(source.record, 'mixed')
  const issues: SessionRowImportIssue[] = []
  await append(writer, source, (issue) => issues.push(issue))
  expect(await writer.prepare((issue) => issues.push(issue))).toMatchObject({ messageCount: 4, skipSession: false })
  await writer.prepare()
  await writer.publish()
  const restored = await rows.readSnapshot(source.record.id)
  expect(restored?.record.activeThreadId).toBe(activeThreadId)
  expect(restored?.rows.messages.map((row) => row.messageId).sort()).toEqual(['a', 'b', 'c', 'd'])
  expect(
    restored?.rows.messages
      .filter((row) => row.parentMessageId === 'a')
      .map((row) => row.siblingOrder)
      .sort()
  ).toEqual([0, 1, 2])
  expect(restored?.rows.messages.find((row) => row.messageId === 'a')?.message).toEqual(source.rows.messages[0].message)
  expect(issues.filter((issue) => issue.action === 'skipped')).toHaveLength(3)
})

it('does not prune a healthy thread referenced by a broken cross-thread parent', async () => {
  const rows = store()
  const source = fixture('healthy')
  source.rows.threads.push({
    ...source.rows.threads[0],
    threadId: 'broken-thread',
    threadOrder: 0,
    name: 'Broken',
    rootMessageId: '0broken',
  })
  source.rows.messages.push({
    ...source.rows.messages[1],
    messageId: '0broken',
    threadId: 'broken-thread',
    parentMessageId: 'a',
    activeChildId: null,
    message: { ...source.rows.messages[1].message, id: '0broken' },
  })
  const writer = await rows.stageImportRows(source.record, 'cross-thread')
  await append(writer, source)
  const issues: SessionRowImportIssue[] = []
  expect(await writer.prepare((issue) => issues.push(issue))).toMatchObject({ messageCount: 2, skipSession: false })
  await writer.publish()
  const restored = await rows.readSnapshot(source.record.id)
  expect(restored?.rows.messages.map((row) => row.messageId).sort()).toEqual(['a', 'b'])
  expect(restored?.rows.messages.find((row) => row.messageId === 'a')?.message).toEqual(source.rows.messages[0].message)
  expect(issues.filter((issue) => issue.action === 'skipped')).toEqual([expect.objectContaining({ id: '0broken' })])
})

it('accepts the first usable row after same-ID rows with missing threads or invalid identities', async () => {
  const rows = store()
  const source = fixture('usable'),
    first = source.rows.messages[0]
  const writer = await rows.stageImportRows(source.record, 'first-usable')
  const issues: SessionRowImportIssue[] = []
  await writer.appendRows(
    [
      ...source.rows.threads.map((thread) => ({ kind: 'thread' as const, thread })),
      { kind: 'message', message: { ...first, threadId: 'missing' } },
      { kind: 'message', message: { ...first, message: { ...first.message, id: 'invalid' } } },
      ...source.rows.messages.map((message) => ({ kind: 'message' as const, message })),
    ],
    (issue) => issues.push(issue)
  )
  expect(await writer.prepare()).toMatchObject({ messageCount: 2, skipSession: false })
  await writer.publish()
  expect(
    (await rows.readSnapshot(source.record.id))?.rows.messages.find((row) => row.messageId === 'a')?.message
  ).toEqual(first.message)
  expect(issues.filter((issue) => issue.action === 'skipped')).toHaveLength(2)
})

it('closes the writer after an aborted append and permits candidate cleanup', async () => {
  const rows = store(),
    source = fixture()
  const writer = await rows.stageImportRows(source.record, 'retry-append')
  await writer.appendThread(source.rows.threads[0])
  const add = IDBObjectStore.prototype.add
  let staged = 0
  const failure = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    const request = add.call(this, value, key)
    if (this.name === ROW_TRANSFER_STAGE && ++staged === 2) this.transaction.abort()
    return request
  })
  const messages = source.rows.messages.map((message) => ({ kind: 'message' as const, message }))
  await expect(writer.appendRows(messages)).rejects.toThrow()
  failure.mockRestore()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  await expect(writer.appendRows(messages)).rejects.toThrow('Import candidate has failed')
  await expect(writer.prepare()).rejects.toThrow('Import candidate has failed')
  await expect(writer.publish()).rejects.toThrow('Import candidate has failed')
  expect(get).not.toHaveBeenCalled()
  expect(getAll).not.toHaveBeenCalled()
  await writer.dispose()
  expect(await rows.hasRows(source.record.id)).toBe(false)
})

it('closes the writer when preparation fails and preserves live rows during cleanup', async () => {
  const rows = store(),
    source = fixture()
  await rows.writeRows(fixture('old'))
  const before = await rows.readSnapshot(source.record.id)
  source.rows.messages[1].parentMessageId = 'missing'
  const writer = await rows.stageImportRows(source.record, 'failed-prepare')
  await append(writer, source)
  await expect(
    writer.prepare(() => {
      throw new Error('controlled prepare failure')
    })
  ).rejects.toThrow('controlled prepare failure')
  await expect(writer.prepare()).rejects.toThrow('Import candidate has failed')
  await expect(writer.publish()).rejects.toThrow('Import candidate has failed')
  await writer.dispose()
  expect(await rows.readSnapshot(source.record.id)).toEqual(before)
})

it('keeps candidate state in memory and reads only the revision and message bodies when publishing', async () => {
  const rows = store(),
    source = fixture()
  await rows.initialize()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  const put = vi.spyOn(IDBObjectStore.prototype, 'put')
  const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction')
  const add = vi.spyOn(IDBObjectStore.prototype, 'add')
  const writer = await rows.stageImportRows(source.record, 'memory-state')
  expect(transactions).not.toHaveBeenCalled()
  expect(add).not.toHaveBeenCalled()
  await writer.appendThread(source.rows.threads[0])
  for (const message of source.rows.messages) await writer.appendMessage(message)
  expect(get).not.toHaveBeenCalled()
  expect(getAll).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()

  transactions.mockClear()
  expect(await writer.prepare()).toMatchObject({ messageCount: 2 })
  expect(await writer.prepare()).toMatchObject({ messageCount: 2 })
  expect(transactions).not.toHaveBeenCalled()
  expect(get).not.toHaveBeenCalled()
  expect(getAll).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()

  await writer.publish()
  expect(get.mock.calls).toEqual([[[source.record.id, REVISION_HEAD_THREAD_ID]]])
  expect(get.mock.contexts[0]).toMatchObject({ name: SESSION_ROW_THREAD_STORE })
  expect(getAll).toHaveBeenCalledOnce()
  expect(getAll.mock.contexts[0]).toMatchObject({ name: ROW_TRANSFER_STAGE })
  expect(getAll.mock.calls[0][0]).toMatchObject({ lower: [writer.candidateId, 'message'] })
  expect(
    put.mock.contexts.filter((store) => store instanceof IDBObjectStore && store.name === ROW_TRANSFER_STAGE)
  ).toHaveLength(0)

  get.mockClear()
  getAll.mockClear()
  put.mockClear()
  const remove = vi.spyOn(IDBObjectStore.prototype, 'delete')
  transactions.mockClear()
  await writer.publish()
  await writer.dispose()
  await writer.dispose()
  expect(get).not.toHaveBeenCalled()
  expect(getAll).not.toHaveBeenCalled()
  expect(put).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  expect(transactions).not.toHaveBeenCalled()
  expect((await rows.readSnapshot(source.record.id))?.revision).toBe(1)
  expect(await membership(rows, source.record.id, ['a', 'b'], 1)).toEqual([true, true])
})

it.each(['collecting', 'ready', 'published'])('disposes a %s candidate directly without reading it', async (phase) => {
  const rows = store(),
    source = fixture('replacement')
  await rows.writeRows(fixture('old'))
  const writer = await rows.stageImportRows(source.record, 'direct-cleanup')
  await append(writer, source)
  if (phase !== 'collecting') await writer.prepare()
  if (phase === 'published') await writer.publish()
  const before = await rows.readSnapshot(source.record.id)
  rows.close()

  const reopened = store()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  await reopened.disposeImportRows(writer.candidateId)
  await reopened.disposeImportRows(writer.candidateId)
  expect(get).not.toHaveBeenCalled()
  expect(getAll).not.toHaveBeenCalled()
  expect(await reopened.readSnapshot(source.record.id)).toEqual(before)

  const replacement = await reopened.stageImportRows(source.record, 'direct-cleanup')
  await append(replacement, source)
  await replacement.dispose()
})

it('can dispose a missing candidate before the database is initialized', async () => {
  const rows = store()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  await rows.disposeImportRows('missing-candidate')
  await rows.disposeImportRows('missing-candidate')
  expect(get).not.toHaveBeenCalled()
  expect(getAll).not.toHaveBeenCalled()
})

it('publishes every valid row across multiple pages with out-of-order ids', async () => {
  const rows = store()
  const tree = prepareSessionRowsFixture({
    id: 'paged-import',
    name: 'Paged',
    type: 'chat',
    messages: Array.from({ length: 257 }, (_, i) => ({
      id: `message-${256 - i}`,
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: `body ${i} 😀` }],
    })),
  })
  const source: SessionRowSnapshot = {
    record: tree.session,
    revision: 1,
    rows: { sessionId: tree.session.id, threads: tree.threads, messages: tree.messages },
  }
  const writer = await rows.stageImportRows(source.record, 'paged')
  await writer.appendThread(source.rows.threads[0])
  for (let offset = 0; offset < source.rows.messages.length; offset += 73) {
    await writer.appendRows(
      source.rows.messages.slice(offset, offset + 73).map((message) => ({ kind: 'message' as const, message }))
    )
  }
  const orphan = {
    ...source.rows.messages[0],
    messageId: 'message-128-orphan',
    parentMessageId: 'absent',
    message: { ...source.rows.messages[0].message, id: 'message-128-orphan' },
  }
  await writer.appendMessage(orphan)
  expect(await writer.prepare()).toMatchObject({ messageCount: 257 })
  await writer.publish()
  rows.close()
  const reopened = store()
  const restored = await reopened.readSnapshot(source.record.id)
  expect(restored?.rows.messages).toHaveLength(257)
  const actual = new Map(restored?.rows.messages.map((row) => [row.messageId, row]))
  for (const expected of source.rows.messages) {
    expect(actual.get(expected.messageId)).toMatchObject({
      message: expected.message,
      parentMessageId: expected.parentMessageId,
      activeChildId: expected.activeChildId,
    })
  }
  expect(restored?.rows.threads[0]).toMatchObject({
    activeLeafMessageId: source.rows.messages.at(-1)?.messageId,
    summary: { messageCount: 257 },
  })
})

it('allocates the next revision from the live head when publishing', async () => {
  const rows = store(),
    source = fixture('old')
  await rows.writeRows(source)
  const incoming = { ...fixture('incoming'), revision: 2 }
  const writer = await rows.stageImportRows(incoming.record, 'next-revision')
  await append(writer, incoming)
  await writer.prepare()
  await rows.writeRows({ ...fixture('newer live'), revision: 2 }, 1)
  await writer.publish()
  expect(await rows.readSnapshot(source.record.id)).toMatchObject({
    revision: 3,
    rows: { messages: incoming.rows.messages.map((row) => ({ messageId: row.messageId, message: row.message })) },
  })
  await expect(rows.writeRows({ ...fixture('ordinary stale write'), revision: 3 }, 2)).rejects.toMatchObject({
    name: 'SessionRowConflictError',
  })
  await writer.dispose()
  expect((await rows.readSnapshot(source.record.id))?.revision).toBe(3)
})

it('keeps revisions monotonic when importing over a deleted session', async () => {
  const rows = store(),
    source = fixture()
  await rows.writeRows(source)
  await rows.deleteRows(source.record.id, 1)
  expect(await rows.readSnapshot(source.record.id)).toBeNull()
  const writer = await rows.stageImportRows(source.record, 'tombstone')
  await append(writer, source)
  await writer.prepare()
  await writer.publish()
  expect((await rows.readSnapshot(source.record.id))?.revision).toBe(3)
})

it('rejects an exhausted revision without changing live rows', async () => {
  const rows = store(),
    source = fixture('old')
  await rows.writeRows({ ...source, revision: Number.MAX_SAFE_INTEGER })
  const before = await rows.readSnapshot(source.record.id)
  const incoming = fixture('incoming')
  const writer = await rows.stageImportRows(incoming.record, 'exhausted')
  await append(writer, incoming)
  await writer.prepare()
  await expect(writer.publish()).rejects.toThrow('revision is exhausted')
  expect(await rows.readSnapshot(source.record.id)).toEqual(before)
  await rows.disposeImportRows(writer.candidateId)
  expect(await rows.readSnapshot(source.record.id)).toEqual(before)
})

async function membership(store: IndexedDBSessionRowStore, sessionId: string, ids: string[], expectedRevision: number) {
  const selected: boolean[] = []
  for (let offset = 0; offset < ids.length; offset += 200) {
    const read = await store.readMessageMetadata({
      sessionId,
      messageIds: ids.slice(offset, offset + 200),
      expectedRevision,
    })
    if (read?.status !== 'ready') throw new Error('Membership read is unavailable')
    selected.push(...read.rows.map((row) => row.selected))
  }
  return selected
}

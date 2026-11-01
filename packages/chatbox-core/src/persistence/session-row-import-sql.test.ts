import { afterEach, describe, expect, it, vi } from 'vitest'
import { type NodeSessionRowSqlDatabase, openNodeSessionRowDatabase } from './node-sqlite.test-support'
import { contextSnapshot } from './session-context-read.test-support'
import { SqlSessionRowStore, type SessionRowSqlStatement } from './session-row-sql'
import { transferColumns } from './session-row-transfer-sql'
import type { SessionRowSnapshot } from '../ports/session-row-store'
import type {
  SessionRowImportIssue,
  SessionRowImportIssueHandler,
  SessionRowImportWriter,
} from '../ports/session-row-transfer'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})
const fixture = (text = 'body') =>
  contextSnapshot({
    id: 's',
    name: 'Import',
    messages: [
      { id: 'a', role: 'user', contentParts: [{ type: 'text', text }] },
      { id: 'b', role: 'assistant', contentParts: [{ type: 'text', text: 'reply' }] },
    ],
  })
function forkFixture(summaryPoint = false, empty = false, sessionId = 's', prefix = '') {
  const pivotId = `${prefix}a`,
    pointId = summaryPoint ? `${prefix}summary` : pivotId
  const replyId = `${prefix}b`,
    alternativeId = `${prefix}alternative`
  const source = contextSnapshot({
    id: sessionId,
    name: 'Fork import',
    messages: [
      { id: pivotId, role: 'user', contentParts: [{ type: 'text', text: 'question' }] },
      ...(summaryPoint ? [{ id: pointId, role: 'assistant' as const, isSummary: true, contentParts: [] }] : []),
      { id: replyId, role: 'assistant', contentParts: [{ type: 'text', text: 'reply' }] },
    ],
  })
  const point = source.rows.messages.find((row) => row.messageId === pointId)!
  const selected = source.rows.messages.find((row) => row.messageId === replyId)!
  point.forkPivotId = pivotId
  selected.branchId = 'first-branch'
  const alternative = {
    ...selected,
    messageId: alternativeId,
    siblingOrder: selected.siblingOrder + 1,
    branchId: 'second-branch',
    message: { ...selected.message, id: alternativeId },
  }
  source.rows.messages.push(alternative)
  point.activeChildId = empty ? null : alternativeId
  if (empty) {
    point.pendingBranchId = 'empty-branch'
    point.pendingBranchOrder = selected.siblingOrder + 2
  }
  const fork = {
    pivotId,
    branchPointId: pointId,
    selectedBranchId: empty ? 'empty-branch' : 'second-branch',
    count: empty ? 3 : 2,
    position: empty ? 2 : 1,
  }
  return { source, pivotId, pointId, replyId, alternativeId, fork }
}
function setup() {
  const db = openNodeSessionRowDatabase()
  databases.push(db)
  return { db, store: new SqlSessionRowStore(db) }
}
async function append(
  writer: SessionRowImportWriter,
  source: SessionRowSnapshot,
  onIssue?: SessionRowImportIssueHandler
) {
  await writer.appendRows(
    [
      ...source.rows.threads.map((thread) => ({
        kind: 'thread' as const,
        thread: { ...thread, activeLeafMessageId: null },
      })),
      ...source.rows.messages.map((message) => ({ kind: 'message' as const, message })),
    ],
    onIssue
  )
}
describe('SQL row imports', () => {
  it('keeps old live rows when replacement fails inside its transaction', async () => {
    const { db, store } = setup()
    await store.writeRows(fixture('old'))
    const before = await store.readSnapshot('s')
    const next = { ...fixture('replacement'), revision: 2 }
    const writer = await store.stageImportRows(next.record, 'failed-transaction')
    await append(writer, next)
    await writer.prepare()
    await db.execute(`CREATE TRIGGER fail_import BEFORE INSERT ON session_messages
      BEGIN SELECT RAISE(ABORT, 'controlled insert failure'); END;`)
    await expect(writer.publish()).rejects.toThrow('controlled insert failure')
    expect(await store.readSnapshot('s')).toEqual(before)
    await writer.dispose()
    expect(await store.readSnapshot('s')).toEqual(before)
  })
  it('recognizes the committed receipt when a native publish reply is lost', async () => {
    const { db, store } = setup()
    const source = fixture()
    const writer = await store.stageImportRows(source.record, 'lost-reply')
    await append(writer, source)
    await writer.prepare()
    const execute = db.executeBatch.bind(db)
    const failure = vi.spyOn(db, 'executeBatch').mockImplementationOnce(async (statements, options) => {
      await execute(statements, options)
      throw new Error('native reply lost')
    })
    await writer.publish()
    failure.mockRestore()
    expect(await store.getRevision('s')).toBe(1)
    await writer.dispose()
    expect(await store.hasRows('s')).toBe(true)
  })
  it('publishes hidden rows atomically and keeps the committed rows after restart cleanup', async () => {
    const { db, store } = setup(),
      old = fixture('old')
    await store.writeRows(old)
    const snapshot = await store.readSnapshot('s')
    const next = { ...fixture('new😀'.repeat(40000)), revision: 2 }
    const writer = await store.stageImportRows(next.record, 'job')
    await append(writer, next)
    await writer.prepare()
    expect(await store.readSnapshot('s')).toEqual(snapshot)
    await writer.publish()
    await writer.publish()
    expect((await store.readMessages({ sessionId: 's', messageIds: ['a'] }))?.messages[0].message.contentParts).toEqual(
      next.rows.messages[0].message.contentParts
    )
    const threadState = await store.readThreadState({
      sessionId: 's',
      threadId: next.record.activeThreadId,
      expectedRevision: 2,
    })
    expect(threadState?.status === 'ready' && threadState.thread.summary.messageCount).toBe(2)
    const published = await store.readSnapshot('s')
    expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
    expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
    await new SqlSessionRowStore(db).disposeImportRows(writer.candidateId)
    await writer.dispose()
    expect(await store.readSnapshot('s')).toEqual(published)
  })
  it('discards unpublished rows and keeps a committed import after candidate cleanup', async () => {
    const { store } = setup(),
      source = fixture()
    const writer = await store.stageImportRows(source.record, 'job')
    await append(writer, source)
    await writer.prepare()
    await writer.dispose()
    expect(await store.hasRows('s')).toBe(false)
    expect(await store.getRevision('s')).toBeNull()
    const second = await store.stageImportRows(source.record, 'job2')
    await append(second, source)
    await second.prepare()
    await second.publish()
    await second.dispose()
    expect(await store.hasRows('s')).toBe(true)
  })
  it('disposes one import while protecting published rows and other candidates', async () => {
    const { db, store } = setup()
    await store.writeRows(fixture('old'))
    const next = { ...fixture('new'), revision: 2 }
    const writer = await store.stageImportRows(next.record, 'replace')
    await append(writer, next)
    await writer.prepare()
    await writer.publish()
    const pending = await store.stageImportRows({ ...fixture('pending'), revision: 3 }.record, 'other-job')
    await append(pending, fixture('pending'))
    const ordinary = await store.stageRows({ ...fixture('copy'), revision: 3 }, 2)
    for (const thread of fixture('copy').rows.threads) await ordinary.appendThread(thread)
    for (const message of fixture('copy').rows.messages) await ordinary.appendMessage(message)
    const staged = () => db.query('SELECT payload_id FROM session_messages_staging ORDER BY payload_id')
    const protectedRows = await staged()
    expect(protectedRows).toHaveLength(4)
    await writer.dispose()
    await writer.dispose()
    expect(await staged()).toEqual(protectedRows)
    await pending.dispose()
    expect(await staged()).toHaveLength(2)
    await ordinary.dispose()
    expect(await staged()).toEqual([])
    expect(await store.readMessages({ sessionId: 's', messageIds: ['a'] })).toMatchObject({
      messages: [{ message: { contentParts: [{ text: 'new' }] } }],
    })
  })
  it.each(['detached-cycle', 'missing-parent', 'duplicate-sibling', 'compaction', 'empty-slot'])(
    'preserves usable rows while repairing imported relationships: %s',
    async (kind) => {
      const { db, store } = setup(),
        source = fixture()
      if (kind === 'missing-parent') source.rows.messages[1].parentMessageId = 'missing'
      if (kind === 'compaction')
        source.rows.threads[0].compactionPoints = [
          { boundaryMessageId: 'a', summaryMessageId: 'missing', createdAt: 1 },
        ]
      if (kind === 'empty-slot') {
        source.rows.messages[1].pendingBranchId = 'empty'
        source.rows.messages[1].pendingBranchOrder = -1
      }
      if (kind === 'duplicate-sibling')
        source.rows.messages.push({
          ...source.rows.messages[1],
          messageId: 'c',
          message: { ...source.rows.messages[1].message, id: 'c' },
        })
      if (kind === 'detached-cycle')
        source.rows.messages.push(
          ...['c', 'd'].map((id, index) => ({
            ...source.rows.messages[1],
            messageId: id,
            parentMessageId: index ? 'c' : 'd',
            activeChildId: null,
            message: { ...source.rows.messages[1].message, id },
          }))
        )
      const writer = await store.stageImportRows(source.record, 'job')
      await append(writer, source)
      const issues: SessionRowImportIssue[] = []
      const prepared = await writer.prepare((issue) => issues.push(issue))
      expect(prepared).toMatchObject({
        messageCount: kind === 'missing-parent' ? 1 : kind === 'duplicate-sibling' ? 3 : 2,
        skipSession: false,
      })
      expect(issues.length).toBeGreaterThan(0)
      await writer.publish()
      const restored = await store.readSnapshot('s')
      expect(restored?.rows.messages.find((row) => row.messageId === 'a')?.message).toEqual(
        source.rows.messages[0].message
      )
      expect(restored?.rows.threads[0].compactionPoints).toEqual([])
      if (kind === 'detached-cycle') expect(issues.filter((issue) => issue.action === 'skipped')).toHaveLength(2)
      if (kind === 'duplicate-sibling')
        expect(
          new Set(restored?.rows.messages.filter((row) => row.parentMessageId === 'a').map((row) => row.siblingOrder))
            .size
        ).toBe(2)
      await writer.dispose()
    }
  )
  it('batches insertion and does not split complete messages into SQL concatenation updates', async () => {
    const { db, store } = setup(),
      source = fixture('large😀'.repeat(20000))
    const writer = await store.stageImportRows(source.record, 'job')
    db.reset()
    await append(writer, source)
    expect(db.batchCount).toBeLessThanOrEqual(2)
    expect(db.executed.join('\n')).not.toContain('message_json=message_json||')
  })
  it('allocates the revision at publication after another write advances the target', async () => {
    const { store } = setup(),
      source = fixture()
    await store.writeRows(source)
    const writer = await store.stageImportRows(source.record, 'job')
    await append(writer, source)
    await writer.prepare()
    await store.writeRows({ ...source, revision: 2 }, 1)
    await writer.publish()
    const restored = await store.readSnapshot('s')
    expect(restored?.revision).toBe(3)
    expect(restored?.record).toEqual(source.record)
    await writer.publish()
    expect(await store.getRevision('s')).toBe(3)
    await writer.dispose()
  })
})

it.each([
  { summaryPoint: false, empty: false },
  { summaryPoint: false, empty: true },
  { summaryPoint: true, empty: false },
  { summaryPoint: true, empty: true },
])('derives imported fork navigation (summary=$summaryPoint, empty=$empty)', async ({ summaryPoint, empty }) => {
  const { store } = setup(),
    { source, pivotId, replyId, alternativeId, fork } = forkFixture(summaryPoint, empty)
  const writer = await store.stageImportRows(source.record, 'job')
  await append(writer, source)
  await writer.prepare()
  await writer.publish()
  const result = await store.readMessages({ sessionId: 's', messageIds: [pivotId, replyId, alternativeId] })
  expect(result?.messages[0].fork).toEqual(fork)
  expect(
    await membership(
      store,
      's',
      result!.messages.map((row) => row.messageId),
      result!.revision!
    )
  ).toEqual(empty ? [true, false, false] : [true, false, true])
})

it('derives the complete selected path and summary for a large branchless candidate', async () => {
  const { store } = setup(),
    source = contextSnapshot({
      id: 'many',
      name: 'Many',
      messages: Array.from({ length: 1024 }, (_, i) => ({
        id: `message-${i}`,
        role: 'user' as const,
        contentParts: [{ type: 'text' as const, text: `body-${i}` }],
      })),
    })
  const writer = await store.stageImportRows(source.record, 'large-branchless')
  await append(writer, source)
  expect(await writer.prepare()).toMatchObject({ messageCount: 1024, skipSession: false })
  await writer.publish()
  const thread = await store.readThreadState({
    sessionId: 'many',
    threadId: source.record.activeThreadId,
    expectedRevision: 1,
  })
  expect(thread?.status === 'ready' && thread.thread.summary.messageCount).toBe(1024)
  const messages = await store.readMessages({ sessionId: 'many', messageIds: ['message-0', 'message-1023'] })
  expect(messages?.messages.map((row) => row.fork)).toEqual([undefined, undefined])
  expect(messages?.messages.map((row) => row.message.contentParts)).toEqual([
    [{ type: 'text', text: 'body-0' }],
    [{ type: 'text', text: 'body-1023' }],
  ])
})

it('keeps fork counts and selected branches independent across threads', async () => {
  const { store } = setup(),
    first = forkFixture(),
    second = forkFixture(true, true, 's', 'history-')
  first.source.rows.threads.push({
    ...second.source.rows.threads[0],
    threadId: 'history',
    threadOrder: 0,
    name: 'History',
  })
  first.source.rows.messages.push(...second.source.rows.messages.map((row) => ({ ...row, threadId: 'history' })))
  const writer = await store.stageImportRows(first.source.record, 'two-threads')
  await append(writer, first.source)
  await writer.prepare()
  await writer.publish()
  const result = await store.readMessages({ sessionId: 's', messageIds: [first.pivotId, second.pivotId] })
  expect(result?.messages.map((row) => row.fork)).toEqual([first.fork, second.fork])
})

it('scopes pivot lookup to one candidate even when another session uses the same message IDs', async () => {
  const { store } = setup(),
    first = fixture(),
    second = forkFixture(false, true, 'other')
  const writer = await store.stageImportRows(first.record, 'same-job')
  const other = await store.stageImportRows(second.source.record, 'same-job')
  await append(writer, first)
  await append(other, second.source)
  await writer.prepare()
  await writer.publish()
  expect((await store.readMessages({ sessionId: 's', messageIds: ['a'] }))?.messages[0].fork).toBeUndefined()
  await other.prepare()
  await other.publish()
  expect((await store.readMessages({ sessionId: 'other', messageIds: ['a'] }))?.messages[0].fork).toEqual(second.fork)
})

it.each([false, true])('uses complete converted fork projections, including an empty map (%s)', async (emptyMap) => {
  const { store } = setup(),
    data = forkFixture(true, true),
    source = emptyMap ? fixture() : data.source
  const writer = await store.stageImportRows(source.record, 'converted')
  await append(writer, source)
  const forks = emptyMap ? new Map<string, typeof data.fork>() : new Map([[data.pivotId, data.fork]])
  const consume = vi.spyOn(forks, Symbol.iterator)
  await writer.prepare(undefined, forks)
  expect(consume).toHaveBeenCalledOnce()
  await writer.publish()
  expect((await store.readMessages({ sessionId: 's', messageIds: ['a'] }))?.messages[0].fork).toEqual(
    emptyMap ? undefined : data.fork
  )
  const thread = await store.readThreadState({
    sessionId: 's',
    threadId: source.record.activeThreadId,
    expectedRevision: 1,
  })
  expect(thread?.status === 'ready' && thread.thread.summary.messageCount).toBeGreaterThan(0)
})

it.each(['duplicate', 'invalid', 'missing-thread', 'repair'])(
  'rebuilds converted fork projections after %s',
  async (kind) => {
    const { store } = setup(),
      data = forkFixture()
    const writer = await store.stageImportRows(data.source.record, 'fallback')
    if (kind === 'repair') data.source.rows.threads[0].rootMessageId = 'missing-root'
    await append(writer, data.source)
    const row = data.source.rows.messages[0]
    if (kind === 'duplicate') await writer.appendMessage(row)
    if (kind === 'invalid')
      await writer.appendMessage({ ...row, messageId: 'invalid', message: { ...row.message, id: 'different' } })
    if (kind === 'missing-thread')
      await writer.appendMessage({
        ...row,
        messageId: 'missing-thread-row',
        threadId: 'absent',
        message: { ...row.message, id: 'missing-thread-row' },
      })
    const forks = new Map<string, typeof data.fork>()
    const consume = vi.spyOn(forks, Symbol.iterator)
    await writer.prepare(undefined, forks)
    expect(consume).not.toHaveBeenCalled()
    await writer.publish()
    expect((await store.readMessages({ sessionId: 's', messageIds: [data.pivotId] }))?.messages[0].fork).toEqual(
      data.fork
    )
  }
)

it.each([false, true])('projects many fork points with bounded work (converted=%s)', async (converted) => {
  const { db, store } = setup(),
    source = contextSnapshot({
      id: 's',
      name: 'Many forks',
      messages: Array.from({ length: 130 }, (_, i) => [
        { id: `point-${i}`, role: 'user' as const, contentParts: [] },
        { id: `reply-${i}`, role: 'assistant' as const, contentParts: [] },
      ]).flat(),
    })
  const forks = new Map<string, NonNullable<(typeof source.rows.messages)[number]['fork']>>()
  for (let i = 0; i < 130; i++) {
    const point = source.rows.messages[i * 2],
      reply = source.rows.messages[i * 2 + 1]
    point.forkPivotId = point.messageId
    reply.branchId = `selected-${i}`
    const messageId = `alternative-${i}`
    source.rows.messages.push({
      ...reply,
      messageId,
      activeChildId: null,
      branchId: `other-${i}`,
      siblingOrder: reply.siblingOrder + 1,
      message: { ...reply.message, id: messageId },
    })
    forks.set(point.messageId, {
      pivotId: point.messageId,
      branchPointId: point.messageId,
      selectedBranchId: reply.branchId,
      count: 2,
      position: 0,
    })
  }
  const writer = await store.stageImportRows(source.record, 'many-converted')
  await append(writer, source)
  const batches: SessionRowSqlStatement[][] = [],
    execute = db.executeBatch.bind(db)
  const capture = vi.spyOn(db, 'executeBatch').mockImplementation((statements, options) => {
    const batch = [...statements]
    batches.push(batch)
    return execute(batch, options)
  })
  await writer.prepare(undefined, converted ? forks : undefined)
  capture.mockRestore()
  expect(batches.length).toBeGreaterThan(0)
  expect(
    batches.every(
      (batch) =>
        batch.length <= 128 &&
        batch.reduce((bytes, statement) => bytes + new TextEncoder().encode(JSON.stringify(statement)).byteLength, 0) <=
          512 * 1024
    )
  ).toBe(true)
  await writer.publish()
  const result = await store.readMessages({ sessionId: 's', messageIds: [...forks.keys()] })
  expect(result?.messages.map((row) => row.fork)).toEqual([...forks.values()])
})

it.each([false, true])(
  'chooses the first message ID when multiple branch points refer to one pivot (reverse=%s)',
  async (reverse) => {
    const { store } = setup(),
      data = forkFixture(true)
    data.source.rows.messages[0].forkPivotId = data.pivotId
    data.source.rows.messages.find((row) => row.messageId === data.pointId)!.branchId = 'summary-branch'
    if (reverse) data.source.rows.messages.reverse()
    const writer = await store.stageImportRows(data.source.record, 'duplicate-pivot')
    await append(writer, data.source)
    await writer.prepare()
    await writer.publish()
    const result = await store.readMessages({ sessionId: 's', messageIds: [data.pivotId] })
    expect(result?.messages[0].fork).toEqual({
      pivotId: data.pivotId,
      branchPointId: data.pivotId,
      selectedBranchId: 'summary-branch',
      count: 1,
      position: 0,
    })
  }
)

it('coalesces many candidate rows into bounded native statements', async () => {
  const { db, store } = setup(),
    source = contextSnapshot({
      id: 'many',
      name: 'Many',
      messages: Array.from({ length: 128 }, (_, index) => ({
        id: `m${index}`,
        role: 'user' as const,
        contentParts: [{ type: 'text' as const, text: 'small' }],
      })),
    })
  const writer = await store.stageImportRows(source.record, 'job')
  const batches: SessionRowSqlStatement[][] = []
  const execute = db.executeBatch.bind(db)
  const capture = vi.spyOn(db, 'executeBatch').mockImplementation((statements, options) => {
    const batch = [...statements]
    batches.push(batch)
    return execute(batch, options)
  })
  await append(writer, source)
  capture.mockRestore()
  const statementLimit = 128,
    bindLimit = 900
  // Each message has a body row and navigation row; a batch reserves one control statement.
  const payloadRows = source.rows.messages.length * 2 + source.rows.threads.length
  expect(batches.length).toBeGreaterThan(0)
  expect(batches.length).toBeLessThanOrEqual(Math.ceil(payloadRows / (statementLimit - 1)))
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(statementLimit)
    expect(batch.every((statement) => statement.params.length <= bindLimit)).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThanOrEqual(512 * 1024)
  }
  const rowsPerInsert = Math.floor(bindLimit / (transferColumns.messages.split(',').length + 1))
  const inserts = batches.flat().filter((statement) => statement.sql.startsWith('INSERT INTO session_messages_staging'))
  // Native batch boundaries can each leave one partially filled multi-row INSERT.
  expect(inserts.length).toBeLessThanOrEqual(
    Math.ceil(source.rows.messages.length / rowsPerInsert) + batches.length - 1
  )
  expect(
    await db.query('SELECT COUNT(*) count FROM session_messages_staging WHERE mutation_id=?', [writer.candidateId])
  ).toEqual([{ count: source.rows.messages.length }])
})

it('keeps the first duplicate ID and repairs stale child, root and fork references', async () => {
  const { store } = setup(),
    source = fixture('first')
  source.rows.threads[0].rootMessageId = 'absent'
  source.rows.messages[1].activeChildId = 'absent'
  source.rows.messages[1].forkPivotId = 'absent'
  const writer = await store.stageImportRows(source.record, 'duplicates')
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
  const prepared = await writer.prepare((issue) => issues.push(issue))
  expect(prepared).toMatchObject({ messageCount: 2, skipSession: false })
  await writer.publish()
  const restored = await store.readSnapshot('s')
  expect(restored?.rows.messages.find((row) => row.messageId === 'a')?.message).toEqual(source.rows.messages[0].message)
  expect(restored?.rows.messages.find((row) => row.messageId === 'b')).toMatchObject({ activeChildId: null })
  expect(restored?.rows.messages.find((row) => row.messageId === 'b')?.forkPivotId).toBeUndefined()
  expect(issues.map((issue) => issue.reason)).toEqual(
    expect.arrayContaining(['duplicate-row', 'thread-root', 'selected-child', 'fork-reference'])
  )
})

it('marks candidates with no usable messages for session skipping and keeps old rows invisible', async () => {
  const { store } = setup(),
    old = fixture('old')
  await store.writeRows(old)
  const source = { ...fixture('broken'), revision: 2 }
  source.rows.messages[0].parentMessageId = 'missing'
  const writer = await store.stageImportRows(source.record, 'unusable')
  await append(writer, source)
  const issues: SessionRowImportIssue[] = []
  expect(await writer.prepare((issue) => issues.push(issue))).toMatchObject({ messageCount: 0, skipSession: true })
  expect(issues.filter((issue) => issue.action === 'skipped')).toHaveLength(2)
  expect((await store.readSnapshot('s'))?.rows.messages[0].message).toEqual(old.rows.messages[0].message)
  await writer.dispose()
})

it('keeps usable branches, normalizes conflicting sibling order and removes orphan descendants', async () => {
  const { store: rows } = setup()
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
  const restored = await rows.readSnapshot('s')
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
  const { store: rows } = setup()
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
  const { store: rows } = setup()
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

it.each([1, 2])(
  'terminates append after native message batch %s fails and cleans staging on disposal',
  async (failBatch) => {
    const { db, store } = setup()
    await store.writeRows(fixture('old'))
    const before = await store.readSnapshot('s')
    const source = {
      ...contextSnapshot({
        id: 's',
        name: 'Many incoming rows',
        messages: Array.from({ length: 257 }, (_, index) => ({
          id: `incoming-${index}`,
          role: 'user' as const,
          contentParts: [{ type: 'text' as const, text: `body-${index}` }],
        })),
      }),
      revision: 2,
    }
    const writer = await store.stageImportRows(source.record, 'failed-append')
    await writer.appendThread(source.rows.threads[0])
    const execute = db.executeBatch.bind(db)
    let messageBatches = 0
    const failure = vi.spyOn(db, 'executeBatch').mockImplementation(async (statements, options) => {
      const batch = [...statements]
      if (
        batch.some((statement) => statement.sql.startsWith('INSERT INTO session_messages_staging')) &&
        ++messageBatches === failBatch
      )
        throw new Error('controlled append failure')
      return execute(batch, options)
    })
    const messages = source.rows.messages.map((message) => ({ kind: 'message' as const, message }))
    await expect(writer.appendRows(messages)).rejects.toThrow('controlled append failure')
    failure.mockRestore()
    expect(await store.readSnapshot('s')).toEqual(before)
    const [{ count: staged }] = await db.query<{ count: number }>(
      'SELECT COUNT(*) count FROM session_messages_staging WHERE mutation_id=?',
      [writer.candidateId]
    )
    expect(staged).toBeLessThan(messages.length)
    if (failBatch === 1) expect(staged).toBe(0)
    else expect(staged).toBeGreaterThan(0)
    await expect(writer.appendRows(messages)).rejects.toThrow('Import candidate is closed')
    await expect(writer.prepare()).rejects.toThrow('Import candidate is closed')
    await expect(writer.publish()).rejects.toThrow('Import candidate is closed')
    await writer.dispose()
    expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
    expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
    expect(await store.readSnapshot('s')).toEqual(before)
  }
)

it('terminates preparation when an issue handler fails and disposes unpublished rows', async () => {
  const { db, store } = setup(),
    source = fixture()
  source.rows.messages[1].parentMessageId = 'missing'
  const writer = await store.stageImportRows(source.record, 'failed-prepare')
  await append(writer, source)
  await expect(
    writer.prepare(() => {
      throw new Error('controlled issue failure')
    })
  ).rejects.toThrow('controlled issue failure')
  await expect(writer.prepare()).rejects.toThrow('Import candidate is closed')
  await expect(writer.publish()).rejects.toThrow('Import candidate is closed')
  await writer.dispose()
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
  expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
  expect(await store.hasRows('s')).toBe(false)
})

it('keeps import lifecycle in memory and disposes published candidates without database calls', async () => {
  const { db, store } = setup(),
    source = fixture()
  await store.initialize()
  const query = vi.spyOn(db, 'query')
  const execute = vi.spyOn(db, 'execute')
  const executeBatch = vi.spyOn(db, 'executeBatch')
  const writer = await store.stageImportRows(source.record, 'memory-owned')
  expect(executeBatch).not.toHaveBeenCalled()
  await append(writer, source)
  const prepared = await writer.prepare()
  expect(await writer.prepare()).toEqual(prepared)
  await writer.publish()
  expect(executeBatch).toHaveBeenCalledTimes(3)
  expect(
    executeBatch.mock.calls
      .flatMap(([statements]) => [...statements])
      .map(({ sql }) => sql)
      .join('\n')
  ).not.toContain('session_row_imports')
  executeBatch.mockClear()
  await writer.publish()
  await writer.dispose()
  await writer.dispose()
  expect(executeBatch).not.toHaveBeenCalled()
  expect(query).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
  expect((await store.readSnapshot('s'))?.revision).toBe(1)
})

it('cleans an abandoned candidate from a new store without changing published rows', async () => {
  const { db, store } = setup(),
    source = fixture()
  await store.writeRows(source)
  const before = await store.readSnapshot('s')
  const writer = await store.stageImportRows(source.record, 'abandoned')
  await append(writer, source)
  await db.executeBatch([
    {
      sql: 'INSERT INTO session_row_local_metadata(mutation_id,message_id,value) VALUES (?,?,?)',
      params: [writer.candidateId, 'text', 'partial'],
    },
  ])
  const cleanup = new SqlSessionRowStore(db)
  await cleanup.disposeImportRows(writer.candidateId)
  await cleanup.disposeImportRows(writer.candidateId)
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
  expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
  expect(await db.query('SELECT * FROM session_row_local_metadata')).toEqual([])
  expect(await store.readSnapshot('s')).toEqual(before)
})

it('cleans a missing candidate from a fresh database idempotently', async () => {
  const { db, store } = setup()
  const query = vi.spyOn(db, 'query')
  const execute = vi.spyOn(db, 'execute')
  await store.disposeImportRows('uncreated-candidate')
  await store.disposeImportRows('uncreated-candidate')
  expect(query).not.toHaveBeenCalled()
  expect(execute.mock.calls.some(([sql]) => sql.includes('session_row_imports'))).toBe(false)
})

it('advances a deleted session tombstone and synchronizes the imported header revision', async () => {
  const { db, store } = setup(),
    source = fixture()
  await store.writeRows(source)
  const writer = await store.stageImportRows(source.record, 'tombstone')
  await append(writer, source)
  await writer.prepare()
  await store.deleteRows('s', 1)
  expect(await store.getRevision('s')).toBe(2)
  await writer.publish()
  expect((await store.readSnapshot('s'))?.revision).toBe(3)
  expect(
    await db.query('SELECT commit_revision FROM session_threads WHERE session_id=? AND threadOrder=-1', ['s'])
  ).toEqual([{ commit_revision: 3 }])
})

it('rolls back publication when the existing revision cannot be advanced safely', async () => {
  const { db, store } = setup(),
    source = fixture()
  await store.writeRows(source)
  const writer = await store.stageImportRows(source.record, 'exhausted-revision')
  await append(writer, source)
  await writer.prepare()
  await db.executeBatch([
    { sql: 'UPDATE session_row_heads SET revision=? WHERE session_id=?', params: [Number.MAX_SAFE_INTEGER, 's'] },
  ])
  await expect(writer.publish()).rejects.toThrow()
  expect(await store.getRevision('s')).toBe(Number.MAX_SAFE_INTEGER)
  await expect(writer.publish()).rejects.toThrow('Import candidate is closed')
  await writer.dispose()
  expect(await db.query('SELECT COUNT(*) AS count FROM session_messages WHERE session_id=?', ['s'])).toEqual([
    { count: 2 },
  ])
})

it('publishes repaired rows collected across multiple append calls', async () => {
  const { db, store } = setup()
  const source = contextSnapshot({
    id: 'many',
    name: 'Paged import',
    messages: Array.from({ length: 257 }, (_, index) => ({
      id: `message-${256 - index}`,
      role: 'user' as const,
      contentParts: [{ type: 'text' as const, text: `body ${index} 😀` }],
    })),
  })
  const writer = await store.stageImportRows(source.record, 'paged')
  await writer.appendThread(source.rows.threads[0])
  for (let offset = 0; offset < source.rows.messages.length; offset += 73) {
    await writer.appendRows(
      source.rows.messages.slice(offset, offset + 73).map((message) => ({ kind: 'message' as const, message }))
    )
  }
  await writer.appendMessage({
    ...source.rows.messages[0],
    messageId: 'message-128-orphan',
    parentMessageId: 'absent',
    message: { ...source.rows.messages[0].message, id: 'message-128-orphan' },
  })
  expect(await writer.prepare()).toMatchObject({ messageCount: 257, skipSession: false })
  await writer.publish()
  const restored = await store.readSnapshot('many')
  const actual = new Map(restored?.rows.messages.map((row) => [row.messageId, row]))
  expect(actual.size).toBe(257)
  expect(
    await membership(
      store,
      'many',
      source.rows.messages.map((row) => row.messageId),
      restored!.revision
    )
  ).toEqual(Array(257).fill(true))
  for (const row of source.rows.messages) {
    expect(actual.get(row.messageId)).toMatchObject({
      message: row.message,
      parentMessageId: row.parentMessageId,
      activeChildId: row.activeChildId,
    })
  }
  expect(restored?.rows.threads[0]).toMatchObject({
    activeLeafMessageId: source.rows.messages.at(-1)?.messageId,
    summary: { messageCount: 257 },
  })
})

it.each([false, true])(
  'disposes partially committed relation repair while preserving the published session (allInvalid=%s)',
  async (allInvalid) => {
    const { db, store } = setup()
    await store.writeRows(fixture('old'))
    const before = await store.readSnapshot('s')
    const source = { ...fixture('incoming'), revision: 2 }
    source.rows.messages[allInvalid ? 0 : 1].parentMessageId = 'missing'
    const writer = await store.stageImportRows(source.record, 'partial-prepare')
    await append(writer, source)
    const remaining = allInvalid ? 0 : 1
    const execute = db.executeBatch.bind(db)
    let injected = false
    const failure = vi.spyOn(db, 'executeBatch').mockImplementation(async (statements, options) => {
      const batch = [...statements]
      if (options || !batch.some((statement) => statement.sql.startsWith('DELETE FROM session_messages_staging'))) {
        return execute(batch, options)
      }
      for (const statement of batch) {
        await execute([statement])
        if (!statement.sql.startsWith('DELETE FROM session_messages_staging')) continue
        const [{ count }] = await db.query<{ count: number }>(
          'SELECT COUNT(*) count FROM session_messages_staging WHERE mutation_id=?',
          [writer.candidateId]
        )
        if (count === remaining) {
          injected = true
          throw new Error('native repair batch interrupted')
        }
      }
    })
    await expect(writer.prepare()).rejects.toThrow('native repair batch interrupted')
    failure.mockRestore()
    expect(injected).toBe(true)
    expect(await store.readSnapshot('s')).toEqual(before)
    await expect(writer.prepare()).rejects.toThrow('Import candidate is closed')
    await expect(writer.publish()).rejects.toThrow('Import candidate is closed')
    await writer.dispose()
    expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
    expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
    expect(await store.readSnapshot('s')).toEqual(before)
  }
)

it('disposes partially written message slices after a native batch fails', async () => {
  const { db, store } = setup()
  const source = fixture('long😀'.repeat(65000))
  const writer = await store.stageImportRows(source.record, 'sliced-message')
  await writer.appendThread(source.rows.threads[0])
  const execute = db.executeBatch.bind(db)
  let bodyBatches = 0
  const failure = vi.spyOn(db, 'executeBatch').mockImplementation(async (statements, options) => {
    const batch = [...statements]
    if (batch.some((statement) => statement.sql.includes('SET message_json=message_json||?')) && ++bodyBatches === 2)
      throw new Error('large message write interrupted')
    return execute(batch, options)
  })
  const messages = source.rows.messages.map((message) => ({ kind: 'message' as const, message }))
  await expect(writer.appendRows(messages)).rejects.toThrow('large message write interrupted')
  failure.mockRestore()
  expect(bodyBatches).toBe(2)
  expect(await store.hasRows('s')).toBe(false)
  await expect(writer.appendRows(messages)).rejects.toThrow('Import candidate is closed')
  await writer.dispose()
  expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
  expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
})

it.each([false, true])(
  'disposes prepared rows when the native prepare reply is lost (allInvalid=%s)',
  async (allInvalid) => {
    const { db, store } = setup()
    await store.writeRows(fixture('old'))
    const before = await store.readSnapshot('s')
    const source = { ...fixture('incoming'), revision: 2 }
    if (allInvalid) source.rows.messages[0].parentMessageId = 'missing'
    const writer = await store.stageImportRows(source.record, 'lost-prepare-reply')
    await append(writer, source)
    const execute = db.executeBatch.bind(db)
    const failure = vi.spyOn(db, 'executeBatch').mockImplementationOnce(async (statements, options) => {
      await execute(statements, options)
      throw new Error('native prepare reply lost')
    })
    await expect(writer.prepare()).rejects.toThrow('native prepare reply lost')
    failure.mockRestore()
    expect(await store.readSnapshot('s')).toEqual(before)
    await expect(writer.prepare()).rejects.toThrow('Import candidate is closed')
    await expect(writer.publish()).rejects.toThrow('Import candidate is closed')
    await writer.dispose()
    expect(await db.query('SELECT * FROM session_messages_staging')).toEqual([])
    expect(await db.query('SELECT * FROM session_threads_staging')).toEqual([])
    expect(await store.readSnapshot('s')).toEqual(before)
  }
)

it('imports a large conversation header within native statement and batch budgets', async () => {
  const { db, store } = setup()
  const nativeCallLimit = 512 * 1024
  const statementLimit = nativeCallLimit - 1024
  Object.defineProperty(db, 'maxStatementBytes', { value: statementLimit })
  const source = fixture('small message')
  source.record.name = 'N'.repeat(400 * 1024)
  const batches: SessionRowSqlStatement[][] = []
  const execute = db.executeBatch.bind(db)
  const capture = vi.spyOn(db, 'executeBatch').mockImplementation((statements, options) => {
    const batch = [...statements]
    batches.push(batch)
    return execute(batch, options)
  })
  const writer = await store.stageImportRows(source.record, 'large-header')
  await append(writer, source)
  expect(await writer.prepare()).toMatchObject({ messageCount: 2, skipSession: false })
  await writer.publish()
  capture.mockRestore()
  const restored = await store.readSnapshot('s')
  expect(restored?.record.name === source.record.name).toBe(true)
  expect(restored?.rows.messages.map((row) => row.message)).toEqual(source.rows.messages.map((row) => row.message))
  const encoder = new TextEncoder()
  for (const batch of batches) {
    const native = batch.map((statement) => ({ statement: statement.sql, values: statement.params }))
    expect(encoder.encode(JSON.stringify(native)).byteLength).toBeLessThanOrEqual(nativeCallLimit)
    for (const statement of native) {
      expect(encoder.encode(JSON.stringify(statement)).byteLength).toBeLessThanOrEqual(statementLimit)
    }
  }
})

async function membership(
  store: SqlSessionRowStore,
  sessionId: string,
  ids: string[],
  expectedRevision: number
): Promise<boolean[]> {
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

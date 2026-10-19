import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  branchPreviewFixture,
  createSessionBranchPreviewContract,
  previewMessage,
} from '../ports/testing/session-branch-preview-contract'
import { openNodeSessionRowDatabase, type NodeSessionRowSqlDatabase } from './node-sqlite.test-support'
import { SqlSessionRowStore } from './session-row-sql'
import { InMemorySessionRowStore } from '../testing/InMemorySessionRowStore'
import { InMemorySessionRepository } from '../testing/InMemorySessionRepository'
import type { MessageRowMetadata } from '../session/session-tree/types'
import { SessionRowConflictError } from '../ports/session-row-store'
import { readBranchPreviewFromMetadata } from './session-branch-preview'

const databases: NodeSessionRowSqlDatabase[] = []
afterEach(() => {
  vi.restoreAllMocks()
  while (databases.length) databases.pop()?.close()
})

for (const [name, createStore] of [
  ['memory', () => new InMemorySessionRowStore()],
  [
    'SQL',
    () => {
      const database = openNodeSessionRowDatabase()
      databases.push(database)
      return new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' })
    },
  ],
] as const) {
  describe(`${name} compact branch preview`, () => {
    for (const test of createSessionBranchPreviewContract(createStore)) it(test.name, test.run)

    it.each([1200, 2000])(
      'counts a %i follow-up path inside storage without calling paged or body read APIs',
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
      }
    )
  })
}

it('SQL returns a compact aggregate in a constant number of bridge queries for long paths', async () => {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const store = new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' })
  const query = vi.spyOn(database, 'query')
  let shortQueryCount = 0
  for (const count of [1, 2000]) {
    const fixture = branchPreviewFixture([
      previewMessage('user', 'user'),
      ...Array.from({ length: count }, (_, index) => previewMessage(`a${index}`, 'assistant')),
    ])
    fixture.revision = count === 1 ? 1 : 2
    await store.writeRows(fixture)
    database.reset()
    query.mockClear()
    expect(
      (
        await store.readBranchPreview({
          sessionId: 'transcript',
          firstMessageId: 'user',
          revealedMessageIds: ['a1999', 'a0', 'a1999'],
        })
      )?.followupCount
    ).toBe(count - 1)
    const results = await Promise.all(query.mock.results.map((result) => result.value as Promise<unknown[]>))
    expect(results.every((rows) => rows.length <= 3)).toBe(true)
    expect(results.flat().every((row) => JSON.stringify(row).length < 2048)).toBe(true)
    expect(database.executed.some((sql) => /WITH RECURSIVE/i.test(sql))).toBe(true)
    expect(database.executed.some((sql) => /(?:message_json|payload_json|payload_chunk)/i.test(sql))).toBe(false)
    if (count === 1) shortQueryCount = query.mock.calls.length
    else expect(query.mock.calls.length).toBe(shortQueryCount)
  }
})

it('exposes the preview through the row repository facade', async () => {
  const repository = new InMemorySessionRepository()
  await repository.seedSession({
    id: 's',
    name: 'Chat',
    messages: [previewMessage('pivot', 'user'), previewMessage('active', 'assistant')],
    messageForksHash: {
      pivot: {
        createdAt: 1,
        position: 1,
        lists: [
          { id: 'inactive', messages: [previewMessage('other', 'assistant')] },
          { id: 'active', messages: [] },
        ],
      },
    },
  })
  expect(await repository.readSessionBranchPreview({ sessionId: 's', firstMessageId: 'other' })).toMatchObject({
    headMessageId: 'other',
    pairedReplyMessageId: null,
    followupCount: 0,
  })
})

function branchMetadata() {
  const fixture = branchPreviewFixture([previewMessage('user', 'user'), previewMessage('reply', 'assistant')])
  const metadata = new Map<string, MessageRowMetadata>(
    fixture.rows.messages.map(({ message: _message, ...row }) => [row.messageId, row])
  )
  return { commit: { record: fixture.record, revision: fixture.revision }, metadata }
}

it('rejects cycles in stored branch metadata', async () => {
  const { commit, metadata } = branchMetadata()
  metadata.get('reply')!.activeChildId = 'user'
  await expect(
    readBranchPreviewFromMetadata(
      { sessionId: 'transcript', firstMessageId: 'user' },
      commit,
      async (id) => metadata.get(id) ?? null
    )
  ).rejects.toThrow(/[Cc]yclic/)
})

it.each([
  'missing-child',
  'wrong-thread',
  'wrong-parent',
  'wrong-session',
  'missing-facts',
  'missing-selection',
] as const)('rejects %s metadata before returning a misleading branch count', async (failure) => {
  const { commit, metadata } = branchMetadata()
  const reply = metadata.get('reply')!
  if (failure === 'missing-child') metadata.delete('reply')
  if (failure === 'wrong-thread') reply.threadId = 'recent'
  if (failure === 'wrong-parent') reply.parentMessageId = 'old-0'
  if (failure === 'wrong-session') reply.sessionId = 'other'
  if (failure === 'missing-facts') delete reply.facts
  if (failure === 'missing-selection') delete reply.selected
  await expect(
    readBranchPreviewFromMetadata(
      { sessionId: 'transcript', firstMessageId: 'user' },
      commit,
      async (id) => metadata.get(id) ?? null
    )
  ).rejects.toThrow()
})

it.each([
  ['cycle', "UPDATE session_messages SET active_child_id='user' WHERE session_id='transcript' AND message_id='reply'"],
  ['missing child', "DELETE FROM session_messages WHERE session_id='transcript' AND message_id='reply'"],
  [
    'foreign thread',
    "UPDATE session_messages SET thread_id='recent' WHERE session_id='transcript' AND message_id='reply'",
  ],
  [
    'broken parent',
    "UPDATE session_messages SET parent_message_id='old-0' WHERE session_id='transcript' AND message_id='reply'",
  ],
  [
    'missing facts',
    "UPDATE session_messages SET row_metadata_json=json_remove(row_metadata_json,'$.facts') WHERE session_id='transcript' AND message_id='reply'",
  ],
  [
    'missing selection',
    "UPDATE session_messages SET row_metadata_json=json_remove(row_metadata_json,'$.selected') WHERE session_id='transcript' AND message_id='reply'",
  ],
] as const)('SQL rejects stored %s metadata without returning a partial count', async (_failure, corruption) => {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const store = new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' })
  await store.writeRows(branchPreviewFixture([previewMessage('user', 'user'), previewMessage('reply', 'assistant')]))
  await database.execute(corruption)
  await expect(store.readBranchPreview({ sessionId: 'transcript', firstMessageId: 'user' })).rejects.toThrow()
})

it.each([true, false])(
  'SQL fences an aggregate against a concurrent revision change with explicit revision %s',
  async (explicitRevision) => {
    const database = openNodeSessionRowDatabase()
    databases.push(database)
    const store = new SqlSessionRowStore(database, undefined, { readByteBudget: 'none' })
    await store.writeRows(branchPreviewFixture([previewMessage('user', 'user'), previewMessage('reply', 'assistant')]))
    const originalQuery = database.query.bind(database)
    let changed = false
    vi.spyOn(database, 'query').mockImplementation(async (sql, params) => {
      const result = await originalQuery(sql, params)
      if (!changed && sql.includes('reachable(message_id)')) {
        changed = true
        const updated = branchPreviewFixture([
          previewMessage('user', 'user'),
          previewMessage('reply', 'assistant'),
          previewMessage('later', 'user'),
        ])
        updated.revision = 2
        await store.writeRows(updated, 1)
      }
      return result
    })
    const read = store.readBranchPreview({
      sessionId: 'transcript',
      firstMessageId: 'user',
      ...(explicitRevision ? { expectedRevision: 1 } : {}),
    })
    if (explicitRevision) await expect(read).rejects.toBeInstanceOf(SessionRowConflictError)
    else await expect(read).resolves.toMatchObject({ revision: 2, followupCount: 1 })
    expect(changed).toBe(true)
  }
)

it('SQL preserves Unicode preview identities across compact native bridge slices', async () => {
  const database = openNodeSessionRowDatabase()
  databases.push(database)
  const store = new SqlSessionRowStore(database)
  const ids = ['user', 'reply', ...Array.from({ length: 30 }, (_, index) => `tail${index}`)].map(
    (prefix) => `${prefix}/${'消息🚀'.repeat(50)}`
  )
  const [userId, replyId, ...tailIds] = ids
  await store.writeRows(
    branchPreviewFixture([
      previewMessage(userId, 'user'),
      previewMessage(replyId, 'assistant'),
      ...tailIds.map((id) => previewMessage(id, 'user')),
    ])
  )
  const relations = vi.spyOn(store, 'readMessageRelationsPage')
  const metadata = vi.spyOn(store, 'readMessageMetadata')
  const bodies = vi.spyOn(store, 'readMessages')
  const snapshots = vi.spyOn(store, 'readSnapshot')
  const query = vi.spyOn(database, 'query')
  expect(
    await store.readBranchPreview({
      sessionId: 'transcript',
      firstMessageId: userId,
      revealedMessageIds: [...ids].reverse().concat(userId),
    })
  ).toEqual({
    sessionId: 'transcript',
    revision: 1,
    threadId: 'old',
    headMessageId: userId,
    headRole: 'user',
    pairedReplyMessageId: replyId,
    followupCount: tailIds.length,
    revealedMessageIds: ids,
  })
  for (const read of [relations, metadata, bodies, snapshots]) expect(read).not.toHaveBeenCalled()
  const aggregateReads = query.mock.calls.flatMap(([sql], index) =>
    sql.includes('reachable(message_id)')
      ? [query.mock.results[index].value as Promise<Array<{ value: string; value_length?: number }>>]
      : []
  )
  expect(aggregateReads.length).toBeGreaterThan(1)
  const slices = await Promise.all(aggregateReads)
  expect(slices[0][0].value_length).toBeGreaterThan(4096)
  for (const rows of slices) {
    expect(rows).toHaveLength(1)
    expect(Array.from(rows[0].value).length).toBeLessThanOrEqual(4096)
    expect(Object.keys(rows[0]).every((key) => key === 'value' || key === 'value_length')).toBe(true)
  }
})

import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowBackedSessionRepository } from '../../../../packages/chatbox-core/src/application/session/RowBackedSessionRepository'
import { SessionRowWriteQueue } from '../../../../packages/chatbox-core/src/application/session/SessionRowWriteQueue'
import { InMemorySessionRecordStore } from '../../../../packages/chatbox-core/src/testing/InMemorySessionRecordStore'
import type { Message } from '../../../../packages/chatbox-core/src/types'
import type { SessionStoredRow } from '@chatbox/core/ports'
import type { SessionRowsDiff } from '../../../../packages/chatbox-core/src/ports'
import { IndexedDBSessionRowStore } from '../SessionRowStorage'
import { SESSION_ROW_DB_NAME, SESSION_ROW_MESSAGE_STORE } from '../session-row-idb-records'

const stores: IndexedDBSessionRowStore[] = []
const message = (id: string, role: Message['role'] = 'assistant', text = id): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text }],
  timestamp: 1,
})
const identity = { seedListId: 'seed', storedListId: 'original', newListId: 'alternative', createdAt: 42 }
async function setup(messages: Message[] = [message('user', 'user'), message('reply')]) {
  const rows = new IndexedDBSessionRowStore()
  stores.push(rows)
  const repository = new RowBackedSessionRepository({
    rows,
    records: new InMemorySessionRecordStore(),
    writes: new SessionRowWriteQueue((_id, run) => run()),
  })
  await repository.createSessionRows({ id: 's', name: 'Rows' }, messages)
  return { rows, repository }
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

describe('IndexedDB local row mutation', () => {
  it('publishes append projections and target body updates with one commit', async () => {
    const { repository } = await setup()
    const appended = await repository.executeSessionCommand('s', {
      type: 'append',
      messages: [message('next', 'user')],
    })
    expect(appended.delta.diff.threads.upsert[0]).toMatchObject({
      activeLeafMessageId: 'next',
      summary: { messageCount: 3, lastUserMessageId: 'next' },
    })
    const checkpoint = await repository.executeSessionCommand('s', {
      type: 'update',
      messageId: 'reply',
      updater: { generating: true },
    })
    expect(checkpoint.delta.diff.messageMetadataUpsert).toEqual([])
    expect(checkpoint.delta.diff.messages.upsert[0]).toMatchObject({
      status: 'generating',
      facts: { contextEligible: false },
    })
    expect(await repository.getSessionHeader('s')).toMatchObject({
      revision: 3,
      summary: { generatingMessageCount: 1 },
      control: { generatingAssistantCount: 1 },
    })
  })

  it.each([false, true])(
    'publishes the final fork projection when leaving an empty branch (summary=%s)',
    async (summaryPoint) => {
      const { repository, rows } = await setup([
        message('user', 'user'),
        ...(summaryPoint ? [{ ...message('summary'), isSummary: true }] : []),
        message('reply'),
      ])
      for (const [newListId, append] of [
        ['alternative', [message('alternative-reply')]],
        ['empty', []],
      ] as const)
        await repository.executeSessionCommand('s', {
          type: 'structure',
          operation: {
            action: 'fork-create',
            pivotId: 'user',
            identity: { ...identity, newListId },
            append: [...append],
          },
        })
      const bodyReads: Array<IDBValidKey | IDBKeyRange> = []
      const get = IDBObjectStore.prototype.get
      vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
        if (this.name === SESSION_ROW_MESSAGE_STORE) bodyReads.push(key)
        return get.call(this, key)
      })
      const result = await repository.executeSessionCommand('s', {
        type: 'structure',
        operation: { action: 'fork-switch', pivotId: 'user', target: 'prev' },
      })
      const published = result.delta.diff.messageMetadataUpsert!
      expect(published.map((row) => row.messageId).sort()).toEqual(summaryPoint ? ['summary', 'user'] : ['user'])
      expect(published.find((row) => row.messageId === 'user')?.fork).toMatchObject({
        pivotId: 'user',
        branchPointId: summaryPoint ? 'summary' : 'user',
        selectedBranchId: 'fork_list_alternative',
        count: 2,
        position: 1,
      })
      const point = published.find((row) => row.messageId === (summaryPoint ? 'summary' : 'user'))!
      expect(point.activeChildId).toBe('alternative-reply')
      expect(point.pendingBranchId).toBeUndefined()
      expect(point.pendingBranchSeq).toBeUndefined()
      const physicalFields = [
        'message',
        'selectedDepth',
        'payloadBytes',
        'tokenPayloadId',
        'parentKey',
        'branchKey',
        'pausedKey',
        'conversationKey',
        'namingRole',
      ]
      expect(published.every((row) => physicalFields.every((key) => !(key in row)))).toBe(true)
      expect(bodyReads).toEqual([])
      const committed = await rows.readMessageMetadata({
        sessionId: 's',
        messageIds: ['user'],
        expectedRevision: result.delta.revision,
      })
      expect(committed?.status === 'ready' && committed.rows[0].fork).toEqual(
        published.find((row) => row.messageId === 'user')?.fork
      )
    }
  )
  it('switches and expands branches using metadata while retaining payloads', async () => {
    const { repository } = await setup([message('user', 'user'), message('reply', 'assistant', 'x'.repeat(180_000))])
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'fork-create', pivotId: 'user', identity, append: [message('alternative-reply')] },
    })
    const bodyReads: Array<IDBValidKey | IDBKeyRange> = []
    const get = IDBObjectStore.prototype.get
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === SESSION_ROW_MESSAGE_STORE) bodyReads.push(key)
      return get.call(this, key)
    })
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'fork-switch', pivotId: 'user', target: { branchId: 'fork_list_original' } },
    })
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'fork-expand', pivotId: 'user' },
    })
    expect(bodyReads).toEqual([])
    const read = await repository.readSessionMessages({ sessionId: 's', messageIds: ['reply', 'alternative-reply'] })
    expect(read?.messages[0].contentParts).toEqual(message('reply', 'assistant', 'x'.repeat(180_000)).contentParts)
    const page = await repository.readSessionTranscriptWindow({ sessionId: 's', origin: 'head', limit: 10 })
    expect(page?.messages.map((entry) => entry.messageId)).toEqual(['user', 'reply', 'alternative-reply'])
  })

  it('reads an inactive branch with the same byte budget and actual consumed cursor', async () => {
    const { repository } = await setup([
      message('user', 'user'),
      message('reply', 'assistant', 'x'.repeat(1000)),
      message('tail'),
    ])
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'fork-create', pivotId: 'user', identity, append: [message('alternative-reply')] },
    })
    const first = await repository.readSessionBranchMessagesPage({
      sessionId: 's',
      firstMessageId: 'reply',
      limit: 10,
      maxBytes: 100,
    })
    expect(first?.messages.map((entry) => entry.messageId)).toEqual(['reply'])
    expect(first?.nextCursor?.messageId).toBe('reply')
    const second = await repository.readSessionBranchMessagesPage({
      sessionId: 's',
      firstMessageId: 'reply',
      limit: 10,
      maxBytes: 100,
      cursor: first!.nextCursor!,
    })
    expect(second?.messages.map((entry) => entry.messageId)).toEqual(['tail'])
    expect(second?.nextCursor).toBeNull()
  })

  it('collapses a pivot from its old children and hydrates the committed parent edges', async () => {
    const { repository, rows } = await setup([message('user', 'user'), message('middle'), message('tail')])
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'message-remove', messageId: 'middle', replacementPivotId: 'hidden' },
    })
    const read = await rows.readMessages({ sessionId: 's', messageIds: ['tail'] })
    expect(read?.messages[0]).toMatchObject({ parentMessageId: 'user', selected: true })
    expect(await repository.getSessionHeader('s')).toMatchObject({ summary: { messageCount: 2 } })
  })

  it('rolls back all staged metadata when a later range is invalid', async () => {
    const { rows } = await setup()
    const previous = (await rows.readCommit('s'))!
    const diff: SessionRowsDiff = {
      sessionId: 's',
      threads: { upsert: [], delete: [] },
      messages: { upsert: [], delete: [] },
      siblingShifts: [
        { threadId: 's', parentMessageId: 'user', afterSeq: -1, delta: 1 },
        { threadId: 's', parentMessageId: 'user', afterSeq: -1, delta: -1 },
      ],
    }
    await expect(rows.applyDiff(diff, { ...previous, revision: 2 }, 1)).rejects.toMatchObject({
      cause: new Error('Invalid row order'),
    })
    expect((await rows.readCommit('s'))?.revision).toBe(1)
    const read = await rows.readMessageMetadata({ sessionId: 's', messageIds: ['reply'], expectedRevision: 1 })
    expect(read?.status === 'ready' && read.rows[0].seq).toBe(0)
  })

  it('clears only the active thread while archived fork rows remain readable', async () => {
    const { repository } = await setup()
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'fork-create', pivotId: 'user', identity, append: [message('alternative-reply')] },
    })
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: {
        action: 'thread-create',
        archiveId: 'new-thread',
        now: 2,
        systemMessageId: 'system',
        defaultSystemPrompt: 'Prompt',
      },
    })
    await repository.executeSessionCommand('s', {
      type: 'structure',
      operation: { action: 'session-clear', scope: 'active' },
    })
    expect(
      (await repository.readSessionMessages({ sessionId: 's', messageIds: ['reply', 'alternative-reply'] }))?.messages
    ).toHaveLength(2)
    expect(await repository.getSessionHeader('s')).toMatchObject({
      activeThreadId: 'new-thread',
      summary: { messageCount: 1, firstSystemMessageId: 'system' },
    })
  })
})

it('transfers authoritative relations and rebuilds the selected index on publication', async () => {
  const { repository, rows } = await setup([message('user', 'user'), message('middle'), message('tail')])
  await repository.executeSessionCommand('s', {
    type: 'structure',
    operation: { action: 'message-remove', messageId: 'middle', replacementPivotId: 'hidden' },
  })
  const transferred: SessionStoredRow[] = []
  for await (const row of rows.iterateRows({ sessionId: 's' })) transferred.push(row)
  const tail = transferred.find((row) => row.kind === 'message' && row.message.messageId === 'tail')
  expect(tail?.kind === 'message' && tail.message.parentMessageId).toBe('user')
  const commit = (await rows.readCommit('s'))!
  const candidate = await rows.stageRows({ ...commit, revision: commit.revision + 1 }, commit.revision)
  for (const row of transferred) {
    if (row.kind === 'thread') await candidate.appendThread(row.thread)
    else await candidate.appendMessage(row.message)
  }
  await candidate.publish()
  await candidate.dispose()
  await repository.executeSessionCommand('s', { type: 'append', messages: [message('after-restore', 'user')] })
  expect(await repository.getSessionHeader('s')).toMatchObject({
    summary: { messageCount: 3, lastUserMessageId: 'after-restore' },
  })
})

it('attributes a cancellable descendant to its nearest inactive branch', async () => {
  const { repository } = await setup([
    message('user', 'user'),
    message('reply'),
    { ...message('stream'), generating: true },
  ])
  await repository.executeSessionCommand('s', {
    type: 'structure',
    operation: { action: 'fork-create', pivotId: 'user', identity, append: [message('alternative-reply')] },
  })
  const control = await repository.readSessionGenerationControl({
    sessionId: 's',
    activeGenerationMessageIds: ['stream', 'missing', 'stream'],
  })
  expect(control).toMatchObject({
    generatingReplyCount: 1,
    anyReplyGenerating: true,
    cancellableMessages: [{ messageId: 'stream', threadId: 's', branchId: 'fork_list_original', forkPivotId: 'user' }],
  })
})

it('pages paused controls from selected metadata and ignores trailing non-conversation rows', async () => {
  const paused = Array.from(
    { length: 201 },
    (_, index): Message => ({
      ...message(`paused-${index}`),
      contentParts: [
        {
          type: 'tool-call',
          toolName: 'read',
          toolCallId: `tool-${index}`,
          state: 'paused',
          args: {},
          pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
        },
      ],
    })
  )
  paused[200].contentParts.push({
    type: 'tool-call',
    toolName: 'web_search',
    toolCallId: 'search',
    state: 'error',
    args: {},
    result: { errorCode: 20024 },
  })
  const { repository } = await setup([
    ...paused,
    message('system', 'system'),
    { ...message('summary', 'user'), isSummary: true },
    { ...message('marker', 'user'), isForkMarker: true },
  ])
  const get = vi.spyOn(IDBObjectStore.prototype, 'get')
  const control = await repository.readSessionGenerationControl({ sessionId: 's', activeGenerationMessageIds: [] })
  expect(control?.pausedMessageIds).toHaveLength(201)
  expect(control?.pausedMessageIds.at(-1)).toBe('paused-200')
  expect(control?.latestMessageHasWebSearchSignInError).toBe(true)
  expect(
    get.mock.instances.filter((store) => (store as IDBObjectStore).name === SESSION_ROW_MESSAGE_STORE)
  ).toHaveLength(0)
  await repository.executeSessionCommand('s', {
    type: 'update',
    messageId: 'paused-200',
    updater: { contentParts: [] },
  })
  expect(
    await repository.readSessionGenerationControl({ sessionId: 's', activeGenerationMessageIds: [] })
  ).toMatchObject({
    pausedMessageIds: paused.slice(0, 200).map((entry) => entry.id),
    latestMessageHasWebSearchSignInError: false,
  })
})

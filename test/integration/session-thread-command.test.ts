import { GenerationRuntimeStore } from '@chatbox/core/generation'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../packages/chatbox-core/src/persistence/session-row-sql'
import { deriveContextReadProjection } from '../../packages/chatbox-core/src/persistence/session-context-read'
import type { SessionRowStorePort } from '../../packages/chatbox-core/src/ports/session-row-store'
import type { SessionThreadOperation } from '../../packages/chatbox-core/src/ports/session-structure-command'
import { deriveSessionTopologyFingerprint } from '../../packages/chatbox-core/src/session/session-tree/topology-fingerprint'
import { InMemorySessionRecordStore } from '../../packages/chatbox-core/src/testing/InMemorySessionRecordStore'
import { InMemorySessionRepository } from '../../packages/chatbox-core/src/testing/InMemorySessionRepository'
import type { Message, Session } from '../../packages/chatbox-core/src/types'
import { RowBackedSessionRepository } from '../../packages/chatbox-core/src/application/session/RowBackedSessionRepository'
import { SessionPersistenceProtocol } from '../../packages/chatbox-core/src/application/session/SessionPersistenceProtocol'
import { SessionService } from '../../packages/chatbox-core/src/application/session/SessionService'
import { SessionWriteCoordinator } from '../../packages/chatbox-core/src/application/session/SessionWriteCoordinator'
import { SessionEventBus } from '../../packages/chatbox-core/src/application/session/session-events'
import { applyThreadStructure } from '../../packages/chatbox-core/src/application/session/session-thread-command'
import { ThreadService } from '../../packages/chatbox-core/src/application/session/ThreadService'

const close: Array<() => void> = []
afterEach(() => {
  for (const dispose of close.splice(0)) dispose()
  vi.restoreAllMocks()
})
const message = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
  timestamp: 1,
})
const source = (): Session => ({
  id: 's',
  name: 'Session',
  threadName: 'Current',
  messages: [message('system', 'system'), message('user'), message('answer', 'assistant')],
  threads: [
    {
      id: 'archive',
      name: 'Archive',
      createdAt: 4,
      messages: [message('old-system', 'system'), message('old-user'), message('old-answer', 'assistant')],
    },
  ],
  settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
})
async function harness(driver: 'sqlite' | 'indexeddb', initial = source()) {
  let rows: SessionRowStorePort
  if (driver === 'sqlite') {
    const db = openNodeSessionRowDatabase()
    close.push(() => db.close())
    rows = new SqlSessionRowStore(db)
  } else {
    globalThis.indexedDB = new IDBFactory()
    rows = new IndexedDBSessionRowStore()
  }
  const records = new InMemorySessionRecordStore()
  const repository = new RowBackedSessionRepository({ records, rows })
  await repository.initialize()
  await repository.setSession(initial)
  const meta = new InMemorySessionRepository().meta
  const repo = Object.assign(repository, { meta })
  const events = new SessionEventBus()
  const sessions = new SessionService(repo, new SessionWriteCoordinator(repo), events, { createId: () => 'unused' })
  let id = 0
  const abort = vi.fn()
  const threads = new ThreadService({
    sessions,
    createId: () => `generated-${++id}`,
    now: () => 10,
    getDefaultSystemPrompt: () => 'Default',
    cancelMessages: vi.fn(),
    cancelMessageIds: abort,
    copySession: async (session) => session,
  })
  return { rows, records, repository, sessions, threads, events, meta, abort }
}

describe.each(['sqlite', 'indexeddb'] as const)('thread structure commands on %s', (driver) => {
  it.each(['switch', 'undo'] as const)(
    'cancels generating/live work without poisoning paused/completed messages after %s',
    async (operation) => {
      const initial = source()
      initial.messages.push(
        {
          ...message('paused', 'assistant'),
          generating: false,
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'approval',
              toolName: 'sandbox_bash',
              state: 'paused',
              pauseReason: { type: 'user_exec_approval', command: 'ls' },
            },
          ],
        },
        { ...message('pre-entry', 'assistant'), generating: true },
        message('live', 'assistant'),
        message('completed', 'assistant')
      )
      const h = await harness(driver, initial)
      const runtime = new GenerationRuntimeStore()
      const live = runtime.start('s', 'live')
      runtime.start('s', 'completed')
      const applyDiff = h.rows.applyDiff.bind(h.rows)
      vi.spyOn(h.rows, 'applyDiff').mockImplementationOnce(async (...args) => {
        const committed = await applyDiff(...args)
        runtime.finishActive('s', 'completed')
        return committed
      })
      let sequence = 0
      const threads = new ThreadService({
        sessions: h.sessions,
        createId: () => `saved-${++sequence}`,
        now: () => 10,
        getDefaultSystemPrompt: () => '',
        getLiveMessageIds: (id) => new Set(runtime.list(id).map((entry) => entry.messageId)),
        cancelMessageIds: (id, ids) => {
          for (const messageId of ids) runtime.requestAbort(id, messageId, 'thread-changed')
        },
        cancelMessages: () => {},
        copySession: async (session) => session,
      })
      const undo = operation === 'undo' ? await threads.createWithRollback('s') : null
      if (operation === 'switch') await threads.switch('s', 'archive')
      expect(live.abortController.signal.aborted).toBe(true)
      expect(runtime.start('s', 'pre-entry').abortController.signal.aborted).toBe(true)
      if (undo) await threads.rollbackCreated(undo)
      else await threads.switch('s', 'saved-1')
      expect(runtime.start('s', 'paused').abortController.signal.aborted).toBe(false)
      expect(runtime.start('s', 'completed').abortController.signal.aborted).toBe(false)
      expect(runtime.start('s', 'system').abortController.signal.aborted).toBe(false)
    }
  )

  it('renames threads using metadata only and publishes structural commits', async () => {
    const h = await harness(driver)
    const full = vi.spyOn(h.rows, 'readSnapshot')
    const selected = vi.spyOn(h.rows, 'readMessages')
    const hash = vi.spyOn(SessionPersistenceProtocol.prototype, 'fingerprint')
    const publish = vi.spyOn(h.events, 'publish')
    await h.threads.edit('s', 's', { name: 'Active title' })
    await h.threads.edit('s', 'archive', { name: 'Archived title' })
    expect(full).not.toHaveBeenCalled()
    expect(selected).not.toHaveBeenCalled()
    expect(hash).not.toHaveBeenCalled()
    expect(publish.mock.calls.every(([event]) => event.type === 'session-command-committed')).toBe(true)
    const read = await h.repository.getSession('s')
    expect(read?.threadName).toBe('Active title')
    expect(read?.threads?.[0].name).toBe('Archived title')
  })

  it('matches complete thread transforms without reading unrelated archived payloads', async () => {
    const initial = source()
    initial.threads!.push({
      id: 'unrelated',
      name: 'Unrelated',
      createdAt: 5,
      messages: Array.from({ length: 100 }, (_, i) => message(`untouched-${i}`)),
    })
    initial.messageForksHash = {
      user: {
        position: 0,
        createdAt: 2,
        lists: [
          { id: 'selected', messages: [] },
          { id: 'alternative', messages: [message('other-answer', 'assistant')] },
        ],
      },
    }
    const h = await harness(driver, initial)
    let expected = (await h.repository.getSession('s'))!
    const full = vi.spyOn(h.rows, 'readSnapshot')
    const selected = vi.spyOn(h.rows, 'readMessages')
    const hash = vi.spyOn(SessionPersistenceProtocol.prototype, 'fingerprint')
    const operations: SessionThreadOperation[] = [
      { action: 'thread-switch', threadId: 'archive', archiveId: 'saved-current', now: 20 },
      {
        action: 'thread-create',
        archiveId: 'saved-second',
        now: 21,
        systemMessageId: 'new-system',
        defaultSystemPrompt: 'Default',
      },
      { action: 'thread-delete', threadId: 's' },
      { action: 'thread-delete', threadId: 'saved-current' },
      {
        action: 'thread-create',
        archiveId: 'compressed',
        now: 22,
        systemMessageId: 'summary-system',
        defaultSystemPrompt: 'Default',
        summary: { messageId: 'summary-user', text: 'Summary' },
      },
    ]
    for (const operation of operations) {
      expected = applyThreadStructure(expected, operation).session
      const result = await h.sessions.executeStructureCommand('s', operation)
      expect(result?.applied).toBe(true)
    }
    expect(full).not.toHaveBeenCalled()
    expect(hash).not.toHaveBeenCalled()
    expect(
      selected.mock.calls.flatMap(([request]) => request.messageIds).some((id) => id.startsWith('untouched-'))
    ).toBe(false)
    const actual = (await h.repository.getSession('s'))!
    expect(actual.messages).toEqual(expected.messages)
    expect(actual.threads).toEqual(expected.threads)
    expect(actual.threadName).toBe(expected.threadName)
    expect(actual.messageForksHash ?? {}).toEqual({})
    const snapshot = (await h.rows.readSnapshot('s'))!
    expect(snapshot.record.topologyFingerprint).toBe(
      deriveSessionTopologyFingerprint(snapshot.rows.threads, snapshot.rows.messages)
    )
    expect(snapshot.record.contextReadProjection).toEqual(
      deriveContextReadProjection(snapshot.rows.threads, snapshot.rows.messages)
    )
  })

  it('copies the normalized system prompt from imported legacy row payloads', async () => {
    const h = await harness(driver)
    const before = (await h.rows.readSnapshot('s'))!
    await h.rows.writeRows(
      {
        ...before,
        revision: before.revision + 1,
        rows: {
          ...before.rows,
          messages: before.rows.messages.map((row) =>
            row.messageId === 'system'
              ? { ...row, message: { ...row.message, contentParts: [], content: 'Legacy system prompt' } as Message }
              : row
          ),
        },
      },
      before.revision
    )
    h.repository.forgetBaseline('s')
    await h.threads.createWithRollback('s')
    expect((await h.repository.getSession('s'))?.messages[0].contentParts).toEqual([
      { type: 'text', text: 'Legacy system prompt' },
    ])
  })

  it('returns revision-owned undo receipts and rejects stale or nonempty rollback', async () => {
    const h = await harness(driver)
    const original = (await h.repository.getSession('s'))!
    const receipt = (await h.threads.createWithRollback('s'))!
    expect(await h.threads.rollbackCreated(receipt)).toBe(true)
    expect(await h.threads.rollbackCreated(receipt)).toBe(false)
    expect((await h.repository.getSession('s'))?.messages).toEqual(original.messages)
    const next = (await h.threads.createWithRollback('s'))!
    await h.sessions.insertMessages('s', [message('sent')])
    expect(await h.threads.rollbackCreated(next)).toBe(false)
    expect((await h.repository.getSession('s'))?.messages.at(-1)?.id).toBe('sent')
  })

  it('runs cancellation after a durable commit even when list metadata fails', async () => {
    const initial = source()
    initial.messages[2].generating = true
    const h = await harness(driver, initial)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('meta failed'))
      await expect(h.threads.switch('s', 'archive')).rejects.toThrow('meta failed')
      expect(h.abort).toHaveBeenCalledWith('s', ['answer'])
      expect((await h.repository.getSession('s'))?.messages[0].id).toBe('old-system')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps payload identities and commits thread transfers atomically', async () => {
    const h = await harness(driver)
    const before = (await h.rows.readSnapshot('s'))!
    const ids = before.rows.messages.map((row) => row.messageId)
    const tokens = (await h.rows.readMessages({ sessionId: 's', messageIds: ids }))?.textTokens
    const apply = vi.spyOn(h.rows, 'applyDiff').mockRejectedValueOnce(new Error('disk failed'))
    await expect(h.threads.switch('s', 'archive')).rejects.toThrow('disk failed')
    expect(h.abort).not.toHaveBeenCalled()
    expect(await h.rows.readSnapshot('s')).toEqual(before)
    apply.mockRestore()
    await h.threads.switch('s', 'archive')
    const after = (await h.rows.readMessages({ sessionId: 's', messageIds: ids }))!
    expect(after.messages.map((row) => row.message)).toEqual(before.rows.messages.map((row) => row.message))
    expect(after.textTokens?.sources).toEqual(tokens?.sources)
  })

  it('rejects a stale structural commit and leaves all rows intact', async () => {
    const h = await harness(driver)
    const before = (await h.rows.readStructure!({ sessionId: 's' }))!
    await h.sessions.updateSessionHeader('s', { name: 'Concurrent' })
    await expect(
      h.repository.executeSessionCommand(
        's',
        { type: 'structure', operation: { action: 'thread-delete', threadId: 'archive' } },
        before.revision
      )
    ).rejects.toMatchObject({ name: 'SessionWriteConflictError' })
    expect((await h.repository.getSession('s'))?.threads?.map((thread) => thread.id)).toEqual(['archive'])
  })
})

import { MessageAnchorNotFoundError } from '../../packages/chatbox-core/src/application/session/message-tree'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { SessionQueryBridge } from '../../packages/chatbox-react/src/query/session-query-bridge'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../packages/chatbox-core/src/persistence/session-row-sql'
import { deriveContextReadProjection } from '../../packages/chatbox-core/src/persistence/session-context-read'
import type { SessionRowStorePort } from '../../packages/chatbox-core/src/ports/session-row-store'
import type { SessionMessageStructureOperation } from '../../packages/chatbox-core/src/ports/session-structure-command'
import { encodeSessionTree } from '../../packages/chatbox-core/src/session/session-tree/encode'
import { decodeSessionTree } from '../../packages/chatbox-core/src/session/session-tree/decode'
import { InMemorySessionRecordStore } from '../../packages/chatbox-core/src/testing/InMemorySessionRecordStore'
import { InMemorySessionRepository } from '../../packages/chatbox-core/src/testing/InMemorySessionRepository'
import type { Message, Session } from '../../packages/chatbox-core/src/types'
import { RowBackedSessionRepository } from '../../packages/chatbox-core/src/application/session/RowBackedSessionRepository'
import { SessionService } from '../../packages/chatbox-core/src/application/session/SessionService'
import { SessionWriteCoordinator } from '../../packages/chatbox-core/src/application/session/SessionWriteCoordinator'
import { SessionEventBus } from '../../packages/chatbox-core/src/application/session/session-events'
import { applyMessageStructure } from '../../packages/chatbox-core/src/application/session/session-message-structure'
import { ChatMessageService } from '../../packages/chatbox-core/src/application/chat/ChatMessageService'
import { GenerationRuntimeStore } from '../../packages/chatbox-core/src/generation/runtime-store'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
  vi.restoreAllMocks()
})
const message = (id: string, role: Message['role'] = 'user'): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
  timestamp: 1,
})
function fixture(): Session {
  return {
    id: 's',
    name: 'S',
    threadName: 'Current',
    type: 'chat',
    settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: [message('system', 'system'), message('pivot'), message('answer', 'assistant'), message('last')],
    threads: [
      {
        id: 'archive',
        name: 'Old',
        createdAt: 2,
        messages: [message('old-system', 'system'), message('old-user'), message('old-answer', 'assistant')],
      },
    ],
  }
}
function branch(session: Session, pivotId: string, stored: Message[], position = 0) {
  session.messageForksHash = {
    ...session.messageForksHash,
    [pivotId]: {
      position,
      createdAt: 3,
      lists: [
        { id: `${pivotId}-active`, messages: [] },
        { id: `${pivotId}-saved`, messages: stored },
      ],
    },
  }
  return session
}
async function harness(driver: 'sqlite' | 'indexeddb', initial = fixture()) {
  let rows: SessionRowStorePort
  if (driver === 'sqlite') {
    const db = openNodeSessionRowDatabase()
    cleanup.push(() => db.close())
    rows = new SqlSessionRowStore(db)
  } else {
    globalThis.indexedDB = new IDBFactory()
    rows = new IndexedDBSessionRowStore()
  }
  const records = new InMemorySessionRecordStore()
  const repository = Object.assign(new RowBackedSessionRepository({ rows, records }), {
    meta: new InMemorySessionRepository().meta,
  })
  await repository.initialize()
  await repository.setSession(initial)
  const events = new SessionEventBus()
  const sessions = new SessionService(repository, new SessionWriteCoordinator(repository), events, {
    createId: () => 'generated',
  })
  return { rows, records, repository, sessions, events }
}
function normalized(session: Session) {
  const encoded = encodeSessionTree(session, { activeThreadId: session.id })
  if (!encoded.ok) throw new Error(encoded.reason)
  const decoded = decodeSessionTree(encoded.tree)
  if (!decoded.ok) throw new Error(decoded.reason)
  return { ...decoded.session, messageForksHash: decoded.session.messageForksHash ?? {} }
}
const remove = (id: string): SessionMessageStructureOperation => ({
  action: 'message-remove',
  messageId: id,
  replacementPivotId: 'replacement',
})
const cases: Array<{ name: string; initial: () => Session; operation: SessionMessageStructureOperation }> = [
  { name: 'ordinary deletion', initial: fixture, operation: remove('answer') },
  { name: 'root deletion', initial: fixture, operation: remove('system') },
  {
    name: 'pivot with parent',
    initial: () => branch(fixture(), 'pivot', [message('saved')]),
    operation: remove('pivot'),
  },
  {
    name: 'root fork pivot',
    initial: () => branch(fixture(), 'system', [message('saved')]),
    operation: remove('system'),
  },
  {
    name: 'nested active pivot',
    initial: () => branch(branch(fixture(), 'system', [message('outer')]), 'pivot', [message('inner')]),
    operation: remove('pivot'),
  },
  {
    name: 'nested inactive pivot',
    initial: () =>
      branch(branch(fixture(), 'system', [message('inactive'), message('inactive-tail')]), 'inactive', [
        message('inner'),
      ]),
    operation: remove('inactive'),
  },
  {
    name: 'empty active branch',
    initial: () => {
      const s = fixture()
      s.messages = s.messages.slice(0, 3)
      return branch(s, 'pivot', [message('saved')])
    },
    operation: remove('answer'),
  },
  {
    name: 'empty inactive branch',
    initial: () => branch(fixture(), 'pivot', [message('saved')]),
    operation: remove('saved'),
  },
  {
    name: 'summary anchored pivot',
    initial: () => {
      const s = fixture()
      s.messages.splice(2, 0, { ...message('summary', 'assistant'), isSummary: true })
      s.compactionPoints = [{ boundaryMessageId: 'pivot', summaryMessageId: 'summary', createdAt: 2 }]
      return branch(s, 'pivot', [message('saved')])
    },
    operation: remove('pivot'),
  },
  {
    name: 'summary deletion',
    initial: () => {
      const s = fixture()
      s.messages.splice(2, 0, { ...message('summary', 'assistant'), isSummary: true })
      s.compactionPoints = [{ boundaryMessageId: 'pivot', summaryMessageId: 'summary', createdAt: 2 }]
      return branch(s, 'pivot', [message('saved')])
    },
    operation: remove('summary'),
  },
  {
    name: 'middle insertion',
    initial: fixture,
    operation: {
      action: 'message-insert-after',
      message: message('inserted', 'assistant'),
      previousId: 'pivot',
      requireAnchor: true,
    },
  },
  {
    name: 'archived insertion',
    initial: fixture,
    operation: {
      action: 'message-insert-after',
      message: message('inserted', 'assistant'),
      previousId: 'old-user',
      requireAnchor: true,
    },
  },
  {
    name: 'selected branch insertion',
    initial: () => branch(fixture(), 'pivot', [message('saved')]),
    operation: {
      action: 'message-insert-after',
      message: message('inserted', 'assistant'),
      previousId: 'pivot',
      requireAnchor: true,
    },
  },
  {
    name: 'summary adjacent insertion',
    initial: () => {
      const s = fixture()
      s.messages.splice(2, 0, { ...message('summary', 'assistant'), isSummary: true })
      s.compactionPoints = [{ boundaryMessageId: 'pivot', summaryMessageId: 'summary', createdAt: 2 }]
      return branch(s, 'pivot', [message('saved')])
    },
    operation: {
      action: 'message-insert-after',
      message: message('inserted', 'assistant'),
      previousId: 'pivot',
      requireAnchor: true,
    },
  },
  {
    name: 'later selected branch insertion',
    initial: () => {
      const s = branch(fixture(), 'pivot', [message('saved')])
      const fork = s.messageForksHash!.pivot
      fork.lists.reverse()
      fork.position = 1
      return s
    },
    operation: {
      action: 'message-insert-after',
      message: message('inserted', 'assistant'),
      previousId: 'pivot',
      requireAnchor: true,
    },
  },
  {
    name: 'empty selected branch insertion',
    initial: () => {
      const s = fixture()
      s.messages = s.messages.slice(0, 2)
      s.messageForksHash = {
        pivot: {
          position: 1,
          createdAt: 3,
          lists: [
            { id: 'saved-list', messages: [message('saved')] },
            { id: 'empty-list', messages: [] },
          ],
        },
      }
      return s
    },
    operation: {
      action: 'message-insert-after',
      message: message('inserted', 'assistant'),
      previousId: 'pivot',
      requireAnchor: true,
    },
  },
  {
    name: 'optional missing anchor',
    initial: fixture,
    operation: { action: 'message-insert-after', message: message('inserted'), previousId: 'missing' },
  },
  ...(['active', 'all'] as const).flatMap((scope) => [
    {
      name: `clear ${scope}`,
      initial: () => branch(branch(fixture(), 'pivot', [message('saved')]), 'old-user', [message('old-saved')]),
      operation: { action: 'session-clear', scope } as const,
    },
    {
      name: `clear ${scope} no system`,
      initial: () => {
        const s = fixture()
        s.messages = s.messages.slice(1)
        return s
      },
      operation: { action: 'session-clear', scope } as const,
    },
  ]),
]

describe.each(['sqlite', 'indexeddb'] as const)('message structure commands on %s', (driver) => {
  it.each(cases)('matches legacy topology for $name', async ({ initial, operation }) => {
    const h = await harness(driver, initial())
    const before = (await h.repository.getSession('s'))!
    const expected = normalized(applyMessageStructure(before, operation).session)
    const fullRead = vi.spyOn(h.rows, 'readSnapshot')
    const fullWrite = vi.spyOn(h.rows, 'writeRows')
    const diff = vi.spyOn(h.rows, 'applyDiff')
    const result = await h.repository.executeSessionCommand('s', { type: 'structure', operation })
    expect(result?.kind).toBe('rows')
    expect(fullRead).not.toHaveBeenCalled()
    expect(fullWrite).not.toHaveBeenCalled()
    expect(diff.mock.calls[0]?.[0].messages.upsert.length ?? 0).toBeLessThanOrEqual(1)
    expect(normalized((await h.repository.getSession('s'))!)).toEqual(expected)
    const snapshot = await h.rows.readSnapshot('s')
    expect(snapshot?.record.contextReadProjection).toEqual(
      deriveContextReadProjection(snapshot!.rows.threads, snapshot!.rows.messages)
    )
  })

  it('reports content completion for both insertion forms', async () => {
    const h = await harness(driver)
    const committed = vi.fn()
    const fullWrite = vi.spyOn(h.rows, 'writeRows')
    await h.sessions.insertMessage('s', message('tail-insert'), undefined, { onPersisted: committed })
    await h.sessions.insertMessage('s', message('middle-insert'), 'pivot', { onPersisted: committed })
    expect(committed).toHaveBeenCalledTimes(2)
    expect(committed.mock.calls.every(([header]) => header.id === 's' && !('messages' in header))).toBe(true)
    expect(fullWrite).not.toHaveBeenCalled()
    const full = vi.fn()
    await h.sessions.insertMessage('s', message('compat-insert'), 'pivot', {
      onPersisted: committed,
      onFullSessionPersisted: full,
    })
    expect(full.mock.calls[0][0].messages.some((message: Message) => message.id === 'compat-insert')).toBe(true)
    expect(committed).toHaveBeenCalledTimes(3)
    vi.spyOn(h.repository.meta, 'update').mockRejectedValue(new Error('metadata failed'))
    await expect(
      h.sessions.insertMessage('s', message('durable-insert'), 'pivot', { onPersisted: committed })
    ).rejects.toThrow('metadata failed')
    expect(committed).toHaveBeenCalledTimes(4)
  })

  it('requires a visible anchor, is idempotent, and rejects cross-thread duplicate identities', async () => {
    const h = await harness(driver, branch(fixture(), 'pivot', [message('saved')]))
    const execute = (previousId: string, id = 'inserted') =>
      h.sessions.executeStructureCommand('s', {
        action: 'message-insert-after',
        previousId,
        message: message(id),
        requireAnchor: true,
      })
    await expect(execute('saved')).rejects.toThrow(MessageAnchorNotFoundError)
    await execute('pivot')
    const revision = await h.rows.getRevision('s')
    await execute('pivot')
    expect(await h.rows.getRevision('s')).toBe(revision)
    await expect(execute('old-user', 'answer')).rejects.toThrow('identity')
    await expect(
      h.sessions.executeStructureCommand('s', {
        action: 'message-insert-after',
        previousId: 'missing',
        message: message('old-user'),
      })
    ).rejects.toThrow('identity')
  })

  it('rejects stale structure CAS and retains legacy fallback', async () => {
    const h = await harness(driver)
    const revision = (await h.rows.getRevision('s'))!
    await h.sessions.updateSessionHeader('s', { name: 'new' })
    await expect(
      h.repository.executeSessionCommand('s', { type: 'structure', operation: remove('answer') }, revision)
    ).rejects.toThrow()
    await h.rows.deleteRows('s')
    await h.records.setRecord(fixture())
    h.repository.forgetSessionState('s')
    vi.spyOn(h.rows, 'writeRows').mockRejectedValue(new Error('migration unavailable'))
    await h.sessions.executeStructureCommand('s', remove('answer'))
    expect((await h.repository.getSession('s'))?.messages.map((message) => message.id)).not.toContain('answer')
  })

  it('reports durable removal before metadata failure and returns shared attachment owners', async () => {
    const initial = fixture()
    initial.messages[1].files = [
      { id: 'file', name: 'shared', fileType: 'text/plain', storageKey: 'file', sessionAttachmentId: 12 },
    ]
    initial.messages[2].files = initial.messages[1].files
    const h = await harness(driver, initial)
    vi.spyOn(h.repository.meta, 'update').mockRejectedValue(new Error('metadata failed'))
    const committed = vi.fn()
    await expect(h.sessions.executeStructureCommand('s', remove('pivot'), committed)).rejects.toThrow('metadata failed')
    expect(committed).toHaveBeenCalledOnce()
    expect(committed.mock.calls[0][0].removedMessages[0].id).toBe('pivot')
    expect(committed.mock.calls[0][0].survivingMessages.map((message: Message) => message.id)).toContain('answer')
    expect((await h.repository.getSession('s'))?.messages.map((message) => message.id)).not.toContain('pivot')
  })

  it('routes shared reply/delete/clear through structure commits and discards removed paused runtimes', async () => {
    const h = await harness(driver)
    const runtime = new GenerationRuntimeStore()
    const generation = { orchestrate: vi.fn().mockResolvedValue(undefined) }
    const chat = new ChatMessageService({
      sessions: h.sessions,
      generation,
      runtime,
      createId: () => 'reply',
      now: () => 10,
    })
    const fullWrite = vi.spyOn(h.sessions, 'updateSessionWithMessages')
    await chat.replyBelow('s', 'pivot')
    expect(generation.orchestrate).toHaveBeenCalledOnce()
    await h.sessions.updateMessage('s', 'reply', { generating: false })
    const live = runtime.start('s', 'reply')
    runtime.setPhase('s', 'reply', 'paused', live)
    await chat.deleteMessage('s', 'reply')
    expect(live.abortController.signal.aborted).toBe(true)
    await chat.clearMessages('s')
    expect(fullWrite).not.toHaveBeenCalled()
    expect((await h.repository.getSession('s'))?.threads).toHaveLength(1)
  })
  it('preserves another reply live overlay during removal and does not revive the deleted message', async () => {
    const initial = fixture()
    initial.messages[2].generating = true
    const h = await harness(driver, initial)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const bridge = new SessionQueryBridge(client, h.sessions, h.events)
    cleanup.push(() => {
      bridge.dispose()
      client.clear()
    })
    const observer = new QueryObserver(client, bridge.definitions.readModel('s'))
    cleanup.push(observer.subscribe(() => {}))
    await observer.refetch()
    await bridge.updateMessageCache('s', 'answer', { contentParts: [{ type: 'text', text: 'live ABC' }] })
    await h.sessions.executeStructureCommand('s', remove('last'))
    const model = observer.getCurrentResult().data
    expect(model?.kind).toBe('full')
    if (model?.kind !== 'full') throw new Error('Expected full generating history')
    expect(model.session.messages.find((message) => message.id === 'answer')?.contentParts).toEqual([
      { type: 'text', text: 'live ABC' },
    ])
    expect(model.session.messages.some((message) => message.id === 'last')).toBe(false)
  })

  it('reads a bounded first page to retain the first system message when clearing', async () => {
    const initial = fixture()
    initial.messages.push(...Array.from({ length: 200 }, (_, i) => message(`tail-${i}`)))
    const h = await harness(driver, initial)
    const selected = vi.spyOn(h.rows, 'readMessages')
    await h.sessions.executeStructureCommand('s', { action: 'session-clear', scope: 'all' })
    expect(selected.mock.calls.every(([request]) => request.messageIds.length <= 32)).toBe(true)
    expect(selected.mock.calls.flatMap(([request]) => request.messageIds).length).toBeLessThanOrEqual(33)
  })
})

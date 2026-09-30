import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { SqlSessionRowStore } from '../../packages/chatbox-core/src/persistence/session-row-sql'
import { deriveContextReadProjection } from '../../packages/chatbox-core/src/persistence/session-context-read'
import type { SessionRowStorePort } from '../../packages/chatbox-core/src/ports/session-row-store'
import type { SessionForkOperation } from '../../packages/chatbox-core/src/ports/session-fork-command'
import { encodeSessionTree } from '../../packages/chatbox-core/src/session/session-tree/encode'
import { decodeSessionTree } from '../../packages/chatbox-core/src/session/session-tree/decode'
import { deriveSessionTopologyFingerprint } from '../../packages/chatbox-core/src/session/session-tree/topology-fingerprint'
import { InMemorySessionRecordStore } from '../../packages/chatbox-core/src/testing/InMemorySessionRecordStore'
import { InMemorySessionRepository } from '../../packages/chatbox-core/src/testing/InMemorySessionRepository'
import type { Message, Session } from '../../packages/chatbox-core/src/types'
import { RowBackedSessionRepository } from '../../packages/chatbox-core/src/application/session/RowBackedSessionRepository'
import { SessionService } from '../../packages/chatbox-core/src/application/session/SessionService'
import { SessionWriteCoordinator } from '../../packages/chatbox-core/src/application/session/SessionWriteCoordinator'
import { SessionEventBus } from '../../packages/chatbox-core/src/application/session/session-events'
import { applyForkStructure } from '../../packages/chatbox-core/src/application/session/session-fork-command'
import { ForkService } from '../../packages/chatbox-core/src/application/session/ForkService'
import { saveAndResendMessage } from '../../packages/chatbox-core/src/application/chat/save-and-resend'
import { ChatMessageService } from '../../packages/chatbox-core/src/application/chat/ChatMessageService'

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
  const forks = new ForkService(sessions, { createId: () => `generated-${++id}`, now: () => 10 })
  return { rows, records, repository, sessions, forks, events, meta }
}

const identity = (prefix: string) => ({
  seedListId: `${prefix}-seed`,
  storedListId: `${prefix}-old`,
  newListId: `${prefix}-new`,
  createdAt: 10,
})
function roundtrip(session: Session): Session {
  const encoded = encodeSessionTree(session, { activeThreadId: session.id, now: 10 })
  if (!encoded.ok) throw new Error(encoded.reason)
  const decoded = decodeSessionTree(encoded.tree)
  if (!decoded.ok) throw new Error(decoded.reason)
  return { ...decoded.session, messageForksHash: decoded.session.messageForksHash ?? {} }
}

describe.each(['sqlite', 'indexeddb'] as const)('fork structure commands on %s', (driver) => {
  it('matches legacy create/switch/save/delete transforms while retaining payload identities', async () => {
    const h = await harness(driver)
    let expected = (await h.repository.getSession('s'))!
    const operations: SessionForkOperation[] = [
      {
        action: 'fork-create',
        pivotId: 'user',
        identity: identity('first'),
        append: [message('new-answer', 'assistant')],
      },
      { action: 'fork-switch', pivotId: 'user', target: 'prev' },
      {
        action: 'fork-save-resend',
        targetMessageId: 'user',
        replacement: message('edited-user'),
        identity: identity('edit'),
        append: [message('edited-answer', 'assistant')],
      },
      { action: 'fork-switch', pivotId: 'system', target: 'prev' },
      { action: 'fork-delete', pivotId: 'system' },
    ]
    for (const operation of operations) {
      const previousIds = new Set(
        (await h.rows.readStructure!({ sessionId: 's' }))!.messages.map((row) => row.messageId)
      )
      const write = vi.spyOn(h.rows, 'applyDiff')
      const full = vi.spyOn(h.rows, 'readSnapshot')
      const selected = vi.spyOn(h.rows, 'readMessages')
      expected = roundtrip(applyForkStructure(expected, operation).session)
      await h.sessions.executeStructureCommand('s', operation)
      expect(full).not.toHaveBeenCalled()
      expect(
        write.mock.calls.flatMap(([diff]) => diff.messages.upsert).some((row) => previousIds.has(row.messageId))
      ).toBe(false)
      write.mockRestore()
      expect(selected.mock.calls.flatMap(([request]) => request.messageIds).some((id) => id.startsWith('old-'))).toBe(
        false
      )
      full.mockRestore()
      selected.mockRestore()
      expect(await h.repository.getSession('s')).toEqual(expected)
      const snapshot = (await h.rows.readSnapshot('s'))!
      expect(snapshot.record.contextReadProjection).toEqual(
        deriveContextReadProjection(snapshot.rows.threads, snapshot.rows.messages)
      )
      expect(snapshot.record.topologyFingerprint).toBe(
        deriveSessionTopologyFingerprint(snapshot.rows.threads, snapshot.rows.messages)
      )
    }
  })

  it('drops an empty branch when switching and keeps summary anchors and checkpoint endpoints', async () => {
    const initial = source()
    initial.messages.splice(2, 0, { ...message('summary', 'assistant'), isSummary: true })
    initial.compactionPoints = [{ boundaryMessageId: 'user', summaryMessageId: 'summary', createdAt: 2 }]
    const h = await harness(driver, initial)
    let expected = (await h.repository.getSession('s'))!
    for (const operation of [
      { action: 'fork-create', pivotId: 'user', identity: identity('empty') },
      { action: 'fork-switch', pivotId: 'user', target: 'prev' },
    ] satisfies SessionForkOperation[]) {
      expected = roundtrip(applyForkStructure(expected, operation).session)
      await h.sessions.executeStructureCommand('s', operation)
      expect(await h.repository.getSession('s')).toEqual(expected)
      const snapshot = (await h.rows.readSnapshot('s'))!
      expect(snapshot.record.contextReadProjection).toEqual(
        deriveContextReadProjection(snapshot.rows.threads, snapshot.rows.messages)
      )
    }
    expect(expected.messages.map((message) => message.id)).toEqual(['system', 'user', 'summary', 'answer'])
  })

  it('rejects stale revisions and duplicate ids from another thread without writes', async () => {
    const h = await harness(driver)
    const before = (await h.rows.readSnapshot('s'))!
    await expect(
      h.repository.executeSessionCommand('s', {
        type: 'structure',
        operation: { action: 'fork-create', pivotId: 'user', identity: identity('dup'), append: [message('old-user')] },
      })
    ).rejects.toThrow('Duplicate')
    expect((await h.rows.readSnapshot('s'))?.revision).toBe(before.revision)
    await expect(
      h.repository.executeSessionCommand(
        's',
        { type: 'structure', operation: { action: 'fork-create', pivotId: 'user', identity: identity('stale') } },
        before.revision + 1
      )
    ).rejects.toThrow()
    expect((await h.rows.readSnapshot('s'))?.revision).toBe(before.revision)
  })

  it('keeps inactive runtime generation locked and reports removals after commit', async () => {
    const initial = source()
    initial.messages[2].generating = true
    initial.settings!.agentMode = { value: 'on', locked: false, lockReason: null }
    const h = await harness(driver, initial)
    await h.sessions.executeStructureCommand('s', {
      action: 'fork-create',
      pivotId: 'user',
      identity: identity('branch'),
      append: [message('second-answer', 'assistant')],
    })
    const guardedForks = new ForkService(h.sessions, { createId: () => 'unused', now: () => 10 }, () => ({
      activeGenerationMessageIds: new Set(['answer']),
    }))
    await expect(guardedForks.switch('s', 'user', 'prev')).rejects.toThrow('generating')
    const committed = vi.fn()
    await h.sessions.executeStructureCommand('s', { action: 'fork-delete', pivotId: 'user' }, committed)
    expect(committed).toHaveBeenCalledWith(
      expect.objectContaining({ applied: true, removedMessages: [message('second-answer', 'assistant')] })
    )
    expect((await h.repository.getSession('s'))?.messages.at(-1)?.id).toBe('answer')
  })
  it('returns attachment ownership transfers after durable deletion even if metadata fails', async () => {
    const initial = source()
    const file = { id: 'file', name: 'shared.txt', fileType: 'text/plain', sessionAttachmentId: 12 }
    initial.messages[1].files = [file]
    const h = await harness(driver, initial)
    await h.sessions.executeStructureCommand('s', {
      action: 'fork-save-resend',
      targetMessageId: 'user',
      replacement: { ...message('edited'), files: [file] },
      identity: identity('files'),
    })
    await h.sessions.executeStructureCommand('s', { action: 'fork-switch', pivotId: 'system', target: 'prev' })
    const committed = vi.fn()
    vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('metadata unavailable'))
    await expect(
      h.sessions.executeStructureCommand('s', { action: 'fork-delete', pivotId: 'system' }, committed)
    ).rejects.toThrow('metadata unavailable')
    expect(committed).toHaveBeenCalledOnce()
    const result = committed.mock.calls[0][0]
    expect(result.removedMessages.map((message: Message) => message.id)).toContain('user')
    expect(result.survivingMessages.find((message: Message) => message.id === 'edited')?.files).toEqual([file])
    expect((await h.repository.getSession('s'))?.messages.map((message) => message.id)).toEqual(['system', 'edited'])
    const snapshot = (await h.rows.readSnapshot('s'))!
    expect(snapshot.record.contextReadProjection).toEqual(
      deriveContextReadProjection(snapshot.rows.threads, snapshot.rows.messages)
    )
  })
  it('routes save-and-resend and retry through structure commits with durable placeholders', async () => {
    const initial = source()
    initial.settings = { ...initial.settings!, provider: 'provider', modelId: 'model' }
    const h = await harness(driver, initial)
    const fullWrite = vi.spyOn(h.repository, 'setSession')
    const events = vi.spyOn(h.events, 'publish')
    let id = 0
    const generation = { orchestrate: vi.fn().mockResolvedValue(undefined) }
    const onPersisted = vi.fn()
    await saveAndResendMessage(
      { sessions: h.sessions, generation, createId: () => `send-${++id}`, now: () => 10 },
      {
        sessionId: 's',
        messageId: 'user',
        expectedContentParts: initial.messages[1].contentParts,
        contentParts: [{ type: 'text', text: 'edited' }],
        onPersisted,
      }
    )
    expect(onPersisted).toHaveBeenCalledOnce()
    expect(generation.orchestrate).toHaveBeenCalledWith(
      's',
      expect.objectContaining({ id: 'send-1', generating: true }),
      { operationType: 'regenerate' }
    )
    expect(fullWrite).not.toHaveBeenCalled()
    expect(events.mock.calls[0][0].type).toBe('session-command-committed')
    await h.sessions.updateMessage('s', 'send-1', { generating: false })
    const chat = new ChatMessageService({
      sessions: h.sessions,
      generation,
      createId: () => `retry-${++id}`,
      now: () => 11,
    })
    await chat.retryMessage('s', 'send-1')
    expect(fullWrite).not.toHaveBeenCalled()
    expect((await h.repository.getSession('s'))?.messages.at(-1)?.generating).toBe(true)
    expect(generation.orchestrate).toHaveBeenCalledTimes(2)
  })

  it('preserves raw legacy row payloads while using migrated messages for presentation', async () => {
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
              ? {
                  ...row,
                  message: { ...row.message, contentParts: [], content: 'Legacy system prompt' } as Message,
                }
              : row
          ),
        },
      },
      before.revision
    )
    h.repository.forgetBaseline('s')
    const full = vi.spyOn(h.rows, 'readSnapshot')
    await h.forks.create('s', 'user')
    expect(full).not.toHaveBeenCalled()
    full.mockRestore()
    expect((await h.repository.getSession('s'))?.messages[0].contentParts).toEqual([
      { type: 'text', text: 'Legacy system prompt' },
    ])
    expect(
      (await h.rows.readSnapshot('s'))?.rows.messages.find((row) => row.messageId === 'system')?.message.contentParts
    ).toEqual([])
  })

  it('prunes nested fork metadata only inside the removed subtree', async () => {
    const initial = source()
    initial.messages.push(message('inner-pivot'), message('inner-answer', 'assistant'))
    initial.messageForksHash = {
      user: {
        position: 0,
        createdAt: 2,
        lists: [
          { id: 'current', messages: [] },
          { id: 'alternate', messages: [message('survivor', 'assistant')] },
        ],
      },
      'inner-pivot': {
        position: 0,
        createdAt: 3,
        lists: [
          { id: 'inner-current', messages: [] },
          { id: 'inner-saved', messages: [message('inner-other', 'assistant')] },
        ],
      },
    }
    const h = await harness(driver, initial)
    const before = (await h.repository.getSession('s'))!
    const operation = { action: 'fork-delete', pivotId: 'user' } satisfies SessionForkOperation
    const expected = roundtrip(applyForkStructure(before, operation).session)
    const removed = vi.fn()
    await h.sessions.executeStructureCommand('s', operation, removed)
    expect(await h.repository.getSession('s')).toEqual(expected)
    expect(removed.mock.calls[0][0].removedMessages.map((message: Message) => message.id).sort()).toEqual([
      'answer',
      'inner-answer',
      'inner-other',
      'inner-pivot',
    ])
    const snapshot = (await h.rows.readSnapshot('s'))!
    expect(snapshot.record.forkCreatedAt ?? {}).toEqual({})
  })
  it('keeps legacy writes durable when row migration is unavailable', async () => {
    const initial = source()
    const h = await harness(driver, initial)
    await h.rows.deleteRows('s')
    await h.records.setRecord(initial)
    h.repository.forgetBaseline('s')
    vi.spyOn(h.rows, 'writeRows').mockRejectedValue(new Error('Row store unavailable'))
    expect(await h.rows.readSnapshot('s')).toBeNull()
    const before = (await h.repository.getSession('s'))!
    const operation = {
      action: 'fork-create',
      pivotId: 'user',
      identity: identity('legacy'),
    } satisfies SessionForkOperation
    const result = await h.repository.executeSessionCommand('s', { type: 'structure', operation })
    expect(result.kind).toBe('full')
    expect((await h.repository.getSession('s'))?.messages).toEqual(
      applyForkStructure(before, operation).session.messages
    )
    expect((await h.repository.getSession('s'))?.threads).toEqual(before.threads)
  })
  it.each(['create', 'retry', 'save-resend'] as const)(
    'allocates fork identity at an archived pivot during legacy %s',
    async (operation) => {
      const initial = source()
      const h = await harness(driver, initial)
      await h.rows.deleteRows('s')
      await h.records.setRecord(initial)
      h.repository.forgetBaseline('s')
      vi.spyOn(h.rows, 'writeRows').mockRejectedValue(new Error('Row store unavailable'))
      if (operation === 'create') await h.forks.create('s', 'old-user')
      else if (operation === 'save-resend') await h.forks.saveAndResend('s', 'old-user', message('edited-old-user'))
      else {
        let id = 0
        const generation = { orchestrate: vi.fn().mockResolvedValue(undefined) }
        const chat = new ChatMessageService({
          sessions: h.sessions,
          generation,
          createId: () => `retry-${++id}`,
          now: () => 10,
        })
        await chat.retryMessage('s', 'old-answer')
        expect(generation.orchestrate).toHaveBeenCalledOnce()
      }
      const saved = (await h.repository.getSession('s'))!
      expect(saved.messages).toEqual(initial.messages)
      const pivot = operation === 'save-resend' ? 'old-system' : 'old-user'
      expect(saved.messageForksHash?.[pivot]?.lists).toHaveLength(2)
      expect(saved.messageForksHash?.[pivot]?.lists[0].messages.map((message) => message.id)).toContain(
        operation === 'save-resend' ? 'old-user' : 'old-answer'
      )
      if (operation === 'retry') expect(saved.threads?.[0].messages.at(-1)?.generating).toBe(true)
    }
  )
})

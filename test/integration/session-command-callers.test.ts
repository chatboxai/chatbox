import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCompactionCommitPatch } from '../../packages/chatbox-core/src/application/context/compaction-commit'
import {
  ChatMessageService,
  ChatSendPreflightInvalidatedError,
} from '../../packages/chatbox-core/src/application/chat/ChatMessageService'
import {
  RowBackedSessionRepository,
  SessionService,
  SessionWriteCoordinator,
  SessionEventBus,
} from '../../packages/chatbox-core/src/application/session'
import { SessionWriteConflictError } from '../../packages/chatbox-core/src/ports'
import type { SessionRowStorePort } from '../../packages/chatbox-core/src/ports/session-row-store'
import { SqlSessionRowStore } from '../../packages/chatbox-core/src/persistence/session-row-sql'
import { openNodeSessionRowDatabase } from '../../packages/chatbox-core/src/persistence/node-sqlite.test-support'
import { InMemorySessionRecordStore, InMemorySessionRepository } from '../../packages/chatbox-core/src/testing'
import type { Session } from '../../packages/chatbox-core/src/types'
import { IndexedDBSessionRowStore } from '../../src/renderer/storage/SessionRowStorage'

const cleanup: Array<() => void> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) dispose()
})
async function setup(driver: 'sqlite' | 'indexeddb') {
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
  const service = new SessionService(repository, new SessionWriteCoordinator(repository), new SessionEventBus(), {
    createId: () => 'unused',
  })
  const original: Session = {
    id: 's',
    name: 'Named',
    type: 'chat',
    settings: { provider: 'test', modelId: 'test', agentMode: { value: 'off', locked: false, lockReason: null } },
    messages: [{ id: 'prompt', role: 'user', contentParts: [{ type: 'text', text: 'Before' }] }],
  }
  await repository.setSession(original)
  const generation = vi.fn(async () => {})
  let id = 0
  const chat = (beforeSend?: () => Promise<void>) =>
    new ChatMessageService({
      sessions: service,
      generation: { orchestrate: generation },
      beforeSend,
      createId: () => `new-${++id}`,
      now: () => 100,
    })
  return { rows, records, repository, service, original, generation, chat }
}

describe.each(['sqlite', 'indexeddb'] as const)('command callers on %s', (driver) => {
  it('appends a turn with one initial signature and no full writes when the atomic source remains current', async () => {
    const h = await setup(driver)
    const fullWrite = vi.spyOn(h.repository, 'setSession')
    const read = vi.spyOn(h.repository, 'getCompleteSessionSource')
    const stringify = vi.spyOn(JSON, 'stringify')
    const persisted = vi.fn()
    const result = await h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    const signatures = stringify.mock.calls.filter(
      ([value]) => value && typeof value === 'object' && 'activeMessages' in value
    )
    expect(signatures).toHaveLength(1)
    expect(fullWrite).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
    expect(persisted).toHaveBeenCalledOnce()
    expect(result.session.id).toBe('s')
    expect((await h.repository.getSession('s'))?.messages.map((message) => message.id)).toEqual([
      'prompt',
      'new-1',
      'new-2',
    ])
  })

  it.each(['summary', 'name'] as const)('allows the unchanged send target after %s preparation', async (change) => {
    const h = await setup(driver)
    const before = async () => {
      if (change === 'name') await h.service.updateSessionHeader('s', { name: 'Renamed' })
      else
        await h.service.updateSessionWithMessages(
          's',
          (current) =>
            buildCompactionCommitPatch(
              current!,
              { id: 'summary', role: 'assistant', isSummary: true, contentParts: [{ type: 'text', text: 'Summary' }] },
              { summaryMessageId: 'summary', boundaryMessageId: 'prompt', createdAt: 2 }
            )!
        )
    }
    await h.chat(before).sendExistingSession('s', { input: { text: 'Next' } })
    const stored = (await h.repository.getSession('s'))!
    expect(stored.messages.slice(-2).map((message) => message.id)).toEqual(['new-1', 'new-2'])
    expect(h.generation).toHaveBeenCalledOnce()
  })

  it.each(['text', 'attachment', 'model', 'thread'] as const)(
    'rejects a changed %s during preparation before appending',
    async (change) => {
      const h = await setup(driver)
      const before = async () => {
        if (change === 'text')
          await h.service.updateMessage('s', 'prompt', { contentParts: [{ type: 'text', text: 'Edited' }] })
        if (change === 'attachment')
          await h.service.updateMessage('s', 'prompt', {
            files: [{ id: 'f', name: 'f.txt', fileType: 'text/plain', storageKey: 'file:f' }],
          })
        if (change === 'model')
          await h.service.updateSessionHeader('s', { settings: { ...h.original.settings, modelId: 'other' } })
        if (change === 'thread')
          await h.service.executeStructureCommand('s', {
            action: 'thread-create',
            archiveId: 'archived',
            now: 2,
            systemMessageId: 'system-next',
            defaultSystemPrompt: '',
          })
      }
      const persisted = vi.fn()
      await expect(
        h.chat(before).sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
      ).rejects.toBeInstanceOf(ChatSendPreflightInvalidatedError)
      expect(persisted).not.toHaveBeenCalled()
      expect(h.generation).not.toHaveBeenCalled()
      expect((await h.repository.getSession('s'))?.messages.some((message) => message.id.startsWith('new-'))).toBe(
        false
      )
    }
  )

  it('validates a concurrent edit that wins immediately before the conditional commit', async () => {
    const h = await setup(driver)
    const other = new RowBackedSessionRepository({ rows: h.rows, records: h.records })
    const execute = h.repository.executeSessionCommand.bind(h.repository)
    vi.spyOn(h.repository, 'executeSessionCommand').mockImplementationOnce(async (id, command, revision) => {
      await other.executeSessionCommand(id, {
        type: 'update',
        messageId: 'prompt',
        updater: { contentParts: [{ type: 'text', text: 'Concurrent edit' }] },
      })
      return execute(id, command, revision)
    })
    await expect(h.chat().sendExistingSession('s', { input: { text: 'Next' } })).rejects.toBeInstanceOf(
      ChatSendPreflightInvalidatedError
    )
    expect((await h.repository.getSession('s'))?.messages).toHaveLength(1)
    expect(h.generation).not.toHaveBeenCalled()
  })

  it('keeps legacy duplicate-id sessions on the semantic fallback', async () => {
    const h = await setup(driver)
    await h.repository.deleteSession('s')
    await h.records.setRecord({ ...h.original, messages: [h.original.messages[0], { ...h.original.messages[0] }] })
    expect((await h.repository.getCompleteSessionSource('s'))?.revision).toBeUndefined()
    const persisted = vi.fn()
    await h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    expect(persisted).toHaveBeenCalledOnce()
    expect((await h.repository.getSession('s'))?.messages).toHaveLength(4)
  })

  it.skipIf(driver !== 'sqlite')('accepts numerical token results without changing the send target', async () => {
    const h = await setup(driver)
    const source = (await h.repository.getCompleteSessionSource('s'))!.textTokens!.sources.prompt
    const revision = await h.rows.getRevision('s')
    const before = async () => {
      await h.service.acceptSessionTextTokenResults('s', [
        { source, value: { tokenizerType: 'default', sourceDigest: source.textDigest, tokens: 42, calculatedAt: 1 } },
      ])
      expect(await h.rows.getRevision('s')).toBe(revision)
    }
    await h.chat(before).sendExistingSession('s', { input: { text: 'Next' } })
    expect(h.generation).toHaveBeenCalledOnce()
  })

  it('notifies a durable turn once when metadata fails with a conflict-shaped error', async () => {
    const h = await setup(driver)
    const persisted = vi.fn()
    const metadata = vi
      .spyOn(h.repository.meta, 'update')
      .mockRejectedValueOnce(new SessionWriteConflictError('s', 1, 2))
    await expect(
      h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    ).resolves.toMatchObject({ assistantMessage: { id: 'new-2' } })
    expect(persisted).toHaveBeenCalledOnce()
    expect(h.generation).toHaveBeenCalledOnce()
    expect((await h.repository.getSession('s'))?.messages.map((message) => message.id)).toEqual([
      'prompt',
      'new-1',
      'new-2',
    ])
    await vi.waitFor(() => expect(metadata).toHaveBeenCalledTimes(2), { timeout: 2000 })
  })

  it('does not start generation or notify when the content transaction fails', async () => {
    const h = await setup(driver)
    const failure = new Error('content failed')
    vi.spyOn(h.rows, 'applyDiff').mockRejectedValueOnce(failure)
    const persisted = vi.fn()
    await expect(
      h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    ).rejects.toBe(failure)
    expect(persisted).not.toHaveBeenCalled()
    expect(h.generation).not.toHaveBeenCalled()
    expect((await h.repository.getSession('s'))?.messages).toHaveLength(1)
  })

  it('continues a durable legacy turn while repairing metadata failure', async () => {
    const h = await setup(driver)
    await h.repository.deleteSession('s')
    await h.records.setRecord({ ...h.original, messages: [h.original.messages[0], { ...h.original.messages[0] }] })
    const failure = new Error('legacy metadata failed')
    const metadata = vi.spyOn(h.repository.meta, 'update').mockRejectedValueOnce(failure)
    const persisted = vi.fn()
    await expect(
      h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    ).resolves.toMatchObject({ assistantMessage: { id: 'new-2' } })
    expect(persisted).toHaveBeenCalledOnce()
    expect(h.generation).toHaveBeenCalledOnce()
    expect((await h.repository.getSession('s'))?.messages).toHaveLength(4)
    await vi.waitFor(() => expect(metadata).toHaveBeenCalledTimes(2), { timeout: 2000 })
  })

  it('starts the durable reply even if navigation feedback rejects, and reports that error', async () => {
    const h = await setup(driver)
    const failure = new Error('feedback failed')
    const persisted = vi.fn().mockRejectedValue(failure)
    await expect(
      h.chat().sendExistingSession('s', { input: { text: 'Next' }, onMessagesPersisted: persisted })
    ).rejects.toBe(failure)
    expect(persisted).toHaveBeenCalledOnce()
    expect(h.generation).toHaveBeenCalledOnce()
    expect((await h.repository.getSession('s'))?.messages).toHaveLength(3)
  })

  it.each([false, true])(
    'settles rejected generation only while its message is still generating (terminal=%s)',
    async (terminal) => {
      const h = await setup(driver)
      const failure = new Error('generation setup failed')
      h.generation.mockImplementationOnce(async () => {
        if (terminal)
          await h.service.updateMessage('s', 'new-2', {
            generating: false,
            contentParts: [{ type: 'text', text: 'Already complete' }],
          })
        throw failure
      })
      await expect(h.chat().sendExistingSession('s', { input: { text: 'Next' } })).rejects.toBe(failure)
      const reply = (await h.repository.getSession('s'))?.messages.find((message) => message.id === 'new-2')
      expect(reply?.generating).toBe(false)
      if (terminal) {
        expect(reply?.contentParts).toEqual([{ type: 'text', text: 'Already complete' }])
        expect(reply?.error).toBeUndefined()
      } else expect(reply?.error).toBe(failure.message)
    }
  )

  it('edits a message through its row command', async () => {
    const h = await setup(driver)
    const fullWrite = vi.spyOn(h.repository, 'setSession')
    await h.chat().editMessage('s', 'prompt', [{ type: 'text', text: 'Edited' }])
    expect(fullWrite).not.toHaveBeenCalled()
    expect((await h.repository.getSession('s'))?.messages[0].contentParts).toEqual([{ type: 'text', text: 'Edited' }])
  })
})

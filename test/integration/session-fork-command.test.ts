import { ForkService } from '@chatbox/core/application/session'
import { ChatMessageService, saveAndResendMessage } from '@chatbox/core/application/chat'
import type { SessionForkOperation } from '../../packages/chatbox-core/src/ports/session-fork-command'
import type { Message, Session } from '@chatbox/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, type Driver, message, setupRows, source } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.restoreAllMocks()
})
function forkSource(): Session {
  return {
    ...source(),
    messages: [message('system', 'system'), message('user'), message('answer', 'assistant')],
    threads: [
      {
        id: 'archive',
        name: 'Archive',
        createdAt: 4,
        messages: [message('old-system', 'system'), message('old-user'), message('old-answer', 'assistant')],
      },
    ],
  }
}
async function harness(driver: Driver, initial = forkSource()) {
  const h = await setupRows(driver, initial)
  cleanup.push(h.dispose)
  let sequence = 0
  const forks = new ForkService(h.service, { createId: () => `generated-${++sequence}`, now: () => 10 })
  return { ...h, forks }
}
const identity = (prefix: string) => ({
  seedListId: `${prefix}-seed`,
  storedListId: `${prefix}-old`,
  newListId: `${prefix}-new`,
  createdAt: 10,
})

describe.each(drivers)('fork row commands on %s', (driver) => {
  it('creates/switches/edits/deletes branches without rewriting existing payloads', async () => {
    const h = await harness(driver)
    const writes = vi.spyOn(h.rows, 'applyDiff')
    const selected = vi.spyOn(h.rows, 'readMessages')
    const operations: Array<{ operation: SessionForkOperation; ids: string[] }> = [
      {
        operation: {
          action: 'fork-create',
          pivotId: 'user',
          identity: identity('first'),
          append: [message('new-answer', 'assistant')],
        },
        ids: ['system', 'user', 'new-answer'],
      },
      { operation: { action: 'fork-switch', pivotId: 'user', target: 'prev' }, ids: ['system', 'user', 'answer'] },
      {
        operation: {
          action: 'fork-save-resend',
          targetMessageId: 'user',
          replacement: message('edited-user'),
          identity: identity('edit'),
          append: [message('edited-answer', 'assistant')],
        },
        ids: ['system', 'edited-user', 'edited-answer'],
      },
      { operation: { action: 'fork-switch', pivotId: 'system', target: 'prev' }, ids: ['system', 'user', 'answer'] },
      { operation: { action: 'fork-delete', pivotId: 'system' }, ids: ['system', 'edited-user', 'edited-answer'] },
    ]
    const knownIds = new Set(['system', 'user', 'answer', 'old-system', 'old-user', 'old-answer'])
    for (const { operation, ids } of operations) {
      writes.mockClear()
      selected.mockClear()
      await h.service.executeStructureCommand('s', operation)
      expect(
        writes.mock.calls.flatMap(([diff]) => diff.messages.upsert).some((row) => knownIds.has(row.messageId))
      ).toBe(false)
      expect(selected.mock.calls.flatMap(([request]) => request.messageIds).some((id) => id.startsWith('old-'))).toBe(
        false
      )
      expect((await h.activeMessages()).map((row) => row.id)).toEqual(ids)
      for (const id of ids) knownIds.add(id)
    }
    expect(await h.readMessage('user')).toBeUndefined()
    expect(await h.readMessage('new-answer')).toBeUndefined()
    expect(await h.readMessage('old-answer')).toEqual(message('old-answer', 'assistant'))
  })

  it('drops an empty branch and retains summary anchors and checkpoints', async () => {
    const initial = forkSource()
    initial.messages.splice(2, 0, { ...message('summary', 'assistant'), isSummary: true })
    initial.compactionPoints = [{ boundaryMessageId: 'user', summaryMessageId: 'summary', createdAt: 2 }]
    const h = await harness(driver, initial)
    await h.service.executeStructureCommand('s', {
      action: 'fork-create',
      pivotId: 'user',
      identity: identity('empty'),
    })
    const fork = await h.repository.readSessionForkOptionsPage({ sessionId: 's', pivotId: 'user', limit: 20 })
    expect(fork?.branchPointId).toBe('summary')
    expect(fork?.branches.find((branch) => branch.selected)?.firstMessageId).toBeNull()
    await h.service.executeStructureCommand('s', { action: 'fork-switch', pivotId: 'user', target: 'prev' })
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(['system', 'user', 'summary', 'answer'])
    expect(await h.repository.readSessionForkOptionsPage({ sessionId: 's', pivotId: 'user', limit: 20 })).toBeNull()
    const current = (await h.service.getSessionHeader('s'))!
    const state = await h.rows.readThreadState({ sessionId: 's', expectedRevision: current.revision })
    expect(state?.status).toBe('ready')
    expect(state?.status === 'ready' && state.thread.compactionPoints).toEqual(initial.compactionPoints)
  })

  it('rejects stale revisions and cross-thread duplicate ids without changing rows', async () => {
    const h = await harness(driver)
    const before = (await h.service.getSessionHeader('s'))!
    await expect(
      h.repository.executeSessionCommand('s', {
        type: 'structure',
        operation: {
          action: 'fork-create',
          pivotId: 'user',
          identity: identity('dup'),
          append: [message('old-user')],
        },
      })
    ).rejects.toThrow('identity already exists')
    expect(await h.rows.getRevision('s')).toBe(before.revision)
    await expect(
      h.repository.executeSessionCommand(
        's',
        {
          type: 'structure',
          operation: {
            action: 'fork-create',
            pivotId: 'user',
            identity: identity('stale'),
          },
        },
        before.revision + 1
      )
    ).rejects.toMatchObject({ name: 'SessionWriteConflictError' })
    expect(await h.rows.getRevision('s')).toBe(before.revision)
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(['system', 'user', 'answer'])
  })

  it('keeps inactive runtime generation locked and reports committed deletion scopes', async () => {
    const initial = forkSource()
    initial.messages[2].generating = true
    initial.settings!.agentMode = { value: 'on', locked: false, lockReason: null }
    const h = await harness(driver, initial)
    await h.service.executeStructureCommand('s', {
      action: 'fork-create',
      pivotId: 'user',
      identity: identity('branch'),
      append: [message('second-answer', 'assistant')],
    })
    const guarded = new ForkService(h.service, { createId: () => 'unused', now: () => 10 }, () => ({
      activeGenerationMessageIds: new Set(['answer']),
    }))
    await expect(guarded.switch('s', 'user', 'prev')).rejects.toThrow('generating')
    const committed = vi.fn()
    await h.service.executeStructureCommand(
      's',
      { action: 'fork-delete', pivotId: 'user', activeGenerationMessageIds: ['second-answer'] },
      committed
    )
    expect(committed).toHaveBeenCalledWith(
      expect.objectContaining({
        applied: true,
        cancelMessageIds: ['second-answer'],
        affectedScopes: [expect.objectContaining({ type: 'subtree', rootMessageId: 'second-answer' })],
      })
    )
    expect(await h.readMessage('second-answer')).toBeUndefined()
    expect((await h.activeMessages()).at(-1)?.id).toBe('answer')
  })

  it('keeps attachment owners and publishes deletion when metadata projection fails', async () => {
    const initial = forkSource()
    const file = { id: 'file', name: 'shared.txt', fileType: 'text/plain', sessionAttachmentId: 12 }
    initial.messages[1].files = [file]
    const h = await harness(driver, initial)
    await h.service.executeStructureCommand('s', {
      action: 'fork-save-resend',
      targetMessageId: 'user',
      replacement: { ...message('edited'), files: [file] },
      identity: identity('files'),
    })
    await h.service.executeStructureCommand('s', { action: 'fork-switch', pivotId: 'system', target: 'prev' })
    vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('metadata unavailable'))
    const committed = vi.fn()
    await expect(
      h.service.executeStructureCommand('s', { action: 'fork-delete', pivotId: 'system' }, committed)
    ).resolves.toMatchObject({ applied: true })
    expect(committed).toHaveBeenCalledOnce()
    expect(await h.readMessage('user')).toBeUndefined()
    expect((await h.readMessage('edited'))?.files).toEqual([file])
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(['system', 'edited'])
  })

  it('persists save-and-resend/retry placeholders before starting generation', async () => {
    const initial = forkSource()
    const h = await harness(driver, initial)
    const writes = vi.spyOn(h.rows, 'writeRows')
    const events = vi.spyOn(h.events, 'publish')
    let sequence = 0
    const generation = { orchestrate: vi.fn().mockResolvedValue(undefined) }
    const onPersisted = vi.fn()
    await saveAndResendMessage(
      { sessions: h.service, generation, createId: () => `send-${++sequence}`, now: () => 10 },
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
    expect((await h.readMessage('send-1'))?.generating).toBe(true)
    expect(events.mock.calls.some(([event]) => event.type === 'session-command-committed')).toBe(true)
    await h.service.updateMessage('s', 'send-1', { generating: false })
    const chat = new ChatMessageService({
      sessions: h.service,
      generation,
      createId: () => `retry-${++sequence}`,
      now: () => 11,
    })
    await chat.retryMessage('s', 'send-1')
    expect(writes).not.toHaveBeenCalled()
    expect((await h.activeMessages()).at(-1)?.generating).toBe(true)
    expect(generation.orchestrate).toHaveBeenCalledTimes(2)
  })

  it('preserves migrated legacy payloads while publishing only fork edges', async () => {
    const initial = forkSource()
    initial.messages[0] = {
      ...message('system', 'system'),
      contentParts: [],
      content: 'Legacy system prompt',
    } as Message & { content: string }
    const h = await harness(driver, initial)
    const before = await h.readMessage('system')
    const diff = vi.spyOn(h.rows, 'applyDiff')
    await h.forks.create('s', 'user')
    expect(before?.contentParts).toEqual([{ type: 'text', text: 'Legacy system prompt' }])
    expect(await h.readMessage('system')).toEqual(before)
    expect(diff.mock.calls.flatMap(([write]) => write.messages.upsert)).toEqual([])
  })

  it('removes only the selected subtree including nested branch rows', async () => {
    const initial = forkSource()
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
    await h.service.executeStructureCommand('s', { action: 'fork-delete', pivotId: 'user' })
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(['system', 'user', 'survivor'])
    expect(
      (
        await h.repository.readSessionMessages({
          sessionId: 's',
          messageIds: ['answer', 'inner-answer', 'inner-other', 'inner-pivot'],
        })
      )?.messages
    ).toEqual([])
    expect(await h.repository.readSessionForkOptionsPage({ sessionId: 's', pivotId: 'user', limit: 20 })).toBeNull()
    expect(await h.readMessage('old-answer')).toEqual(message('old-answer', 'assistant'))
  })

  it('fails safely when legacy input cannot publish its row migration', async () => {
    const initial = forkSource()
    const h = await harness(driver, initial)
    await h.rows.deleteRows('s')
    await h.records.setRecord(initial)
    vi.spyOn(h.rows, 'writeRows').mockRejectedValue(new Error('Row store unavailable'))
    await expect(h.forks.create('s', 'user')).rejects.toThrow()
    expect(await h.rows.readCommit('s')).toBeNull()
    expect(await h.records.getRecord('s')).toEqual(initial)
  })

  it.each(['create', 'retry', 'save-resend'] as const)(
    'allocates branches at an archived pivot for %s',
    async (operation) => {
      const initial = forkSource()
      const h = await harness(driver, initial)
      if (operation === 'create') await h.forks.create('s', 'old-user')
      else if (operation === 'save-resend') await h.forks.saveAndResend('s', 'old-user', message('edited-old-user'))
      else {
        let sequence = 0
        const generation = { orchestrate: vi.fn().mockResolvedValue(undefined) }
        const chat = new ChatMessageService({
          sessions: h.service,
          generation,
          createId: () => `retry-${++sequence}`,
          now: () => 10,
        })
        await chat.retryMessage('s', 'old-answer')
        expect(generation.orchestrate).toHaveBeenCalledOnce()
      }
      expect(await h.activeMessages()).toEqual(initial.messages)
      const pivotId = operation === 'save-resend' ? 'old-system' : 'old-user'
      const options = await h.repository.readSessionForkOptionsPage({ sessionId: 's', pivotId, limit: 20 })
      expect(options?.threadId).toBe('archive')
      expect(options?.branches).toHaveLength(2)
      expect(options?.branches.find((branch) => !branch.selected)?.firstMessageId).toBe(
        operation === 'save-resend' ? 'old-user' : 'old-answer'
      )
      if (operation === 'retry') {
        const page = await h.repository.readSessionTranscriptWindow({
          sessionId: 's',
          origin: { threadId: 'archive', edge: 'head' },
          limit: 20,
        })
        expect(page?.messages.filter((row) => row.threadId === 'archive').at(-1)?.message.generating).toBe(true)
      }
    }
  )
})

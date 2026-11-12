import { MessageAnchorNotFoundError } from '@chatbox/core/application/session'
import { ChatMessageService } from '@chatbox/core/application/chat'
import { GenerationRuntimeStore } from '@chatbox/core/generation'
import type { SessionMessageStructureOperation } from '../../packages/chatbox-core/src/ports/session-structure-command'
import type { Message, Session } from '@chatbox/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, type Driver, message, setupRows } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.restoreAllMocks()
})
async function harness(driver: Driver, initial = fixture()) {
  const h = await setupRows(driver, initial)
  cleanup.push(h.dispose)
  return h
}
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

const expectedActive: Record<string, string[]> = {
  'ordinary deletion': ['system', 'pivot', 'last'],
  'root deletion': ['pivot', 'answer', 'last'],
  'pivot with parent': ['system', 'answer', 'last'],
  'root fork pivot': ['replacement', 'pivot', 'answer', 'last'],
  'nested active pivot': ['system', 'answer', 'last'],
  'nested inactive pivot': ['system', 'pivot', 'answer', 'last'],
  'empty active branch': ['system', 'pivot', 'saved'],
  'empty inactive branch': ['system', 'pivot', 'answer', 'last'],
  'summary anchored pivot': ['system', 'replacement', 'summary', 'answer', 'last'],
  'summary deletion': ['system', 'pivot', 'answer', 'last'],
  'middle insertion': ['system', 'pivot', 'inserted', 'answer', 'last'],
  'archived insertion': ['system', 'pivot', 'answer', 'last'],
  'selected branch insertion': ['system', 'pivot', 'inserted', 'answer', 'last'],
  'summary adjacent insertion': ['system', 'pivot', 'summary', 'inserted', 'answer', 'last'],
  'later selected branch insertion': ['system', 'pivot', 'inserted', 'answer', 'last'],
  'empty selected branch insertion': ['system', 'pivot', 'inserted'],
  'optional missing anchor': ['system', 'pivot', 'answer', 'last', 'inserted'],
  'clear active': ['system'],
  'clear all': ['system'],
  'clear active no system': [],
  'clear all no system': [],
}
function inputMessages(session: Session): Message[] {
  return [
    ...session.messages,
    ...(session.threads ?? []).flatMap((thread) => thread.messages),
    ...Object.values(session.messageForksHash ?? {}).flatMap((fork) => fork.lists.flatMap((list) => list.messages)),
  ]
}

describe.each(drivers)('message row commands on %s', (driver) => {
  it.each(cases)('preserves row topology for $name', async ({ name, initial, operation }) => {
    const input = initial()
    const h = await harness(driver, input)
    const writes = vi.spyOn(h.rows, 'writeRows')
    const diff = vi.spyOn(h.rows, 'applyDiff')
    const result = await h.repository.executeSessionCommand('s', { type: 'structure', operation })
    expect(result.kind).toBe('rows')
    expect(writes).not.toHaveBeenCalled()
    expect(diff.mock.calls[0]?.[0].messages.upsert.length ?? 0).toBeLessThanOrEqual(1)
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(expectedActive[name])
    if (operation.action === 'message-remove' || operation.action === 'message-insert-after') {
      const retained = inputMessages(input).filter(
        (row) => operation.action !== 'message-remove' || row.id !== operation.messageId
      )
      const page = await h.repository.readSessionMessages({ sessionId: 's', messageIds: retained.map((row) => row.id) })
      expect(page?.messages).toEqual(retained)
      if (operation.action === 'message-remove') expect(await h.readMessage(operation.messageId)).toBeUndefined()
    }
    if (operation.action === 'message-insert-after' && operation.previousId === 'old-user') {
      const page = await h.repository.readSessionTranscriptWindow({
        sessionId: 's',
        origin: { threadId: 'archive', edge: 'head' },
        limit: 20,
      })
      expect(page?.messages.filter((row) => row.threadId === 'archive').map((row) => row.messageId)).toEqual([
        'old-system',
        'old-user',
        'inserted',
        'old-answer',
      ])
    }
    if (operation.action === 'session-clear') {
      const archive = await h.repository.readSessionThread({ sessionId: 's', threadId: 'archive' })
      if (operation.scope === 'active') {
        expect(archive?.thread.rootMessageId).toBe('old-system')
        expect(await h.readMessage('old-answer')).toEqual(message('old-answer', 'assistant'))
        if (input.messageForksHash) expect(await h.readMessage('old-saved')).toEqual(message('old-saved'))
      } else {
        expect(archive).toBeNull()
        expect(await h.readMessage('old-answer')).toBeUndefined()
      }
    }
  })

  it('reports content completion for both insertion forms and survives metadata projection failure', async () => {
    const h = await harness(driver)
    const committed = vi.fn()
    const fullWrite = vi.spyOn(h.rows, 'writeRows')
    await h.service.insertMessage('s', message('tail-insert'), undefined, { onPersisted: committed })
    await h.service.insertMessage('s', message('middle-insert'), 'pivot', { onPersisted: committed })
    expect(committed).toHaveBeenCalledTimes(2)
    expect(committed.mock.calls.every(([header]) => header.id === 's' && !('messages' in header))).toBe(true)
    expect(fullWrite).not.toHaveBeenCalled()
    vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('metadata failed'))
    await expect(
      h.service.insertMessage('s', message('durable-insert'), 'pivot', { onPersisted: committed })
    ).resolves.toBeUndefined()
    expect(committed).toHaveBeenCalledTimes(3)
    expect(await h.readMessage('durable-insert')).toEqual(message('durable-insert'))
  })

  it('requires a selected anchor, is idempotent, and rejects cross-thread duplicate identities', async () => {
    const h = await harness(driver, branch(fixture(), 'pivot', [message('saved')]))
    const execute = (previousId: string, id = 'inserted') =>
      h.service.executeStructureCommand('s', {
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
      h.service.executeStructureCommand('s', {
        action: 'message-insert-after',
        previousId: 'missing',
        message: message('old-user'),
      })
    ).rejects.toThrow('identity')
  })

  it('rejects stale structure CAS while preserving current rows', async () => {
    const h = await harness(driver)
    const revision = (await h.rows.getRevision('s'))!
    await h.service.updateSessionHeader('s', { name: 'new' })
    await expect(
      h.repository.executeSessionCommand('s', { type: 'structure', operation: remove('answer') }, revision)
    ).rejects.toMatchObject({ name: 'SessionWriteConflictError' })
    expect(await h.readMessage('answer')).toEqual(message('answer', 'assistant'))
  })

  it('reports durable deletion after a projection failure and keeps shared attachment owners', async () => {
    const initial = fixture()
    const files = [{ id: 'file', name: 'shared', fileType: 'text/plain', storageKey: 'file', sessionAttachmentId: 12 }]
    initial.messages[1].files = files
    initial.messages[2].files = files
    const h = await harness(driver, initial)
    vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('metadata failed'))
    const committed = vi.fn()
    await expect(h.service.executeStructureCommand('s', remove('pivot'), committed)).resolves.toMatchObject({
      applied: true,
    })
    expect(committed).toHaveBeenCalledOnce()
    expect(await h.readMessage('pivot')).toBeUndefined()
    expect((await h.readMessage('answer'))?.files).toEqual(files)
  })

  it('routes reply/delete/clear through row commits and discards removed paused runtimes', async () => {
    const h = await harness(driver)
    const runtime = new GenerationRuntimeStore()
    const generation = { orchestrate: vi.fn().mockResolvedValue(undefined) }
    const chat = new ChatMessageService({
      sessions: h.service,
      generation,
      runtime,
      createId: () => 'reply',
      now: () => 10,
    })
    const writes = vi.spyOn(h.rows, 'writeRows')
    await chat.replyBelow('s', 'pivot')
    expect(generation.orchestrate).toHaveBeenCalledOnce()
    await h.service.updateMessage('s', 'reply', { generating: false })
    const live = runtime.start('s', 'reply')
    runtime.setPhase('s', 'reply', 'paused', live)
    await chat.deleteMessage('s', 'reply')
    expect(live.abortController.signal.aborted).toBe(true)
    await chat.clearMessages('s')
    expect(writes).not.toHaveBeenCalled()
    expect((await h.repository.readSessionThread({ sessionId: 's', threadId: 'archive' }))?.thread.rootMessageId).toBe(
      'old-system'
    )
  })

  it('preserves a mounted reply overlay during deletion without reviving the removed row', async () => {
    const initial = fixture()
    initial.messages[2].generating = true
    const h = await harness(driver, initial)
    const controller = await h.openWindow()
    await h.application.sessionQueryBridge.updateMessageCache('s', 'answer', {
      contentParts: [{ type: 'text', text: 'live ABC' }],
    })
    await h.service.executeStructureCommand('s', remove('last'))
    await vi.waitFor(() => {
      const state = controller.getSnapshot()
      expect(state.rows.some((row) => row.messageId === 'last')).toBe(false)
      expect(state.rows.find((row) => row.messageId === 'answer')?.message.contentParts).toEqual([
        { type: 'text', text: 'live ABC' },
      ])
    })
  })

  it('retains the first system message using only bounded point reads during clear', async () => {
    const initial = fixture()
    initial.messages.push(...Array.from({ length: 200 }, (_, index) => message(`tail-${index}`)))
    const h = await harness(driver, initial)
    const selected = vi.spyOn(h.rows, 'readMessages')
    await h.service.executeStructureCommand('s', { action: 'session-clear', scope: 'all' })
    expect(selected.mock.calls.every(([request]) => request.messageIds.length <= 32)).toBe(true)
    expect(selected.mock.calls.flatMap(([request]) => request.messageIds)).toEqual(['system'])
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(['system'])
  })
})

import { GenerationRuntimeStore } from '@chatbox/core/generation'
import { ThreadService } from '@chatbox/core/application/session'
import type { Session } from '@chatbox/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { drivers, type Driver, message, setupRows, source } from './session-rows-harness'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.restoreAllMocks()
})
function threadSource(): Session {
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
async function harness(driver: Driver, initial = threadSource()) {
  const h = await setupRows(driver, initial)
  cleanup.push(h.dispose)
  let sequence = 0
  const abort = vi.fn()
  const threads = new ThreadService({
    sessions: h.service,
    createId: () => `generated-${++sequence}`,
    now: () => 10,
    getDefaultSystemPrompt: () => 'Default',
    cancelMessageIds: abort,
    copyThread: (request) => h.service.copySessionThread(request),
  })
  return { ...h, threads, abort }
}

describe.each(drivers)('thread row commands on %s', (driver) => {
  it.each(['switch', 'undo'] as const)(
    'cancels generating/live work without poisoning paused/completed messages after %s',
    async (operation) => {
      const initial = threadSource()
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
        { ...message('transient', 'assistant'), generating: true },
        message('live', 'assistant'),
        message('completed', 'assistant')
      )
      const h = await harness(driver, initial)
      const originalThreadId = (await h.service.getSessionHeader('s'))!.activeThreadId
      const runtime = new GenerationRuntimeStore()
      const live = runtime.start('s', 'live')
      runtime.start('s', 'completed')
      const apply = h.rows.applyDiff.bind(h.rows)
      vi.spyOn(h.rows, 'applyDiff').mockImplementationOnce(async (...args) => {
        const committed = await apply(...args)
        runtime.finishActive('s', 'completed')
        runtime.start('s', 'transient')
        runtime.finishActive('s', 'transient')
        return committed
      })
      let sequence = 0
      const threads = new ThreadService({
        sessions: h.service,
        createId: () => `saved-${++sequence}`,
        now: () => 10,
        getDefaultSystemPrompt: () => '',
        getLiveMessageIds: (id) => new Set(runtime.list(id).map((entry) => entry.messageId)),
        subscribeGenerationRuntime: (listener) => runtime.subscribe(listener),
        cancelMessageIds: (id, ids) => {
          for (const messageId of ids) runtime.requestAbort(id, messageId, 'thread-changed')
        },
        copyThread: (request) => h.service.copySessionThread(request),
      })
      const undo = operation === 'undo' ? await threads.createWithRollback('s') : null
      if (operation === 'switch') await threads.switch('s', 'archive')
      expect(live.abortController.signal.aborted).toBe(true)
      expect.soft(runtime.start('s', 'pre-entry').abortController.signal.aborted).toBe(true)
      if (undo) await threads.rollbackCreated(undo)
      else await threads.switch('s', originalThreadId)
      expect(runtime.start('s', 'paused').abortController.signal.aborted).toBe(false)
      expect(runtime.start('s', 'completed').abortController.signal.aborted).toBe(false)
      expect(runtime.start('s', 'transient').abortController.signal.aborted).toBe(false)
      expect(runtime.start('s', 'system').abortController.signal.aborted).toBe(false)
    }
  )

  it('pages persisted generating references across branches only in the changed thread', async () => {
    const initial = threadSource()
    const pendingIds = Array.from({ length: 205 }, (_, index) => `pending-${index}`)
    initial.messages.push(...pendingIds.map((id) => ({ ...message(id, 'assistant'), generating: true })))
    initial.messageForksHash = {
      user: {
        position: 0,
        createdAt: 2,
        lists: [
          { id: 'current', messages: [] },
          { id: 'inactive', messages: [{ ...message('inactive-pending', 'assistant'), generating: true }] },
        ],
      },
    }
    initial.threads![0].messages[2].generating = true
    const h = await harness(driver, initial)
    const activeThreadId = (await h.service.getSessionHeader('s'))!.activeThreadId
    const relations = vi.spyOn(h.rows, 'readMessageRelationsPage')
    const bodies = vi.spyOn(h.rows, 'readMessages')
    await h.threads.switch('s', 'archive')
    expect(new Set(h.abort.mock.calls[0][1])).toEqual(new Set([...pendingIds, 'inactive-pending']))
    const statusPages = relations.mock.calls
      .map(([request]) => request)
      .filter((request) => request.selector.kind === 'status')
    expect(statusPages).toHaveLength(2)
    expect(statusPages.every((request) => request.threadId === activeThreadId && request.limit === 200)).toBe(true)
    expect(bodies).not.toHaveBeenCalled()
  })

  it('renames threads with metadata reads and publishes row commits', async () => {
    const h = await harness(driver)
    const activeId = (await h.service.getSessionHeader('s'))!.activeThreadId
    const payloads = vi.spyOn(h.rows, 'readMessages')
    const publish = vi.spyOn(h.events, 'publish')
    await h.threads.edit('s', activeId, { name: 'Active title' })
    await h.threads.edit('s', 'archive', { name: 'Archived title' })
    expect(payloads).not.toHaveBeenCalled()
    expect(publish.mock.calls.filter(([event]) => event.type === 'session-command-committed')).toHaveLength(2)
    expect((await h.repository.readSessionThread({ sessionId: 's', threadId: activeId }))?.thread.name).toBe(
      'Active title'
    )
    expect((await h.repository.readSessionThread({ sessionId: 's', threadId: 'archive' }))?.thread.name).toBe(
      'Archived title'
    )
  })

  it('keeps stable thread identities and fork rows through switch/create/delete/compress', async () => {
    const initial = threadSource()
    initial.threads!.push({
      id: 'unrelated',
      name: 'Unrelated',
      createdAt: 5,
      messages: Array.from({ length: 100 }, (_, index) => message(`untouched-${index}`)),
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
    const originalThreadId = (await h.service.getSessionHeader('s'))!.activeThreadId
    const payloads = vi.spyOn(h.rows, 'readMessages')
    await h.threads.switch('s', 'archive')
    expect((await h.activeMessages()).map((row) => row.id)).toEqual(['old-system', 'old-user', 'old-answer'])
    const original = await h.repository.readSessionThread({ sessionId: 's', threadId: originalThreadId })
    expect(original?.thread.rootMessageId).toBe('system')
    const created = await h.threads.createWithRollback('s')
    expect(created).not.toBeNull()
    expect((await h.activeMessages())[0].contentParts).toEqual([{ type: 'text', text: 'old-system' }])
    await h.threads.removeCurrent('s')
    expect((await h.service.getSessionHeader('s'))?.activeThreadId).toBe('archive')
    await h.threads.remove('s', originalThreadId)
    expect(await h.readMessage('other-answer')).toBeUndefined()
    await h.threads.compressAndCreate('s', 'Summary')
    const active = await h.activeMessages()
    expect(active.map((row) => row.role)).toEqual(['system', 'user'])
    expect(active[1].contentParts).toEqual([{ type: 'text', text: 'Previous conversation summary:\n\nSummary' }])
    expect(
      payloads.mock.calls.flatMap(([request]) => request.messageIds).some((id) => id.startsWith('untouched-'))
    ).toBe(false)
    expect(
      (await h.repository.readSessionThreadSummariesPage({ sessionId: 's', limit: 20 }))?.threads.map(
        (row) => row.threadId
      )
    ).toEqual(expect.arrayContaining(['archive', 'unrelated']))
  })

  it('copies normalized system text after the external legacy input is migrated', async () => {
    const initial = threadSource()
    initial.messages[0] = {
      ...message('system', 'system'),
      contentParts: [],
      content: 'Legacy system prompt',
    } as MessageWithLegacyContent
    const h = await harness(driver, initial)
    await h.threads.createWithRollback('s')
    expect((await h.activeMessages())[0].contentParts).toEqual([{ type: 'text', text: 'Legacy system prompt' }])
  })

  it('uses identity-owned undo receipts and rejects repeated or nonempty rollback', async () => {
    const h = await harness(driver)
    const original = await h.activeMessages()
    const receipt = (await h.threads.createWithRollback('s'))!
    expect(await h.threads.rollbackCreated(receipt)).toBe(true)
    expect(await h.threads.rollbackCreated(receipt)).toBe(false)
    expect(await h.activeMessages()).toEqual(original)
    const next = (await h.threads.createWithRollback('s'))!
    await h.service.insertMessages('s', [message('sent')])
    expect(await h.threads.rollbackCreated(next)).toBe(false)
    expect((await h.activeMessages()).at(-1)?.id).toBe('sent')
  })

  it('runs cancellation after a durable commit even if list projection fails', async () => {
    const h = await harness(driver)
    const threads = new ThreadService({
      sessions: h.service,
      createId: () => 'unused',
      now: () => 10,
      getDefaultSystemPrompt: () => '',
      getLiveMessageIds: () => new Set(['answer']),
      cancelMessageIds: h.abort,
      copyThread: (request) => h.service.copySessionThread(request),
    })
    vi.spyOn(h.meta, 'update').mockRejectedValueOnce(new Error('meta failed'))
    await expect(threads.switch('s', 'archive')).resolves.toBe(true)
    expect(h.abort).toHaveBeenCalledWith('s', ['answer'])
    expect((await h.activeMessages())[0].id).toBe('old-system')
  })

  it('keeps payload identities and publishes thread transfers atomically', async () => {
    const h = await harness(driver)
    const before = (await h.service.getSessionHeader('s'))!
    const ids = ['system', 'user', 'answer', 'old-system', 'old-user', 'old-answer']
    const bodies = (await h.repository.readSessionMessages({ sessionId: 's', messageIds: ids }))!.messages
    const apply = vi.spyOn(h.rows, 'applyDiff').mockRejectedValueOnce(new Error('disk failed'))
    await expect(h.threads.switch('s', 'archive')).rejects.toThrow('disk failed')
    expect(h.abort).not.toHaveBeenCalled()
    expect(await h.service.getSessionHeader('s')).toEqual(before)
    apply.mockRestore()
    await h.threads.switch('s', 'archive')
    expect((await h.repository.readSessionMessages({ sessionId: 's', messageIds: ids }))?.messages).toEqual(bodies)
  })

  it('rejects stale structural CAS and retains the archived rows', async () => {
    const h = await harness(driver)
    const before = (await h.service.getSessionHeader('s'))!
    await h.service.updateSessionHeader('s', { name: 'Concurrent' })
    await expect(
      h.repository.executeSessionCommand(
        's',
        {
          type: 'structure',
          operation: {
            action: 'thread-delete',
            threadId: 'archive',
          },
        },
        before.revision
      )
    ).rejects.toMatchObject({ name: 'SessionWriteConflictError' })
    expect((await h.repository.readSessionThread({ sessionId: 's', threadId: 'archive' }))?.thread.rootMessageId).toBe(
      'old-system'
    )
    expect(await h.readMessage('old-answer')).toEqual(message('old-answer', 'assistant'))
  })
})

type MessageWithLegacyContent = Session['messages'][number] & { content: string }

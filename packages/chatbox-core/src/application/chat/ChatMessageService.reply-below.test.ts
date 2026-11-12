import { describe, expect, it, vi } from 'vitest'
import { rowChatFixture } from './testing/row-chat-fixture'
import { GenerationRuntimeStore } from '../../generation/runtime-store'
import type { Message, Session } from '../../types'
import { ChatMessageService } from './ChatMessageService'

const message = (id: string, role: Message['role']): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
})

function harness() {
  let session: Session = {
    id: 'concurrent-chat',
    name: 'Concurrent chat',
    type: 'chat',
    messages: [message('prompt', 'user'), message('original', 'assistant'), message('later', 'user')],
  }
  const runtime = new GenerationRuntimeStore()
  let nextId = 0
  let compacting = false
  const orchestrate = vi.fn(async () => {})
  const fixture = rowChatFixture(() => 'unused', session)
  const executeStructureCommand = fixture.port.executeStructureCommand
  const service = new ChatMessageService({
    sessions: fixture.port,
    generation: { orchestrate },
    runtime,
    isCompactionRunning: () => compacting,
    createId: () => `candidate-${++nextId}`,
    now: () => 100,
  })
  return {
    service,
    readContext: fixture.repository.getSessionContextSource.bind(fixture.repository),
    runtime,
    orchestrate,
    executeStructureCommand,
    get: () => fixture.sessions.get(session.id)!,
    set: (value: Session) => {
      fixture.sessions.set(value.id, value)
    },
    compact: () => {
      compacting = true
    },
  }
}

describe('ChatMessageService.replyBelow', () => {
  it.each(['active', 'history'] as const)('keeps anchored summaries before a new %s candidate', async (location) => {
    for (const role of ['user', 'system'] as const) {
      const h = harness()
      const summary = { ...message('summary', 'assistant'), isSummary: true }
      const messages = [message('boundary', role), summary, message('boundary-later', 'user')]
      const point = { boundaryMessageId: 'boundary', summaryMessageId: 'summary', createdAt: 1 }
      h.set(
        location === 'active'
          ? { ...h.get(), messages, compactionPoints: [point] }
          : {
              ...h.get(),
              threads: [{ id: 'history', name: 'History', createdAt: 1, messages, compactionPoints: [point] }],
            }
      )
      await h.service.replyBelow('concurrent-chat', 'boundary')
      const stored = location === 'active' ? h.get().messages : h.get().threads?.[0].messages
      expect(stored?.map(({ id }) => id)).toEqual(['boundary', 'summary', 'candidate-1', 'boundary-later'])
      expect(
        (await h.readContext({ sessionId: 'concurrent-chat', targetMessageId: 'candidate-1' }))
          ?.effectiveCompactionPoint
      ).toEqual(point)
    }
  })

  it('starts independent flat candidates immediately and preserves later messages', async () => {
    const h = harness()
    let complete!: () => void
    h.orchestrate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const first = h.service.replyBelow('concurrent-chat', 'prompt')
    await vi.waitFor(() => expect(h.orchestrate).toHaveBeenCalledTimes(1))
    const completeFirst = complete
    const second = h.service.replyBelow('concurrent-chat', 'prompt')
    await vi.waitFor(() => expect(h.orchestrate).toHaveBeenCalledTimes(2))
    expect(h.get().messages.map(({ id }) => id)).toEqual(['prompt', 'candidate-2', 'candidate-1', 'original', 'later'])
    expect(h.get().messageForksHash).toBeUndefined()
    completeFirst()
    complete()
    await Promise.all([first, second])
  })

  it('inserts into the selected historical conversation without changing the active path', async () => {
    const h = harness()
    h.set({
      ...h.get(),
      threads: [
        {
          id: 'history',
          name: 'History',
          createdAt: 1,
          messages: [message('old-prompt', 'user'), message('old-answer', 'assistant')],
        },
      ],
    })
    await h.service.replyBelow('concurrent-chat', 'old-prompt')
    expect(h.get().messages.map(({ id }) => id)).toEqual(['prompt', 'original', 'later'])
    expect(h.get().threads?.[0].messages.map(({ id }) => id)).toEqual(['old-prompt', 'candidate-1', 'old-answer'])
  })

  it('rejects work-mode, compaction and invalid targets at the command boundary', async () => {
    const work = harness()
    work.set({ ...work.get(), settings: { agentMode: { value: 'on', locked: true, lockReason: 'message_sent' } } })
    await expect(work.service.replyBelow('concurrent-chat', 'prompt')).rejects.toThrow('Work Mode')
    const compacting = harness()
    compacting.compact()
    await expect(compacting.service.replyBelow('concurrent-chat', 'prompt')).rejects.toMatchObject({
      reason: 'compaction',
    })
    const invalid = harness()
    await expect(invalid.service.replyBelow('concurrent-chat', 'original')).rejects.toThrow('cannot receive')
    await expect(invalid.service.replyBelow('concurrent-chat', 'missing')).rejects.toThrow()
    expect(work.orchestrate).not.toHaveBeenCalled()
    expect(compacting.orchestrate).not.toHaveBeenCalled()
    expect(invalid.get().messages).toHaveLength(3)
  })

  it('rechecks compaction at the command boundary', async () => {
    const h = harness()
    const write = h.executeStructureCommand.getMockImplementation()!
    h.executeStructureCommand.mockImplementationOnce(async (id, operation, onCommitted) => {
      h.compact()
      if (operation.action !== 'message-insert-after') throw new Error('Expected message insertion')
      return write(
        id,
        { ...operation, guard: { ...operation.guard, action: 'reply-below', compactionRunning: true } },
        onCommitted
      )
    })
    await expect(h.service.replyBelow('concurrent-chat', 'prompt')).rejects.toMatchObject({ reason: 'compaction' })
    expect(h.get().messages).toHaveLength(3)
    expect(h.orchestrate).not.toHaveBeenCalled()
    expect(h.runtime.waitForGenerationPreparationLeases('concurrent-chat')).toBeUndefined()
  })

  it('releases candidate preparation admission after a rejected persistence write', async () => {
    const h = harness()
    h.executeStructureCommand.mockRejectedValueOnce(new Error('Disk unavailable'))
    await expect(h.service.replyBelow('concurrent-chat', 'prompt')).rejects.toThrow('Disk unavailable')
    expect(h.get().messages).toHaveLength(3)
    expect(h.orchestrate).not.toHaveBeenCalled()
    expect(h.runtime.waitForGenerationPreparationLeases('concurrent-chat')).toBeUndefined()
  })

  it('settles an inserted placeholder when generation fails before registering its runtime', async () => {
    const h = harness()
    h.orchestrate.mockRejectedValueOnce(new Error('Generation unavailable'))
    await expect(h.service.replyBelow('concurrent-chat', 'prompt')).rejects.toThrow('Generation unavailable')
    expect(h.get().messages[1]).toMatchObject({ generating: false, error: 'Generation unavailable' })
    expect(h.runtime.waitForGenerationPreparationLeases('concurrent-chat')).toBeUndefined()
  })

  it('rejects destructive retry while another flat candidate streams in a saved branch', async () => {
    const h = harness()
    h.set({
      ...h.get(),
      messageForksHash: {
        prompt: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            { id: 'saved', messages: [{ ...message('live', 'assistant'), generating: true }] },
          ],
        },
      },
    })
    h.runtime.start('concurrent-chat', 'live')
    await expect(h.service.retryMessage('concurrent-chat', 'original')).rejects.toMatchObject({ reason: 'generating' })
    expect(h.orchestrate).not.toHaveBeenCalled()
  })

  it('does not insert a candidate after Stop-all closes preparation admission', async () => {
    const h = harness()
    h.runtime.beginSessionStop('concurrent-chat')
    await expect(h.service.replyBelow('concurrent-chat', 'prompt')).rejects.toMatchObject({ reason: 'generating' })
    expect(h.get().messages).toHaveLength(3)
    expect(h.orchestrate).not.toHaveBeenCalled()
  })
})

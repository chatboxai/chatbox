import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Message } from '../../types'
import { SessionService } from './SessionService'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'
import { SessionEventBus } from './session-events'

const message = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
  ...extra,
})
function service(repo: InMemorySessionRepository, active = new Set<string>()) {
  let id = 0
  return new SessionService(repo, new SessionWriteCoordinator(repo), new SessionEventBus(), {
    createId: () => `recovery-${id++}`,
    getActiveGenerationMessageIds: () => active,
  })
}

describe('row generation recovery', () => {
  it('recovers interrupted tools across threads without a full snapshot and retains paused and active streams', async () => {
    const repo = new InMemorySessionRepository()
    await repo.seedSession({
      id: 's',
      name: 'Chat',
      messages: [
        message('u', 'user'),
        message('a', 'assistant', {
          generating: true,
          timestamp: 1,
          contentParts: [
            { type: 'tool-call', toolCallId: 'tool', toolName: 'read', state: 'call', args: {}, startTime: 1 },
          ],
        }),
        message('live', 'assistant', { generating: true, timestamp: 1 }),
      ],
      threads: [
        {
          id: 'old',
          name: 'Old',
          createdAt: 1,
          messages: [
            message('archived', 'assistant', { generating: true, timestamp: 1 }),
            message('paused', 'assistant', {
              generating: false,
              contentParts: [{ type: 'tool-call', toolCallId: 'pause', toolName: 'write', state: 'paused', args: {} }],
            }),
          ],
        },
      ],
    })
    const app = service(repo, new Set(['live']))
    const snapshot = vi.spyOn(repo.rowStore, 'readSnapshot')
    const bodies = vi.spyOn(repo.rowStore, 'readMessages')
    await app.recoverInterruptedGenerations('s')
    expect(snapshot).not.toHaveBeenCalled()
    expect(bodies.mock.calls.every(([request]) => request.messageIds.length <= 1)).toBe(true)
    const read = await repo.readSessionMessages({ sessionId: 's', messageIds: ['a', 'archived', 'paused', 'live'] })
    expect(read?.messages.map((m) => [m.id, m.generating])).toEqual([
      ['a', false],
      ['archived', false],
      ['paused', false],
      ['live', true],
    ])
    expect(read?.messages[0].contentParts[0]).toMatchObject({
      state: 'error',
      result: { error: expect.stringContaining('interrupted') },
    })
    expect(read?.messages[2].contentParts[0]).toMatchObject({ state: 'paused' })
    app.dispose()
  })

  it('removes an empty inactive placeholder and collapses its fork locally', async () => {
    const repo = new InMemorySessionRepository()
    await repo.seedSession({
      id: 's',
      name: 'Chat',
      messages: [message('u', 'user'), message('a', 'assistant')],
      messageForksHash: {
        u: {
          position: 1,
          createdAt: 1,
          lists: [
            {
              id: 'empty-branch',
              messages: [message('empty', 'assistant', { generating: true, timestamp: 1, contentParts: [] })],
            },
            { id: 'chosen', messages: [] },
          ],
        },
      },
    })
    const app = service(repo)
    await app.recoverInterruptedGenerations('s')
    expect((await repo.readSessionMessages({ sessionId: 's', messageIds: ['empty'] }))?.messages).toEqual([])
    const options = await repo.readSessionForkOptionsPage({ sessionId: 's', pivotId: 'u', limit: 20 })
    expect(options?.branches ?? []).toHaveLength(0)
    const page = await repo.readSessionTranscriptWindow({ sessionId: 's', origin: 'tail', limit: 20 })
    expect(page?.messages.map((row) => row.messageId)).toEqual(['u', 'a'])
    app.dispose()
  })

  it('rechecks generating status and timestamp inside the command owner', async () => {
    const repo = new InMemorySessionRepository()
    await repo.seedSession({
      id: 's',
      name: 'Chat',
      messages: [message('a', 'assistant', { generating: true, timestamp: 1 })],
    })
    const app = service(repo)
    const read = repo.readSessionGeneratingMessageIds
    vi.spyOn(repo, 'readSessionGeneratingMessageIds').mockImplementation(async (id) => {
      const ids = await read(id)
      await repo.executeSessionCommand(id, {
        type: 'update',
        messageId: 'a',
        updater: { timestamp: Date.now() + 1000, contentParts: [{ type: 'text', text: 'new run' }] },
      })
      return ids
    })
    await app.recoverInterruptedGenerations('s')
    expect((await repo.readSessionMessages({ sessionId: 's', messageIds: ['a'] }))?.messages[0]).toMatchObject({
      generating: true,
      contentParts: [{ text: 'new run' }],
    })
    app.dispose()
  })
})

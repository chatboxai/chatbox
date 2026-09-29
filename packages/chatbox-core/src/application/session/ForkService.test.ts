import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types'
import { ForkService } from './ForkService'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }] }
}

describe('ForkService', () => {
  test.each(['off', 'on'] as const)('preserves a pending tool decision when agent mode is %s', async (mode) => {
    for (const pauseReason of [
      { type: 'user_exec_approval', command: 'ls' },
      { type: 'tool_call_limit', maxToolCalls: 25 },
    ] as const) {
      let session: Session = {
        id: 'paused',
        name: 'Paused',
        settings: { agentMode: { value: mode, locked: false, lockReason: null } },
        messages: [
          message('prompt', 'user'),
          {
            id: 'reply',
            role: 'assistant',
            generating: false,
            contentParts: [
              { type: 'tool-call', toolCallId: 'call', toolName: 'sandbox_bash', state: 'paused', pauseReason },
            ],
          },
        ],
        messageForksHash: {
          prompt: {
            position: 0,
            createdAt: 1,
            lists: [
              { id: 'current', messages: [] },
              { id: 'other', messages: [message('other', 'assistant')] },
            ],
          },
        },
      }
      const service = new ForkService(
        {
          updateSessionWithMessages: async (_id, updater) => {
            session = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
            return session
          },
        },
        { createId: () => 'unused', now: () => 1 }
      )
      await expect(service.switch(session.id, 'prompt', 'next')).rejects.toMatchObject({
        reason: 'awaiting-pause-decision',
      })
      expect(session.messageForksHash?.prompt.position).toBe(0)
      expect(session.messages.at(-1)?.id).toBe('reply')
    }
  })

  test.each(['chat', 'work', 'work-preparing', 'compaction'] as const)(
    'enforces %s branch switching inside the atomic update',
    async (state) => {
      let session: Session = {
        id: 'session-1',
        name: 'Forks',
        settings: {
          agentMode: { value: state.startsWith('work') ? 'on' : 'off', locked: true, lockReason: 'message_sent' },
        },
        messages: [message('pivot', 'user'), { ...message('stream', 'assistant'), generating: true }],
        messageForksHash: {
          pivot: {
            position: 0,
            createdAt: 1,
            lists: [
              { id: 'active', messages: [] },
              { id: 'saved', messages: [message('saved-answer', 'assistant')] },
            ],
          },
        },
      }
      const service = new ForkService(
        {
          async updateSessionWithMessages(_id, updater) {
            session = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
            return session
          },
        },
        { createId: () => 'unused', now: () => 1 },
        () => ({
          activeGenerationMessageIds: new Set(state === 'work-preparing' ? [] : ['stream']),
          compactionRunning: state === 'compaction',
        })
      )
      const switching = service.switch(session.id, 'pivot', 'next')
      if (state === 'chat') {
        await switching
        expect(session.messages.map(({ id }) => id)).toEqual(['pivot', 'saved-answer'])
        expect(session.messageForksHash?.pivot.lists[0].messages[0]).toMatchObject({ id: 'stream', generating: true })
      } else {
        await expect(switching).rejects.toMatchObject({
          reason: state.startsWith('work') ? 'generating' : 'compaction',
        })
        expect(session.messages[1].id).toBe('stream')
      }
    }
  )

  test('applies the shared fork transform through one atomic Session update', async () => {
    let session: Session = {
      id: 'session-1',
      name: 'Forks',
      messages: [message('pivot', 'user'), message('tail', 'assistant')],
    }
    let id = 0
    const service = new ForkService(
      {
        async updateSessionWithMessages(_sessionId, updater) {
          session = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
          return session
        },
      },
      { createId: () => `id-${++id}`, now: () => 1 }
    )

    await service.create(session.id, 'pivot')

    expect(session.messages.map(({ id }) => id)).toEqual(['pivot'])
    expect(session.messageForksHash?.pivot?.lists).toHaveLength(2)
    expect(session.messageForksHash?.pivot?.lists[0].messages.map(({ id }) => id)).toEqual(['tail'])
  })

  test('keeps the current Session unchanged when a transform has no target', async () => {
    const original: Session = { id: 'session-1', name: 'Forks', messages: [message('only', 'user')] }
    let session = original
    const service = new ForkService(
      {
        async updateSessionWithMessages(_sessionId, updater) {
          session = typeof updater === 'function' ? updater(session) : { ...session, ...updater }
          return session
        },
      },
      { createId: () => 'unused', now: () => 1 }
    )

    await service.create(session.id, 'missing')

    expect(session).toBe(original)
  })
})

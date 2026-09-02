import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types'
import { ForkService } from './ForkService'

function message(id: string, role: Message['role']): Message {
  return { id, role, contentParts: [{ type: 'text', text: id }] }
}

describe('ForkService', () => {
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

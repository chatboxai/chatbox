import { describe, expect, test } from 'vitest'
import type { Message, Session } from '../../types/session'
import { applyMessageRemoval } from './message-tree'

function message(id: string, role: Message['role'] = 'assistant'): Message {
  return { id, role, contentParts: [] }
}

describe('applyMessageRemoval fork cleanup', () => {
  test('removes the fork rooted at a deleted pivot and its nested fork entries', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('pivot', 'user'), message('active-answer')],
      messageForksHash: {
        pivot: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'active', messages: [] },
            { id: 'saved', messages: [message('saved-pivot', 'user'), message('saved-answer')] },
          ],
        },
        'saved-pivot': {
          position: 0,
          createdAt: 2,
          lists: [
            { id: 'saved-active', messages: [] },
            { id: 'saved-alternative', messages: [message('nested-answer')] },
          ],
        },
      },
    }

    const updated = applyMessageRemoval(session, session.id, 'pivot')

    expect(updated.messages.map(({ id }) => id)).toEqual(['active-answer'])
    expect(updated.messageForksHash).toBeUndefined()
  })
})

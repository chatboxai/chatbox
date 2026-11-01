import { expect, test, vi } from 'vitest'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import type { Message, Session } from '../../types'

const message = (id: string, role: Message['role']): Message => ({
  id,
  role,
  contentParts: [{ type: 'text', text: id }],
})

test('queue state excludes archived and inactive anchors and reads at most three bodies', async () => {
  const repo = new InMemorySessionRepository()
  const shared = message('u0', 'user'),
    selected = message('a0', 'assistant'),
    other = message('other', 'assistant')
  const session: Session = {
    id: 's',
    name: 'Chat',
    messages: [shared, selected, ...Array.from({ length: 1000 }, (_, i) => message(`u${i + 1}`, 'user'))],
    threads: [{ id: 'old', name: 'Old', createdAt: 1, messages: [message('archived', 'user')] }],
    messageForksHash: {
      u0: {
        position: 1,
        lists: [
          { id: 'inactive', messages: [other] },
          { id: 'selected', messages: [] },
        ],
        createdAt: 1,
      },
    },
  }
  await repo.seedSession(session)
  const read = vi.spyOn(repo.rowStore, 'readMessages')
  const snapshot = vi.spyOn(repo.rowStore, 'readSnapshot')
  const state = await repo.readSessionConversationState({
    sessionId: 's',
    messageIds: ['u0', 'other', 'archived', 'missing'],
  })
  expect(state?.matchedMessageIds).toEqual(['u0'])
  expect(state?.tailMessages.map((m) => m.id)).toEqual(['u999', 'u1000'])
  expect(state?.lastAssistantMessage?.id).toBe('a0')
  expect(state?.lastSettledMessageId).toBe('u1000')
  expect(read.mock.calls.flatMap(([request]) => request.messageIds)).toHaveLength(3)
  expect(snapshot).not.toHaveBeenCalled()
})

test('anchor skips transient placeholders and revision changes reject stale admission', async () => {
  const repo = new InMemorySessionRepository()
  await repo.seedSession({
    id: 's',
    name: 'Chat',
    messages: [message('u', 'user'), { ...message('a', 'assistant'), generating: true }],
  })
  const state = await repo.readSessionConversationState({ sessionId: 's' })
  expect(state?.lastSettledMessageId).toBe('u')
  await repo.executeSessionCommand('s', { type: 'header', updater: { name: 'Changed' } })
  await expect(
    repo.readSessionConversationState({ sessionId: 's', expectedRevision: state!.revision })
  ).rejects.toMatchObject({ name: 'SessionRowConflictError' })
})

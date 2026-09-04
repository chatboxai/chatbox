import { describe, expect, it, vi } from 'vitest'
import type { Message, Session } from '../../types'
import {
  ChatMessageService,
  type ChatMessageValidationError,
  ChatSendPreflightInvalidatedError,
} from './ChatMessageService'

function createHarness(
  initial?: Session,
  beforeSend?: (sessionId: string, pendingUserMessage: Message) => Promise<void>
) {
  const sessions = new Map<string, Session>(initial ? [[initial.id, initial]] : [])
  let id = 0
  let now = 100
  const generation = vi.fn((sessionId: string, message: Message) => {
    const session = sessions.get(sessionId)
    if (!session) throw new Error('missing session')
    sessions.set(sessionId, {
      ...session,
      messages: session.messages.map((candidate) =>
        candidate.id === message.id ? { ...candidate, generating: false } : candidate
      ),
      threads: session.threads?.map((thread) => ({
        ...thread,
        messages: thread.messages.map((candidate) =>
          candidate.id === message.id ? { ...candidate, generating: false } : candidate
        ),
      })),
    })
    return Promise.resolve()
  })
  const createSession = vi.fn((input: Omit<Session, 'id'>) => {
    const session = { ...input, id: `session-${++id}` }
    sessions.set(session.id, session)
    return Promise.resolve(session)
  })
  const service = new ChatMessageService({
    sessions: {
      createSession,
      getSession: (sessionId) => Promise.resolve(sessions.get(sessionId) ?? null),
      updateSessionWithMessages: (sessionId, updater) => {
        const updated = updater(sessions.get(sessionId))
        sessions.set(sessionId, updated)
        return Promise.resolve(updated)
      },
    },
    generation: { orchestrate: generation },
    beforeSend,
    createId: () => `message-${++id}`,
    now: () => ++now,
  })
  return { createSession, generation, service, sessions }
}

describe('ChatMessageService', () => {
  it('validates the whole first turn before creating persistence', async () => {
    const harness = createHarness()

    await expect(
      harness.service.sendNewSession({
        idempotencyKey: 'draft-1',
        input: { text: 'Hello' },
        sessionSettings: {},
      })
    ).rejects.toMatchObject({ code: 'missing-provider' } satisfies Partial<ChatMessageValidationError>)
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.sessions.size).toBe(0)
  })

  it('creates one session and one turn for duplicate first-send calls', async () => {
    const harness = createHarness()
    const persisted = vi.fn()
    const request = {
      idempotencyKey: 'draft-2',
      input: { text: 'Hello native' },
      sessionSettings: { provider: 'openai', modelId: 'gpt-test' },
      systemPrompt: 'Be concise',
      onSessionPersisted: persisted,
    }

    const first = harness.service.sendNewSession(request)
    const second = harness.service.sendNewSession(request)
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult.session.id).toBe(secondResult.session.id)
    expect(harness.createSession).toHaveBeenCalledTimes(1)
    expect(harness.generation).toHaveBeenCalledTimes(1)
    expect(persisted).toHaveBeenCalledTimes(1)
    expect(firstResult.session.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
  })

  it('allows the same draft to retry when persistence failed before a session existed', async () => {
    const harness = createHarness()
    harness.createSession.mockRejectedValueOnce(new Error('database busy'))
    const request = {
      idempotencyKey: 'draft-retry',
      input: { text: 'Try again' },
      sessionSettings: { provider: 'openai', modelId: 'gpt-test' },
    }

    await expect(harness.service.sendNewSession(request)).rejects.toThrow('database busy')
    await expect(harness.service.sendNewSession(request)).resolves.toMatchObject({
      session: { id: expect.any(String) },
    })

    expect(harness.createSession).toHaveBeenCalledTimes(2)
    expect(harness.sessions.size).toBe(1)
  })

  it('persists an existing user and assistant turn before generation starts', async () => {
    const session: Session = {
      id: 'existing',
      name: 'Existing',
      type: 'chat',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [],
    }
    const harness = createHarness(session)
    const persisted = vi.fn(() => {
      expect(harness.sessions.get(session.id)?.messages).toHaveLength(2)
    })

    await harness.service.sendExistingSession(session.id, {
      input: { text: 'Next turn' },
      onMessagesPersisted: persisted,
    })

    expect(persisted).toHaveBeenCalledOnce()
    expect(harness.generation).toHaveBeenCalledOnce()
    expect(harness.sessions.get(session.id)?.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
  })

  it('runs the pre-send hook inside the send flight before persisting the new turn', async () => {
    const session: Session = {
      id: 'existing-pre-send',
      name: 'Existing',
      type: 'chat',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [],
    }
    const events: string[] = []
    const harness = createHarness(session, () => {
      events.push('before-send')
      return Promise.resolve()
    })

    await harness.service.sendExistingSession(session.id, {
      input: { text: 'Next turn' },
      onMessagesPersisted: () => {
        events.push('persisted')
      },
    })

    expect(events).toEqual(['before-send', 'persisted'])
  })

  it('preserves persistence callbacks and the existing graph when pre-send compaction fails', async () => {
    const session: Session = {
      id: 'existing-compaction-failure',
      name: 'Existing',
      type: 'chat',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [{ id: 'old', role: 'user', contentParts: [{ type: 'text', text: 'old' }] }],
    }
    const harness = createHarness(session, () => Promise.reject(new Error('summary failed')))
    const persisted = vi.fn()

    await expect(
      harness.service.sendExistingSession(session.id, {
        input: { text: 'Unpersisted draft' },
        onMessagesPersisted: persisted,
      })
    ).rejects.toThrow('summary failed')

    expect(persisted).not.toHaveBeenCalled()
    expect(harness.generation).not.toHaveBeenCalled()
    expect(harness.sessions.get(session.id)?.messages).toEqual(session.messages)
  })

  it('rejects a delayed preflight when the active thread changes before persistence', async () => {
    const initialMessage: Message = {
      id: 'initial-thread-message',
      role: 'user',
      contentParts: [{ type: 'text', text: 'Initial thread' }],
    }
    const switchedMessage: Message = {
      id: 'switched-thread-message',
      role: 'user',
      contentParts: [{ type: 'text', text: 'Switched thread' }],
    }
    const session: Session = {
      id: 'preflight-thread-race',
      name: 'Thread race',
      type: 'chat',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [initialMessage],
    }
    let releasePreflight: (() => void) | undefined
    const preflight = new Promise<void>((resolve) => {
      releasePreflight = resolve
    })
    const beforeSend = vi.fn(() => preflight)
    const harness = createHarness(session, beforeSend)
    const persisted = vi.fn()

    const send = harness.service.sendExistingSession(session.id, {
      input: { text: 'Must stay on initial thread' },
      onMessagesPersisted: persisted,
    })
    await vi.waitFor(() => expect(beforeSend).toHaveBeenCalledOnce())
    expect(beforeSend).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        role: 'user',
        contentParts: [{ type: 'text', text: 'Must stay on initial thread' }],
      })
    )
    harness.sessions.set(session.id, { ...session, messages: [switchedMessage] })
    releasePreflight?.()

    await expect(send).rejects.toBeInstanceOf(ChatSendPreflightInvalidatedError)
    expect(persisted).not.toHaveBeenCalled()
    expect(harness.generation).not.toHaveBeenCalled()
    expect(harness.sessions.get(session.id)?.messages).toEqual([switchedMessage])
  })

  it('preserves the previous answer as a fork when retrying', async () => {
    const user: Message = { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] }
    const oldAnswer: Message = {
      id: 'old-answer',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'Old answer' }],
    }
    const session: Session = {
      id: 'retry-session',
      name: 'Retry',
      type: 'chat',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [user, oldAnswer],
    }
    const harness = createHarness(session)

    await harness.service.retryMessage(session.id, oldAnswer.id)

    const updated = harness.sessions.get(session.id)
    expect(updated?.messages).toHaveLength(2)
    expect(updated?.messages[0].id).toBe(user.id)
    expect(updated?.messages[1]).toMatchObject({ role: 'assistant', generating: false })
    expect(updated?.messages[1].id).not.toBe(oldAnswer.id)
    expect(updated?.messageForksHash?.[user.id].lists[0].messages).toEqual([oldAnswer])
    expect(harness.generation).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        id: updated?.messages[1].id,
        generating: true,
      }),
      {
        operationType: 'regenerate',
      }
    )
  })

  it('keeps an anchored summary in the shared prefix when retrying', async () => {
    const user: Message = { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Question' }] }
    const summary: Message = {
      id: 'summary',
      role: 'assistant',
      isSummary: true,
      contentParts: [{ type: 'text', text: 'Shared summary' }],
    }
    const oldAnswer: Message = {
      id: 'old-answer',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'Old answer' }],
    }
    const session: Session = {
      id: 'summary-retry-session',
      name: 'Retry',
      type: 'chat',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [user, summary, oldAnswer],
    }
    const harness = createHarness(session)

    await harness.service.retryMessage(session.id, oldAnswer.id)

    const updated = harness.sessions.get(session.id)
    expect(updated?.messages.slice(0, 2)).toEqual([user, summary])
    expect(updated?.messageForksHash?.[user.id].lists[0].messages).toEqual([oldAnswer])
  })

  it('edits and deletes messages in an archived thread without touching the active thread', async () => {
    const archivedUser: Message = {
      id: 'archived-user',
      role: 'user',
      contentParts: [
        { type: 'info', text: 'Preserved metadata' },
        { type: 'text', text: 'Before' },
      ],
    }
    const archivedSummary: Message = {
      id: 'archived-summary',
      role: 'assistant',
      isSummary: true,
      contentParts: [{ type: 'text', text: 'Summary' }],
    }
    const active: Message = { id: 'active', role: 'user', contentParts: [] }
    const session: Session = {
      id: 'history-mutations',
      name: 'History mutations',
      messages: [active],
      threads: [
        {
          id: 'history',
          name: 'History',
          createdAt: 1,
          messages: [archivedUser, archivedSummary],
          compactionPoints: [
            { boundaryMessageId: archivedUser.id, createdAt: 1, summaryMessageId: archivedSummary.id },
          ],
        },
      ],
    }
    const harness = createHarness(session)

    await harness.service.editMessage(session.id, archivedUser.id, [
      archivedUser.contentParts[0],
      { type: 'text', text: 'After' },
    ])
    await harness.service.deleteMessage(session.id, archivedSummary.id)

    const updated = harness.sessions.get(session.id)
    expect(updated?.messages).toEqual([active])
    expect(updated?.threads?.[0].messages).toMatchObject([
      {
        id: archivedUser.id,
        contentParts: [
          { type: 'info', text: 'Preserved metadata' },
          { type: 'text', text: 'After' },
        ],
      },
    ])
    expect(updated?.threads?.[0].compactionPoints).toEqual([])
  })

  it('creates and generates a retry fork inside an archived thread', async () => {
    const archivedUser: Message = {
      id: 'archived-user',
      role: 'user',
      contentParts: [{ type: 'text', text: 'Question' }],
    }
    const archivedAnswer: Message = {
      id: 'archived-answer',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'Old answer' }],
    }
    const active: Message = { id: 'active', role: 'user', contentParts: [] }
    const session: Session = {
      id: 'history-retry',
      name: 'History retry',
      settings: { provider: 'openai', modelId: 'gpt-test' },
      messages: [active],
      threads: [
        {
          id: 'history',
          name: 'History',
          createdAt: 1,
          messages: [archivedUser, archivedAnswer],
        },
      ],
    }
    const harness = createHarness(session)

    await harness.service.retryMessage(session.id, archivedAnswer.id)

    const updated = harness.sessions.get(session.id)
    const retried = updated?.threads?.[0].messages[1]
    expect(updated?.messages).toEqual([active])
    expect(updated?.threads?.[0].messages[0]).toEqual(archivedUser)
    expect(retried).toMatchObject({ role: 'assistant', generating: false })
    expect(retried?.id).not.toBe(archivedAnswer.id)
    expect(updated?.messageForksHash?.[archivedUser.id].lists[0].messages).toEqual([archivedAnswer])
    expect(harness.generation).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ id: retried?.id, generating: true }),
      { operationType: 'regenerate' }
    )
  })
})

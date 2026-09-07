import { describe, expect, test } from 'vitest'
import type { Message, Session, SessionMeta } from '../../types'
import { assertNoMessageDataUpdate, getSessionMetadataSnapshot, projectSessionMeta } from './session-metadata'

describe('projectSessionMeta', () => {
  test('preserves the previous pick semantics for absent and explicitly undefined optional fields', () => {
    const minimal: SessionMeta = {
      id: 'session-1',
      name: 'Session 1',
    }

    const withoutOptionalFields = projectSessionMeta(minimal)
    expect(withoutOptionalFields).toEqual(minimal)
    expect(Object.hasOwn(withoutOptionalFields, 'starred')).toBe(false)

    const withExplicitUndefined = projectSessionMeta({
      ...minimal,
      starred: undefined,
    })
    expect(Object.hasOwn(withExplicitUndefined, 'starred')).toBe(true)
    expect(withExplicitUndefined.starred).toBeUndefined()
  })
})

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'message-id',
    role: overrides.role ?? 'assistant',
    contentParts: overrides.contentParts ?? [],
    ...overrides,
  }
}

function session(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? 'session-id',
    name: overrides.name ?? 'Session',
    messages: overrides.messages ?? [],
    ...overrides,
  }
}

describe('session metadata update helpers', () => {
  test('returns a snapshot without message-owned fields', () => {
    const result = getSessionMetadataSnapshot(
      session({
        messages: [message({ id: 'message-1' })],
        threads: [
          {
            id: 'thread-1',
            name: 'Thread',
            messages: [message({ id: 'thread-message-1' })],
            createdAt: 1,
          },
        ],
        messageForksHash: {
          'message-1': {
            position: 0,
            lists: [{ id: 'fork-1', messages: [message({ id: 'fork-message-1' })] }],
            createdAt: 1,
          },
        },
        compactionPoints: [{ summaryMessageId: 'summary-1', boundaryMessageId: 'message-1', createdAt: 1 }],
        settings: {
          provider: 'openai',
          modelId: 'gpt-4.1',
        },
      })
    )

    expect(result).toEqual({
      id: 'session-id',
      name: 'Session',
      settings: {
        provider: 'openai',
        modelId: 'gpt-4.1',
      },
    })
  })

  test('rejects message-owned fields in metadata updates', () => {
    expect(() => assertNoMessageDataUpdate({ settings: { modelId: 'gpt-4.1' } })).not.toThrow()
    expect(() => assertNoMessageDataUpdate({ messages: [] })).toThrow(
      'updateSession cannot update "messages". Use updateSessionWithMessages for message data.'
    )
    expect(() => assertNoMessageDataUpdate({ threads: [] })).toThrow(
      'updateSession cannot update "threads". Use updateSessionWithMessages for message data.'
    )
    expect(() => assertNoMessageDataUpdate({ messageForksHash: {} })).toThrow(
      'updateSession cannot update "messageForksHash". Use updateSessionWithMessages for message data.'
    )
    expect(() => assertNoMessageDataUpdate({ compactionPoints: [] })).toThrow(
      'updateSession cannot update "compactionPoints". Use updateSessionWithMessages for message data.'
    )
  })
})

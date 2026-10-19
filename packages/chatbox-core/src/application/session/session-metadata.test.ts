import { describe, expect, test } from 'vitest'
import type { Message, Session, SessionMeta } from '../../types'
import { projectSessionMeta } from './session-metadata'
import { deriveMessageFacts } from '../../session/message-facts'

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

function pausedFacts(value: Session) {
  return value.messages.some((message) => deriveMessageFacts(message).paused)
}

describe('message pause facts', () => {
  test('detects a paused tool call in the message list', () => {
    const pausedSession = session({
      messages: [
        message({
          id: 'message-1',
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'user_exec',
              args: {},
              state: 'paused',
              pauseReason: { type: 'user_exec_approval', command: 'rm -rf' },
            },
          ],
        }),
      ],
    })

    expect(pausedSession.messages.some((message) => deriveMessageFacts(message).paused)).toBe(true)
  })

  test('detects a tool-call-limit pause', () => {
    const limitedSession = session({
      messages: [
        message({
          id: 'message-1',
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'search',
              args: {},
              state: 'paused',
              pauseReason: { type: 'tool_call_limit', maxToolCalls: 25 },
            },
          ],
        }),
      ],
    })

    expect(limitedSession.messages.some((message) => deriveMessageFacts(message).paused)).toBe(true)
  })

  test('ignores a paused tool call whose pause reason surfaces no action', () => {
    // Imported or cross-version data can hold a paused part without a
    // recognized pauseReason; no approval card or continue action exists for
    // it, so it must not mark the session as waiting.
    const strandedSession = session({
      messages: [
        message({
          id: 'message-1',
          contentParts: [
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'user_exec',
              args: {},
              state: 'paused',
            },
          ],
        }),
      ],
    })

    expect(pausedFacts(strandedSession)).toBe(false)
  })

  test('returns false when no tool call is paused', () => {
    const idleSession = session({
      messages: [message({ id: 'message-1', contentParts: [{ type: 'text', text: 'hi' }] })],
    })

    expect(pausedFacts(idleSession)).toBe(false)
  })
})

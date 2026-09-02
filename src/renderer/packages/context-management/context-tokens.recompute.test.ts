/**
 * @vitest-environment jsdom
 *
 * Recompute-count regression guards for the token estimation pipeline.
 *
 * The pipeline's historical failure mode is not wrong numbers but wasted
 * work: streaming replaces `session.messages` (and the generating message
 * object) on every chunk, and the O(n) analysis used to re-run each time.
 * These tests pin the invariants with call counters around the real
 * analyzer, so a dependency-array regression fails loudly instead of
 * silently burning CPU in long conversations.
 */
import type { Message, Session } from '@shared/types'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/queryClient', () => {
  const mockClient = {
    setQueryDefaults: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  }
  return { default: mockClient, queryClient: mockClient }
})

vi.mock('@/packages/token-estimation/analyzer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/token-estimation/analyzer')>()
  return {
    ...actual,
    analyzeContextTokens: vi.fn(actual.analyzeContextTokens),
    analyzeCurrentInputTokens: vi.fn(actual.analyzeCurrentInputTokens),
  }
})

import { analyzeContextTokens, analyzeCurrentInputTokens } from '@/packages/token-estimation/analyzer'
import { computationQueue } from '@/packages/token-estimation/computation-queue'
import { useContextTokens, useStableEligibleMessages } from './context-tokens'

function message(id: string, role: 'user' | 'assistant', text: string, overrides?: Partial<Message>): Message {
  return {
    id,
    role,
    contentParts: [{ type: 'text', text }],
    ...overrides,
  } as Message
}

// Shared across rebuilt session objects: updateMessageCache spreads the
// session, so streaming updates keep the compactionPoints reference.
const SHARED_COMPACTION_POINTS: Session['compactionPoints'] = []

function createSession(messages: Message[]): Session {
  return {
    id: 'perf-session',
    name: 'Perf Session',
    messages,
    compactionPoints: SHARED_COMPACTION_POINTS,
    settings: {},
  } as unknown as Session
}

const stableUser = message('msg-user', 'user', 'Hello there')
const stableAssistant = message('msg-assistant', 'assistant', 'Hi, how can I help?')

function generatingReply(text: string): Message {
  return message('msg-generating', 'assistant', text, { generating: true })
}

describe('useStableEligibleMessages', () => {
  it('reuses the previous array when only the generating message changes identity', () => {
    const first = [stableUser, stableAssistant, generatingReply('chunk 1')]
    const { result, rerender } = renderHook(({ messages }) => useStableEligibleMessages(messages), {
      initialProps: { messages: first },
    })
    const firstResult = result.current

    // Simulate a streaming chunk: new array, new generating message object,
    // untouched stable messages.
    rerender({ messages: [stableUser, stableAssistant, generatingReply('chunk 1 + chunk 2')] })

    expect(result.current).toBe(firstResult)
    expect(result.current).toEqual([stableUser, stableAssistant])
  })

  it('returns a new array when a stable message object is replaced (e.g. token cache write)', () => {
    const first = [stableUser, stableAssistant]
    const { result, rerender } = renderHook(({ messages }) => useStableEligibleMessages(messages), {
      initialProps: { messages: first },
    })
    const firstResult = result.current

    const updatedAssistant = { ...stableAssistant, tokenCountMap: { default: 12 } } as Message
    rerender({ messages: [stableUser, updatedAssistant] })

    expect(result.current).not.toBe(firstResult)
    expect(result.current[1]).toBe(updatedAssistant)
  })

  it('returns a new array when a message is appended', () => {
    const { result, rerender } = renderHook(({ messages }) => useStableEligibleMessages(messages), {
      initialProps: { messages: [stableUser] },
    })
    const firstResult = result.current

    rerender({ messages: [stableUser, stableAssistant] })

    expect(result.current).not.toBe(firstResult)
    expect(result.current).toHaveLength(2)
  })
})

describe('useContextTokens recompute guards', () => {
  beforeEach(() => {
    computationQueue._reset()
    vi.mocked(analyzeContextTokens).mockClear()
    vi.mocked(analyzeCurrentInputTokens).mockClear()
  })

  afterEach(() => {
    computationQueue._reset()
  })

  function renderContextTokens(initialSession: Session, constructedMessage?: Message) {
    return renderHook(
      ({ session, draft }: { session: Session; draft?: Message }) =>
        useContextTokens({
          sessionId: session.id,
          session,
          settings: {},
          model: undefined,
          modelSupportToolUseForFile: false,
          constructedMessage: draft,
        }),
      { initialProps: { session: initialSession, draft: constructedMessage } }
    )
  }

  it('does not re-run context analysis when streaming chunks replace the messages array', () => {
    const draft = message('draft', 'user', 'draft text')
    const { rerender } = renderContextTokens(
      createSession([stableUser, stableAssistant, generatingReply('chunk 1')]),
      draft
    )

    const contextCallsAfterMount = vi.mocked(analyzeContextTokens).mock.calls.length
    const inputCallsAfterMount = vi.mocked(analyzeCurrentInputTokens).mock.calls.length
    expect(contextCallsAfterMount).toBeGreaterThan(0)

    // 20 streaming chunks: each replaces session, messages array, and the
    // generating message object — exactly what updateStreamingCache does.
    for (let chunk = 2; chunk <= 21; chunk++) {
      rerender({
        session: createSession([stableUser, stableAssistant, generatingReply(`chunks 1..${chunk}`)]),
        draft,
      })
    }

    expect(vi.mocked(analyzeContextTokens).mock.calls.length).toBe(contextCallsAfterMount)
    expect(vi.mocked(analyzeCurrentInputTokens).mock.calls.length).toBe(inputCallsAfterMount)
  })

  it('re-runs context analysis when a completed message actually changes', () => {
    const { rerender } = renderContextTokens(createSession([stableUser, stableAssistant]))
    const callsAfterMount = vi.mocked(analyzeContextTokens).mock.calls.length

    const updatedAssistant = { ...stableAssistant, tokenCountMap: { default: 12 } } as Message
    rerender({ session: createSession([stableUser, updatedAssistant]), draft: undefined })

    expect(vi.mocked(analyzeContextTokens).mock.calls.length).toBeGreaterThan(callsAfterMount)
  })

  it('re-encodes only the draft when the draft changes', () => {
    const { rerender } = renderContextTokens(
      createSession([stableUser, stableAssistant]),
      message('draft', 'user', 'draft v1')
    )
    const contextCalls = vi.mocked(analyzeContextTokens).mock.calls.length
    const inputCalls = vi.mocked(analyzeCurrentInputTokens).mock.calls.length

    rerender({
      session: createSession([stableUser, stableAssistant]),
      draft: message('draft', 'user', 'draft v1 plus more typing'),
    })

    expect(vi.mocked(analyzeCurrentInputTokens).mock.calls.length).toBeGreaterThan(inputCalls)
    expect(vi.mocked(analyzeContextTokens).mock.calls.length).toBe(contextCalls)
  })
})

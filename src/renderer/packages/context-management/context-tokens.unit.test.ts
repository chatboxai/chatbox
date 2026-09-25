import { selectContextMessages } from '@shared/context'
/**
 * @vitest-environment jsdom
 */
import type { CompactionPoint, Message, Session } from '@shared/types'
import type { MessageRoleEnum } from '@shared/types/session'
import { describe, expect, it, vi } from 'vitest'

// Mock modules that have problematic import chains (router, etc.)
vi.mock('@/stores/queryClient', () => ({
  default: {
    setQueryDefaults: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
  queryClient: {
    setQueryDefaults: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  },
}))

vi.mock('@/packages/token-estimation/hooks/useTokenEstimation', () => ({
  useTokenEstimation: vi.fn(() => ({
    contextTokens: 0,
    currentInputTokens: 0,
    totalTokens: 0,
    isCalculating: false,
    pendingTasks: 0,
  })),
}))

vi.mock('@/packages/token-estimation', () => ({
  getTokenizerType: vi.fn(() => 'default'),
}))

import { getContextMessagesForTokenEstimation, getContextMessagesForTokenSource } from './context-tokens'

function createMessage(id: string, role: (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum], text = ''): Message {
  return {
    id,
    role,
    contentParts: text ? [{ type: 'text', text }] : [],
  }
}

function createTestSession(overrides?: Partial<Session>): Session {
  return {
    id: 'test-session',
    name: 'Test Session',
    messages: [createMessage('msg-1', 'user', 'Hello'), createMessage('msg-2', 'assistant', 'Hi there')],
    compactionPoints: [],
    settings: {},
    ...overrides,
  } as Session
}

describe('getContextMessagesForTokenEstimation', () => {
  it('keeps bounded source selection identical to full history across compaction and limits', () => {
    const messages = [
      createMessage('system', 'system'),
      createMessage('old', 'user'),
      createMessage('boundary', 'assistant'),
      { ...createMessage('summary', 'assistant'), isSummary: true },
      createMessage('tail', 'user'),
      { ...createMessage('stream', 'assistant'), generating: true },
    ]
    const compactionPoints: CompactionPoint[] = [
      { boundaryMessageId: 'boundary', summaryMessageId: 'summary', createdAt: 1 },
    ]
    const session = createTestSession({ messages, compactionPoints })
    const source = { candidateMessages: messages.filter((message) => message.id !== 'old'), compactionPoints }
    for (const maxContextMessageCount of [0, 1, 2, 100]) {
      const options = { settings: { maxContextMessageCount } }
      expect(getContextMessagesForTokenSource(source, options)).toEqual(
        getContextMessagesForTokenEstimation(session, options)
      )
    }
  })
  it('applies maxContextMessageCount', () => {
    const session = createTestSession({
      messages: [
        createMessage('msg-1', 'user', 'First'),
        createMessage('msg-2', 'assistant', 'Second'),
        createMessage('msg-3', 'user', 'Third'),
        createMessage('msg-4', 'assistant', 'Fourth'),
        createMessage('msg-5', 'user', 'Fifth'),
      ],
    })

    const result = getContextMessagesForTokenEstimation(session, { settings: { maxContextMessageCount: 3 } })

    // Should return only the last 3 messages
    expect(result.length).toBe(3)
    expect(result.map((m) => m.id)).toEqual(['msg-3', 'msg-4', 'msg-5'])
  })

  it('filters error messages', () => {
    const session = createTestSession({
      messages: [
        createMessage('msg-1', 'user', 'Hello'),
        createMessage('msg-2', 'assistant', 'Hi'),
        { ...createMessage('msg-3', 'assistant', 'Error response'), error: 'API error' },
        { ...createMessage('msg-4', 'assistant', 'Error code'), errorCode: 400 },
        createMessage('msg-5', 'user', 'Another message'),
      ],
    })

    const result = getContextMessagesForTokenEstimation(session, {})

    // Verify: error messages are filtered
    expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-5'])
    expect(result.find((m) => m.id === 'msg-3')).toBeUndefined()
    expect(result.find((m) => m.id === 'msg-4')).toBeUndefined()
  })

  it('respects compaction points', () => {
    const session = createTestSession({
      messages: [
        createMessage('msg-1', 'user', 'Old message 1'),
        createMessage('msg-2', 'assistant', 'Old response 1'),
        createMessage('msg-3', 'user', 'New message 1'),
        createMessage('msg-4', 'assistant', 'New response 1'),
      ],
      compactionPoints: [
        {
          summaryMessageId: 'summary-1',
          boundaryMessageId: 'msg-2',
          createdAt: Date.now(),
        },
      ],
    })

    const result = getContextMessagesForTokenEstimation(session, {})

    // Should include messages after the compaction boundary
    expect(result.map((m) => m.id)).toContain('msg-3')
    expect(result.map((m) => m.id)).toContain('msg-4')
  })

  it('filters generating messages', () => {
    const session = createTestSession({
      messages: [
        createMessage('msg-1', 'user', 'Hello'),
        createMessage('msg-2', 'assistant', 'Hi'),
        { ...createMessage('msg-3', 'assistant', 'Generating...'), generating: true },
      ],
    })

    const result = getContextMessagesForTokenEstimation(session, {})

    // Verify: generating messages are filtered
    expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])
    expect(result.find((m) => m.id === 'msg-3')).toBeUndefined()
  })
})

it('previews the same history as sending, preserving system instructions and sticky windows', () => {
  const messages = [
    createMessage('system', 'system'),
    ...Array.from({ length: 12 }, (_, i) => createMessage(`m${i}`, i % 2 ? 'assistant' : 'user')),
  ]
  const draft = createMessage('draft', 'user')
  for (const maxContextMessageCount of [0, 1, 4, 8, 100]) {
    const expected = selectContextMessages([...messages, draft], { maxContextMessageCount }).filter(
      (message) => message !== draft
    )
    expect(
      getContextMessagesForTokenSource({ candidateMessages: messages }, { settings: { maxContextMessageCount } })
    ).toEqual(expected)
  }
})

it('keeps an applicable summary in the same preview window as sending', () => {
  const messages = [
    createMessage('system', 'system'),
    createMessage('old', 'user'),
    createMessage('boundary', 'assistant'),
    { ...createMessage('summary', 'assistant'), isSummary: true },
    createMessage('tail', 'user'),
  ]
  const compactionPoints = [{ boundaryMessageId: 'boundary', summaryMessageId: 'summary', createdAt: 1 }]
  const draft = createMessage('draft', 'user')
  const expected = selectContextMessages([...messages, draft], { compactionPoints, maxContextMessageCount: 4 }).filter(
    (message) => message !== draft
  )
  const preview = getContextMessagesForTokenSource(
    { candidateMessages: messages, compactionPoints },
    { settings: { maxContextMessageCount: 4 } }
  )
  expect(preview).toEqual(expected)
  expect(preview.some((message) => message.id === 'summary')).toBe(true)
})

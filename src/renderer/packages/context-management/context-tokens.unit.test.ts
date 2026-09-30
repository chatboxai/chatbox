import { buildContext, selectContextMessages } from '@shared/context'
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

import { getCompactionContext } from './compaction-context'
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

describe('history boundaries across send, compaction, and token preview', () => {
  const system = createMessage('system', 'system', 'Keep the instructions')
  const boundary = createMessage('boundary', 'assistant')
  const summary: Message = { ...createMessage('summary', 'assistant', 'Earlier history'), isSummary: true }
  const attachment: Message = {
    ...createMessage('attachment', 'user', 'Use these sources'),
    files: [{ id: 'file', name: 'notes.txt', fileType: 'txt', storageKey: 'notes' }],
    links: [{ id: 'link', title: 'Reference', url: 'https://example.com', storageKey: 'reference' }],
  }
  const tool: Message = {
    ...createMessage('tool', 'assistant'),
    contentParts: [
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: 'call',
        toolName: 'read_file',
        args: { path: 'notes.txt' },
        result: { content: 'Read result' },
      },
    ],
  }
  const point: CompactionPoint = { boundaryMessageId: 'boundary', summaryMessageId: 'summary', createdAt: 1 }
  const cases: {
    name: string
    messages: Message[]
    compactionPoints: CompactionPoint[]
    expected: Record<number, string[]>
  }[] = [
    {
      name: 'tools and attachment owners after a summary',
      messages: [
        system,
        {
          ...createMessage('old', 'user'),
          files: [{ id: 'old-file', name: 'old.txt', fileType: 'txt', storageKey: 'excluded' }],
        },
        boundary,
        summary,
        attachment,
        tool,
      ],
      compactionPoints: [point],
      expected: {
        0: ['system'],
        4: ['system', 'summary', 'attachment', 'tool'],
        100: ['system', 'summary', 'attachment', 'tool'],
      },
    },
    {
      name: 'selected fork path with an older applicable summary',
      messages: [
        system,
        createMessage('old', 'user'),
        boundary,
        summary,
        createMessage('selected-user', 'user'),
        createMessage('selected-reply', 'assistant'),
      ],
      compactionPoints: [
        point,
        { boundaryMessageId: 'selected-reply', summaryMessageId: 'sibling-summary', createdAt: 2 },
      ],
      expected: {
        0: ['system'],
        4: ['system', 'summary', 'selected-user', 'selected-reply'],
        100: ['system', 'summary', 'selected-user', 'selected-reply'],
      },
    },
    {
      name: 'legacy steering order with excluded messages and a sticky limit',
      messages: [
        system,
        createMessage('old-1', 'user'),
        createMessage('old-2', 'assistant'),
        createMessage('original', 'user'),
        createMessage('reply', 'assistant'),
        { ...createMessage('steered', 'user'), steered: true },
        { ...createMessage('stream', 'assistant'), generating: true },
        { ...createMessage('error', 'assistant'), error: 'Failed' },
        { ...createMessage('marker', 'user'), isForkMarker: true },
      ],
      compactionPoints: [],
      expected: {
        0: ['system'],
        4: ['system', 'original', 'steered', 'reply'],
        100: ['system', 'old-1', 'old-2', 'original', 'steered', 'reply'],
      },
    },
  ]

  it.each(cases)('$name', async ({ messages, compactionPoints, expected }) => {
    const pending = createMessage('pending', 'user', 'Next question')
    const current = createTestSession({ messages, compactionPoints })
    const original = structuredClone({ current, pending })
    const bodies: Record<string, string> = { notes: 'Selected file body', reference: 'Selected link body' }
    for (const maxContextMessageCount of [0, 4, 100]) {
      const read = vi.fn(async (key: string) => bodies[key] ?? null)
      const settings = { maxContextMessageCount }
      const sending = await buildContext([...messages, pending], {
        attachmentResolver: { read },
        compactionPoints,
        maxContextMessageCount,
      })
      const preview = getContextMessagesForTokenSource({ candidateMessages: messages, compactionPoints }, { settings })
      const compacting = getCompactionContext(current, settings, pending)
      const sentHistory = sending.filter((message) => message.id !== pending.id)
      expect(sending.map((message) => message.id)).toEqual([...expected[maxContextMessageCount], pending.id])
      for (const selected of [sentHistory, preview, compacting]) {
        expect(selected.map((message) => message.id)).toEqual(expected[maxContextMessageCount])
        for (const message of selected) {
          const source = messages.find((item) => item.id === message.id)!
          expect(message.files).toEqual(source.files)
          expect(message.links).toEqual(source.links)
          expect(message.contentParts.filter((part) => part.type === 'tool-call')).toEqual(
            source.contentParts.filter((part) => part.type === 'tool-call')
          )
        }
      }
      // Selection retains original content; attachment injection belongs to sending.
      for (const selected of [preview, compacting]) {
        expect(selected).toEqual(
          expected[maxContextMessageCount].map((id) => messages.find((message) => message.id === id))
        )
      }
      const sentAttachment = sentHistory.find((message) => message.id === 'attachment')
      if (sentAttachment) {
        const text = sentAttachment.contentParts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
        expect(text).toContain(bodies.notes)
        expect(text).toContain(bodies.reference)
        expect(read.mock.calls.map(([key]) => key).sort()).toEqual(['notes', 'reference'])
      } else {
        expect(read).not.toHaveBeenCalled()
      }
      expect({ current, pending }).toEqual(original)
    }
  })
})

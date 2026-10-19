import type { CompactionPoint, Message } from '@shared/types'
import { MessageRoleEnum } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { buildContextForAI } from './context-builder'

function createMessage(id: string, role: (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum], text = ''): Message {
  return {
    id,
    role,
    contentParts: text ? [{ type: 'text', text }] : [],
  }
}

function createSummaryMessage(id: string, text = 'Summary of conversation'): Message {
  return {
    id,
    role: MessageRoleEnum.Assistant,
    contentParts: [{ type: 'text', text }],
    isSummary: true,
  }
}

function createCompactionPoint(
  summaryMessageId: string,
  boundaryMessageId: string,
  createdAt: number
): CompactionPoint {
  return { summaryMessageId, boundaryMessageId, createdAt }
}

describe('buildContextForAI', () => {
  it('restores causal order of legacy steered records like the send path', () => {
    // Legacy steering stored the steered user AFTER the assistant it
    // interrupted; the send path reorders it in front. The compaction boundary
    // derives from this list, so the orders must match — otherwise the same
    // reply can land in both the summary and the raw tail.
    const messages: Message[] = [
      createMessage('u1', 'user', 'Q1'),
      { ...createMessage('a1', 'assistant', 'A1'), finishReason: 'stop' },
      { ...createMessage('u2', 'user', 'steer'), steered: true },
    ]

    const result = buildContextForAI({ messages })

    expect(result.map((m) => m.id)).toEqual(['u1', 'u2', 'a1'])
  })

  describe('no compaction points', () => {
    it('should return empty array for empty messages', () => {
      const result = buildContextForAI({ messages: [] })
      expect(result).toEqual([])
    })

    it('should return all messages when no compaction points exist', () => {
      const messages = [
        createMessage('m1', 'user', 'Hello'),
        createMessage('m2', 'assistant', 'Hi there'),
        createMessage('m3', 'user', 'How are you?'),
        createMessage('m4', 'assistant', 'I am fine'),
      ]

      const result = buildContextForAI({ messages })

      expect(result).toHaveLength(4)
      expect(result.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    })

    it('should exclude fork marker messages', () => {
      const messages = [
        createMessage('m1', 'user', 'Hello'),
        { ...createMessage('fork-marker', 'assistant'), isForkMarker: true },
        createMessage('m2', 'assistant', 'Hi there'),
      ]

      const result = buildContextForAI({ messages })

      expect(result.map((m) => m.id)).toEqual(['m1', 'm2'])
    })

    it('should return all messages when compactionPoints is empty array', () => {
      const messages = [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Hi')]

      const result = buildContextForAI({ messages, compactionPoints: [] })

      expect(result).toHaveLength(2)
    })

    it('should keep tool-call parts at full fidelity (cleanup is a send-path concern)', () => {
      const messages: Message[] = [
        createMessage('m1', 'user', 'Search for X'),
        {
          id: 'm2',
          role: MessageRoleEnum.Assistant,
          contentParts: [
            { type: 'text', text: 'Found it' },
            { type: 'tool-call', state: 'result', toolCallId: 'tc1', toolName: 'search', args: {} },
          ],
        },
        createMessage('m3', 'user', 'Thanks'),
        createMessage('m4', 'assistant', 'Welcome'),
      ]

      const result = buildContextForAI({ messages })

      expect(result[1].contentParts).toHaveLength(2)
      expect(result[1].contentParts.map((part) => part.type)).toEqual(['text', 'tool-call'])
    })
  })

  describe('with compaction points', () => {
    it('should start from boundaryMessageId + 1', () => {
      const messages = [
        createMessage('m1', 'user', 'Old message 1'),
        createMessage('m2', 'assistant', 'Old response 1'),
        createMessage('m3', 'user', 'Old message 2'),
        createMessage('m4', 'assistant', 'This is boundary'),
        createMessage('m5', 'user', 'New message 1'),
        createMessage('m6', 'assistant', 'New response 1'),
      ]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm4', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result.map((m) => m.id)).toEqual(['summary-1', 'm5', 'm6'])
    })

    it('should include summary message at the beginning', () => {
      const messages = [
        createMessage('m1', 'user', 'Old'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New'),
        createMessage('m4', 'assistant', 'Response'),
      ]
      const summary = createSummaryMessage('summary-1', 'This is the summary')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm2', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result[0].id).toBe('summary-1')
      expect(result[0].isSummary).toBe(true)
    })

    it('should use latest compaction point when multiple exist', () => {
      const messages = [
        createMessage('m1', 'user', 'Very old'),
        createMessage('m2', 'assistant', 'First boundary'),
        createMessage('m3', 'user', 'Less old'),
        createMessage('m4', 'assistant', 'Second boundary'),
        createMessage('m5', 'user', 'Recent'),
        createMessage('m6', 'assistant', 'Response'),
      ]
      const summary1 = createSummaryMessage('summary-1', 'First summary')
      const summary2 = createSummaryMessage('summary-2', 'Latest summary')
      const allMessages = [...messages, summary1, summary2]
      const compactionPoints = [
        createCompactionPoint('summary-1', 'm2', 1000),
        createCompactionPoint('summary-2', 'm4', 2000),
      ]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result[0].id).toBe('summary-2')
      expect(result.map((m) => m.id)).toEqual(['summary-2', 'm5', 'm6'])
    })

    it('should handle case when boundary message is the last message', () => {
      const messages = [
        createMessage('m1', 'user', 'Hello'),
        createMessage('m2', 'assistant', 'Boundary - last message'),
      ]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm2', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('summary-1')
    })

    it('should fall back without the orphaned summary when boundary not found', () => {
      const messages = [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Response')]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'non-existent', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      // The summary belongs to an inapplicable point (its boundary lives on
      // another branch); leaking it alongside full history would feed the
      // model a summary of other content.
      expect(result.map((m) => m.id)).toEqual(['m1', 'm2'])
    })

    it('should fall back to all messages when summary message is not found', () => {
      const messages = [
        createMessage('m1', 'user', 'Old'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New'),
        createMessage('m4', 'assistant', 'Response'),
      ]
      const compactionPoints = [createCompactionPoint('non-existent-summary', 'm2', Date.now())]

      const result = buildContextForAI({ messages, compactionPoints })

      // Half a compaction contract must not apply: without the summary standing
      // in, cutting at the boundary would silently drop history (worst case the
      // new reply generates with an empty context).
      expect(result.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    })

    it('should fall back to an older applicable compaction point when the latest is torn apart', () => {
      const now = Date.now()
      const messages = [
        createMessage('m1', 'user', 'Old'),
        createMessage('m2', 'assistant', 'First boundary'),
        createSummaryMessage('summary-1', 'First summary'),
        createMessage('m3', 'user', 'Follow-up'),
        createMessage('m4', 'assistant', 'Second boundary'),
        // summary-2 lives on a sibling fork branch: not in this path
        createMessage('m5', 'user', 'Latest'),
      ]
      const compactionPoints = [
        createCompactionPoint('summary-1', 'm2', now - 1000),
        createCompactionPoint('summary-2', 'm4', now),
      ]

      const result = buildContextForAI({ messages, compactionPoints })

      expect(result.map((m) => m.id)).toEqual(['summary-1', 'm3', 'm4', 'm5'])
    })

    it('should keep tool-call parts of context messages after compaction', () => {
      const messages: Message[] = [
        createMessage('m1', 'user', 'Old search'),
        {
          id: 'm2',
          role: MessageRoleEnum.Assistant,
          contentParts: [
            { type: 'text', text: 'Old result' },
            { type: 'tool-call', state: 'result', toolCallId: 'tc1', toolName: 'search', args: {} },
          ],
        },
        createMessage('m3', 'user', 'New search'),
        {
          id: 'm4',
          role: MessageRoleEnum.Assistant,
          contentParts: [
            { type: 'text', text: 'New result' },
            { type: 'tool-call', state: 'result', toolCallId: 'tc2', toolName: 'search', args: {} },
          ],
        },
        createMessage('m5', 'user', 'Another'),
        createMessage('m6', 'assistant', 'Response'),
      ]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm2', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      const m4Result = result.find((m) => m.id === 'm4')
      expect(m4Result?.contentParts).toHaveLength(2)
      expect(m4Result?.contentParts.map((part) => part.type)).toEqual(['text', 'tool-call'])
    })
  })

  describe('edge cases', () => {
    it('should handle single message', () => {
      const messages = [createMessage('m1', 'user', 'Hello')]

      const result = buildContextForAI({ messages })

      expect(result).toHaveLength(1)
    })

    it('should preserve system prompt after compaction', () => {
      const systemMessage = createMessage('sys', 'system', 'You are a helpful assistant')
      const messages = [
        systemMessage,
        createMessage('m1', 'user', 'Old message'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New message'),
        createMessage('m4', 'assistant', 'Response'),
      ]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm2', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result[0].id).toBe('sys')
      expect(result[0].role).toBe('system')
      expect(result[1].id).toBe('summary-1')
      expect(result.map((m) => m.id)).toEqual(['sys', 'summary-1', 'm3', 'm4'])
    })

    it('should not duplicate system prompt if already after boundary', () => {
      const systemMessage = createMessage('sys', 'system', 'You are a helpful assistant')
      const messages = [
        createMessage('m1', 'user', 'Old message'),
        createMessage('m2', 'assistant', 'Boundary'),
        systemMessage,
        createMessage('m3', 'user', 'New message'),
        createMessage('m4', 'assistant', 'Response'),
      ]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm2', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      const systemCount = result.filter((m) => m.role === 'system').length
      expect(systemCount).toBe(1)
    })

    it('should handle compaction point where boundary is first message', () => {
      const messages = [
        createMessage('m1', 'assistant', 'Boundary - first message'),
        createMessage('m2', 'user', 'After boundary'),
        createMessage('m3', 'assistant', 'Response'),
      ]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'm1', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result.map((m) => m.id)).toEqual(['summary-1', 'm2', 'm3'])
    })

    it('should preserve message properties through processing', () => {
      const messages: Message[] = [
        {
          id: 'm1',
          role: MessageRoleEnum.User,
          contentParts: [{ type: 'text', text: 'Hello' }],
          model: 'gpt-4',
          timestamp: 1234567890,
        },
        {
          id: 'm2',
          role: MessageRoleEnum.Assistant,
          contentParts: [{ type: 'text', text: 'Hi' }],
          model: 'gpt-4',
          timestamp: 1234567891,
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      ]

      const result = buildContextForAI({ messages })

      expect(result[0].model).toBe('gpt-4')
      expect(result[0].timestamp).toBe(1234567890)
      expect(result[1].usage).toEqual({ inputTokens: 100, outputTokens: 50 })
    })
  })
})

describe('context identities from selected message inputs', () => {
  it('retains selected message identities in order', () => {
    const messages = [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Hi')]
    expect(buildContextForAI({ messages }).map((message) => message.id)).toEqual(['m1', 'm2'])
  })

  it('keeps the system prompt and current summary with the post-boundary tail', () => {
    const messages = [
      createMessage('system', 'system', 'Instruction'),
      createMessage('old-user', 'user', 'Old'),
      createMessage('boundary', 'assistant', 'Old answer'),
      createMessage('new-user', 'user', 'New'),
      createMessage('new-answer', 'assistant', 'New answer'),
      createSummaryMessage('summary'),
    ]
    const result = buildContextForAI({ messages, compactionPoints: [createCompactionPoint('summary', 'boundary', 1)] })
    expect(result.map((message) => message.id)).toEqual(['system', 'summary', 'new-user', 'new-answer'])
  })

  it('excludes an incomplete reply from selected identities', () => {
    const messages = [
      createMessage('question', 'user', 'Hello'),
      { ...createMessage('reply', 'assistant', 'Partial'), generating: true },
    ]
    expect(buildContextForAI({ messages }).map((message) => message.id)).toEqual(['question'])
  })

  it('preserves full tool parts in the selected context', () => {
    const tool = {
      type: 'tool-call' as const,
      state: 'result' as const,
      toolCallId: 'tc',
      toolName: 'tool',
      args: {},
      result: { answer: 42 },
    }
    const messages = [
      createMessage('question', 'user', 'Hello'),
      { ...createMessage('reply', 'assistant'), contentParts: [tool] },
    ]
    expect(buildContextForAI({ messages })[1].contentParts).toEqual([tool])
  })
})

import type { CompactionPoint, Message, Session, SessionSettings, SessionThread } from '@shared/types'
import { MessageRoleEnum } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import {
  buildContextForAI,
  buildContextForSession,
  buildContextForThread,
  getContextMessageIds,
} from './context-builder'

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

describe('buildContextForSession', () => {
  it('should build context from session main messages', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Hi')],
    }

    const result = buildContextForSession(session)

    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('should use session compaction points', () => {
    const summary = createSummaryMessage('summary-1')
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Old'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New'),
        createMessage('m4', 'assistant', 'Response'),
        summary,
      ],
      compactionPoints: [createCompactionPoint('summary-1', 'm2', Date.now())],
    }

    const result = buildContextForSession(session)

    expect(result.map((m) => m.id)).toEqual(['summary-1', 'm3', 'm4'])
  })

  it('should build context from thread when threadId provided', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread 1',
      messages: [createMessage('t1', 'user', 'Thread message'), createMessage('t2', 'assistant', 'Thread response')],
      createdAt: Date.now(),
    }
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [createMessage('m1', 'user', 'Main message')],
      threads: [thread],
    }

    const result = buildContextForSession(session, { threadId: 'thread-1' })

    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id)).toEqual(['t1', 't2'])
  })

  it('should use session compaction points for thread', () => {
    const summary = createSummaryMessage('thread-summary')
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread 1',
      messages: [
        createMessage('t1', 'user', 'Old'),
        createMessage('t2', 'assistant', 'Boundary'),
        createMessage('t3', 'user', 'New'),
        createMessage('t4', 'assistant', 'Response'),
        summary,
      ],
      createdAt: Date.now(),
      compactionPoints: [createCompactionPoint('thread-summary', 't2', Date.now())],
    }
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [],
      threads: [thread],
    }

    const result = buildContextForSession(session, { threadId: 'thread-1' })

    expect(result.map((m) => m.id)).toEqual(['thread-summary', 't3', 't4'])
  })

  it('should fall back to main messages when thread not found', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [createMessage('m1', 'user', 'Main')],
      threads: [],
    }

    const result = buildContextForSession(session, { threadId: 'non-existent' })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('m1')
  })

  it('should keep tool-call parts untouched', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Q1'),
        {
          id: 'm2',
          role: MessageRoleEnum.Assistant,
          contentParts: [{ type: 'tool-call', state: 'result', toolCallId: 'tc1', toolName: 'tool', args: {} }],
        },
        createMessage('m3', 'user', 'Q2'),
        createMessage('m4', 'assistant', 'Response'),
      ],
    }

    const result = buildContextForSession(session)

    expect(result[1].contentParts).toHaveLength(1)
    expect(result[1].contentParts[0].type).toBe('tool-call')
  })
})

describe('buildContextForThread', () => {
  it('should build context from thread messages', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread 1',
      messages: [createMessage('t1', 'user', 'Hello'), createMessage('t2', 'assistant', 'Hi')],
      createdAt: Date.now(),
    }

    const result = buildContextForThread(thread)

    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id)).toEqual(['t1', 't2'])
  })

  it('should use thread compaction points', () => {
    const summary = createSummaryMessage('thread-summary')
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread 1',
      messages: [
        createMessage('t1', 'user', 'Old'),
        createMessage('t2', 'assistant', 'Boundary'),
        createMessage('t3', 'user', 'New'),
        summary,
      ],
      createdAt: Date.now(),
      compactionPoints: [createCompactionPoint('thread-summary', 't2', Date.now())],
    }

    const result = buildContextForThread(thread)

    expect(result.map((m) => m.id)).toEqual(['thread-summary', 't3'])
  })

  it('should handle empty thread', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Empty Thread',
      messages: [],
      createdAt: Date.now(),
    }

    const result = buildContextForThread(thread)

    expect(result).toEqual([])
  })

  it('should keep tool-call parts untouched', () => {
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread',
      messages: [
        createMessage('t1', 'user', 'Q'),
        {
          id: 't2',
          role: MessageRoleEnum.Assistant,
          contentParts: [{ type: 'tool-call', state: 'result', toolCallId: 'tc1', toolName: 'tool', args: {} }],
        },
        createMessage('t3', 'user', 'Q2'),
        createMessage('t4', 'assistant', 'A2'),
      ],
      createdAt: Date.now(),
    }
    const sessionSettings: SessionSettings = { autoCompaction: false }

    const result = buildContextForThread(thread, { sessionSettings })

    expect(result[1].contentParts).toHaveLength(1)
    expect(result[1].contentParts[0].type).toBe('tool-call')
  })
})

describe('getContextMessageIds', () => {
  it('should return all message IDs when no compaction points exist', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Hello'),
        createMessage('m2', 'assistant', 'Hi'),
        createMessage('m3', 'user', 'How are you?'),
        createMessage('m4', 'assistant', 'I am fine'),
      ],
    }

    const result = getContextMessageIds(session)

    expect(result).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('should return only context message IDs after compaction', () => {
    const summary = createSummaryMessage('summary-1')
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Old'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New'),
        createMessage('m4', 'assistant', 'Response'),
        summary,
      ],
      compactionPoints: [createCompactionPoint('summary-1', 'm2', Date.now())],
    }

    const result = getContextMessageIds(session)

    expect(result).toEqual(['summary-1', 'm3', 'm4'])
  })

  it('should respect maxCount parameter', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Hello'),
        createMessage('m2', 'assistant', 'Hi'),
        createMessage('m3', 'user', 'How are you?'),
        createMessage('m4', 'assistant', 'I am fine'),
      ],
    }

    const result = getContextMessageIds(session, 2)

    expect(result).toEqual(['m3', 'm4'])
  })

  it('should apply maxCount after compaction filtering', () => {
    const summary = createSummaryMessage('summary-1')
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Old 1'),
        createMessage('m2', 'assistant', 'Old 2'),
        createMessage('m3', 'user', 'Boundary'),
        createMessage('m4', 'assistant', 'New 1'),
        createMessage('m5', 'user', 'New 2'),
        createMessage('m6', 'assistant', 'New 3'),
        summary,
      ],
      compactionPoints: [createCompactionPoint('summary-1', 'm3', Date.now())],
    }

    // Context after compaction: [summary-1, m4, m5, m6]
    // With maxCount=2: [m5, m6]
    const result = getContextMessageIds(session, 2)

    expect(result).toEqual(['m5', 'm6'])
  })

  it('should exclude generating messages', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        createMessage('m1', 'user', 'Hello'),
        createMessage('m2', 'assistant', 'Hi'),
        { ...createMessage('m3', 'assistant', 'Generating...'), generating: true },
      ],
    }

    const result = getContextMessageIds(session)

    expect(result).toEqual(['m1', 'm2'])
  })

  it('should include system message preserved after compaction', () => {
    const systemMessage = createMessage('sys', 'system', 'You are a helpful assistant')
    const summary = createSummaryMessage('summary-1')
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [
        systemMessage,
        createMessage('m1', 'user', 'Old message'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New message'),
        createMessage('m4', 'assistant', 'Response'),
        summary,
      ],
      compactionPoints: [createCompactionPoint('summary-1', 'm2', Date.now())],
    }

    const result = getContextMessageIds(session)

    expect(result).toEqual(['sys', 'summary-1', 'm3', 'm4'])
  })

  it('should return empty array for session with no messages', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [],
    }

    const result = getContextMessageIds(session)

    expect(result).toEqual([])
  })

  it('should handle maxCount of 0', () => {
    const session: Session = {
      id: 'session-1',
      name: 'Test Session',
      messages: [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Hi')],
    }

    const result = getContextMessageIds(session, 0)

    expect(result).toEqual([])
  })
})

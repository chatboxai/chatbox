import type { CompactionPoint, Message, Session, SessionSettings, SessionThread } from '@shared/types'
import { MessageRoleEnum } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX, getChatBridgeAppContextMessageId } from '@/packages/chatbridge/context'
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

function createAppMessage(
  id: string,
  lifecycle: 'active' | 'complete' | 'stale' | 'error',
  options?: {
    appId?: string
    appName?: string
    appInstanceId?: string
    summary?: string
    summaryForModel?: string
    includeCompletionPayload?: boolean
  }
): Message {
  const appId = options?.appId ?? 'story-builder'
  const appName = options?.appName ?? 'Story Builder'
  const appInstanceId = options?.appInstanceId ?? `${appId}-instance-1`

  return {
    id,
    role: MessageRoleEnum.Assistant,
    contentParts: [
      {
        type: 'app',
        appId,
        appName,
        appInstanceId,
        lifecycle,
        summary: options?.summary ?? `${appName} lifecycle: ${lifecycle}`,
        ...(options?.summaryForModel ? { summaryForModel: options.summaryForModel } : {}),
        ...(options?.includeCompletionPayload
          ? {
              values: {
                chatbridgeCompletion: {
                  schemaVersion: 1,
                  status: 'success',
                  suggestedSummary: {
                    text: options.summaryForModel ?? `${appName} completed successfully.`,
                  },
                },
              },
            }
          : {}),
      },
    ],
  }
}

describe('buildContextForAI', () => {
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

    it('should return all messages when compactionPoints is empty array', () => {
      const messages = [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Hi')]

      const result = buildContextForAI({ messages, compactionPoints: [] })

      expect(result).toHaveLength(2)
    })

    it('should apply tool call cleanup on all messages', () => {
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

      const result = buildContextForAI({ messages, keepToolCallRounds: 1 })

      expect(result[1].contentParts).toHaveLength(1)
      expect(result[1].contentParts[0].type).toBe('text')
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

    it('should fall back to all messages when boundary not found', () => {
      const messages = [createMessage('m1', 'user', 'Hello'), createMessage('m2', 'assistant', 'Response')]
      const summary = createSummaryMessage('summary-1')
      const allMessages = [...messages, summary]
      const compactionPoints = [createCompactionPoint('summary-1', 'non-existent', Date.now())]

      const result = buildContextForAI({ messages: allMessages, compactionPoints })

      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual(['m1', 'm2', 'summary-1'])
    })

    it('should work when summary message is not found', () => {
      const messages = [
        createMessage('m1', 'user', 'Old'),
        createMessage('m2', 'assistant', 'Boundary'),
        createMessage('m3', 'user', 'New'),
        createMessage('m4', 'assistant', 'Response'),
      ]
      const compactionPoints = [createCompactionPoint('non-existent-summary', 'm2', Date.now())]

      const result = buildContextForAI({ messages, compactionPoints })

      expect(result.map((m) => m.id)).toEqual(['m3', 'm4'])
    })

    it('should apply tool call cleanup to context messages', () => {
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

      const result = buildContextForAI({ messages: allMessages, compactionPoints, keepToolCallRounds: 1 })

      const m4Result = result.find((m) => m.id === 'm4')
      expect(m4Result?.contentParts).toHaveLength(1)
      expect(m4Result?.contentParts[0].type).toBe('text')
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

    it('injects host-approved app context when the relevant app summary falls before the compaction boundary', () => {
      const appMessage = createAppMessage('app-msg', 'complete', {
        summary: 'Raw partner completion text.',
        summaryForModel: 'Host-approved summary for the saved Story Builder draft.',
      })
      const boundary = createMessage('m-boundary', 'assistant', 'Boundary')
      const followUp = createMessage('m-followup', 'user', 'What did Story Builder save?')
      const summary = createSummaryMessage('summary-1', 'Conversation summary')

      const result = buildContextForAI({
        messages: [appMessage, boundary, followUp, summary],
        compactionPoints: [createCompactionPoint('summary-1', 'm-boundary', Date.now())],
      })

      expect(result[0].id).toBe(
        getChatBridgeAppContextMessageId({
          messageId: 'app-msg',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-builder-instance-1',
          lifecycle: 'complete',
          summaryForModel: 'Host-approved summary for the saved Story Builder draft.',
        })
      )
      expect(result[0].role).toBe('system')
      expect(result[0].contentParts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Host-approved summary for the saved Story Builder draft.'),
      })
      expect(result.map((message) => message.id)).toEqual([
        getChatBridgeAppContextMessageId({
          messageId: 'app-msg',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-builder-instance-1',
          lifecycle: 'complete',
          summaryForModel: 'Host-approved summary for the saved Story Builder draft.',
        }),
        'summary-1',
        'm-followup',
      ])
    })

    it('derives injected app context from structured Debate Arena state after compaction', () => {
      const debateMessage: Message = {
        id: 'debate-msg',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          {
            type: 'app',
            appId: 'debate-arena',
            appName: 'Debate Arena',
            appInstanceId: 'debate-instance-1',
            lifecycle: 'complete',
            summary: 'Raw partner completion text.',
            values: {
              chatbridgeDebateArena: {
                schemaVersion: 1,
                phase: 'complete',
                motion: 'Uniforms improve classroom focus.',
                teams: [
                  {
                    id: 'team-affirmative',
                    name: 'Team Cedar',
                    stance: 'affirmative',
                  },
                  {
                    id: 'team-negative',
                    name: 'Team River',
                    stance: 'negative',
                  },
                ],
                result: {
                  winnerTeamId: 'team-affirmative',
                  decision: 'The affirmative team grounded each claim in classroom evidence.',
                },
              },
            },
          },
        ],
      }
      const boundary = createMessage('m-boundary', 'assistant', 'Boundary')
      const followUp = createMessage('m-followup', 'user', 'What won the debate?')
      const summary = createSummaryMessage('summary-1', 'Conversation summary')

      const result = buildContextForAI({
        messages: [debateMessage, boundary, followUp, summary],
        compactionPoints: [createCompactionPoint('summary-1', 'm-boundary', Date.now())],
      })

      expect(result[0].id).toBe(
        getChatBridgeAppContextMessageId({
          messageId: 'debate-msg',
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-instance-1',
          lifecycle: 'complete',
          summaryForModel:
            'Debate Arena completed the debate on "Uniforms improve classroom focus." and selected Team Cedar (Affirmative) as the winner. Decision: The affirmative team grounded each claim in classroom evidence.',
        })
      )
      expect(result[0].contentParts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('selected Team Cedar (Affirmative) as the winner'),
      })
    })

    it('injects an active app context first and keeps one recent completed app context alongside it', () => {
      const result = buildContextForAI({
        messages: [
          createAppMessage('story-complete', 'complete', {
            appInstanceId: 'story-complete-instance',
            summaryForModel: 'Story Builder saved the latest draft outline.',
          }),
          createAppMessage('debate-complete', 'complete', {
            appId: 'debate-arena',
            appName: 'Debate Arena',
            appInstanceId: 'debate-complete-instance',
            summaryForModel: 'Debate Arena preserved the completed debate outcome.',
          }),
          createAppMessage('story-active', 'active', {
            appInstanceId: 'story-active-instance',
            summaryForModel: 'Story Builder still has the active draft open.',
          }),
          createMessage('m-boundary', 'assistant', 'Boundary'),
          createMessage('m-followup', 'user', 'Which app should the assistant prioritize?'),
          createSummaryMessage('summary-1', 'Conversation summary'),
        ],
        compactionPoints: [createCompactionPoint('summary-1', 'm-boundary', Date.now())],
      })

      expect(result[0].id).toBe(
        getChatBridgeAppContextMessageId({
          messageId: 'story-active',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-active-instance',
          lifecycle: 'active',
          summaryForModel: 'Story Builder still has the active draft open.',
        })
      )
      expect(result[1].id).toBe(
        getChatBridgeAppContextMessageId({
          messageId: 'debate-complete',
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-complete-instance',
          lifecycle: 'complete',
          summaryForModel: 'Debate Arena preserved the completed debate outcome.',
        })
      )
      expect(result[0].contentParts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Priority: Primary active app context'),
      })
      expect(result[1].contentParts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Priority: Recent completed app context'),
      })
    })

    it('does not inject a synthetic app-context message when the selected app message is already in context', () => {
      const appMessage = createAppMessage('app-active', 'active', {
        summary: 'Raw app summary',
        summaryForModel: 'Host-approved active app context.',
      })
      const followUp = createMessage('m-followup', 'user', 'Keep going with the draft.')

      const result = buildContextForAI({
        messages: [appMessage, followUp],
      })

      expect(result.some((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))).toBe(false)

      const appPart = result[0].contentParts.find((part) => part.type === 'app')
      expect(appPart).toMatchObject({
        type: 'app',
        summaryForModel: 'Host-approved active app context.',
      })
    })

    it('removes superseded host-approved app memory when a newer stale state exists', () => {
      const activeMessage = createAppMessage('app-active', 'active', {
        summaryForModel: 'Host-approved active summary that should become stale.',
        includeCompletionPayload: true,
      })
      const staleMessage = createAppMessage('app-stale', 'stale', {
        appInstanceId: 'story-builder-instance-1',
        summary: 'Cached app state expired before a fresh checkpoint arrived.',
      })
      const followUp = createMessage('m-followup', 'user', 'Can I still trust the old app state?')

      const result = buildContextForAI({
        messages: [activeMessage, staleMessage, followUp],
      })

      expect(result.some((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))).toBe(false)

      const appPart = result[0].contentParts.find((part) => part.type === 'app')
      expect(appPart).toMatchObject({
        type: 'app',
        lifecycle: 'active',
      })
      expect(appPart && 'summaryForModel' in appPart ? appPart.summaryForModel : undefined).toBeUndefined()
      expect(appPart && appPart.type === 'app' ? appPart.values?.chatbridgeCompletion : undefined).toBeUndefined()
    })

    it('removes superseded structured app memory when a newer stale state exists', () => {
      const activeMessage: Message = {
        id: 'debate-active',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          {
            type: 'app',
            appId: 'debate-arena',
            appName: 'Debate Arena',
            appInstanceId: 'debate-instance-1',
            lifecycle: 'active',
            values: {
              chatbridgeDebateArena: {
                schemaVersion: 1,
                phase: 'opening',
                motion: 'Uniforms improve classroom focus.',
                teams: [
                  {
                    id: 'team-affirmative',
                    name: 'Team Cedar',
                    stance: 'affirmative',
                  },
                  {
                    id: 'team-negative',
                    name: 'Team River',
                    stance: 'negative',
                  },
                ],
                currentSpeaker: {
                  name: 'Maya',
                  teamId: 'team-affirmative',
                },
              },
            },
          },
        ],
      }
      const staleMessage = createAppMessage('debate-stale', 'stale', {
        appId: 'debate-arena',
        appName: 'Debate Arena',
        appInstanceId: 'debate-instance-1',
        summary: 'Cached Debate Arena state expired before a fresh checkpoint arrived.',
      })
      const followUp = createMessage('m-followup', 'user', 'Can I still trust the old debate state?')

      const result = buildContextForAI({
        messages: [activeMessage, staleMessage, followUp],
      })

      expect(result.some((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))).toBe(false)

      const appPart = result[0].contentParts.find((part) => part.type === 'app')
      expect(appPart && appPart.type === 'app' ? appPart.values?.chatbridgeDebateArena : undefined).toBeUndefined()
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

  it('should respect keepToolCallRounds option', () => {
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

    const result = buildContextForSession(session, { keepToolCallRounds: 0 })

    expect(result[1].contentParts).toHaveLength(0)
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

  it('should respect options', () => {
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

    const result = buildContextForThread(thread, { keepToolCallRounds: 1, sessionSettings })

    expect(result[1].contentParts).toHaveLength(0)
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

    // maxCount of 0 should return all (treated as no limit)
    const result = getContextMessageIds(session, 0)

    expect(result).toEqual(['m1', 'm2'])
  })
})

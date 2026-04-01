import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeChatBridgeCompletionSummaryForModel } from '@shared/chatbridge/summary'
import { convertToModelMessages } from './message-utils'

vi.mock('@/adapters', () => ({
  createModelDependencies: vi.fn(async () => ({
    storage: {
      getImage: vi.fn(),
    },
  })),
}))

describe('convertToModelMessages chatbridge normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses host-owned summaryForModel for assistant app parts', async () => {
    const { summaryForModel } = normalizeChatBridgeCompletionSummaryForModel({
      appId: 'story-builder',
      appName: 'Story Builder',
      payload: {
        schemaVersion: 1,
        status: 'success',
        suggestedSummary: {
          text: 'Saved the latest Story Builder draft for later writing.',
        },
        outcomeData: {
          chapterCount: 2,
        },
      },
    })

    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        contentParts: [
          {
            type: 'app',
            appId: 'story-builder',
            appName: 'Story Builder',
            appInstanceId: 'instance-1',
            lifecycle: 'complete',
            summary: 'Raw partner summary that should not become model memory.',
            summaryForModel,
          },
        ],
      },
    ]

    const result = await convertToModelMessages(messages)

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: summaryForModel }],
      },
    ])
  })

  it('derives host-owned model memory from stored completion payloads when summaryForModel is absent', async () => {
    const completionPayload = {
      schemaVersion: 1 as const,
      status: 'success' as const,
      suggestedSummary: {
        text: 'Debate Arena completed the rubric pass and stored the winner.',
      },
      outcomeData: {
        winner: 'Team A',
        accessToken: 'secret-token',
      },
    }

    const messages: Message[] = [
      {
        id: 'msg-1b',
        role: 'assistant',
        contentParts: [
          {
            type: 'app',
            appId: 'debate-arena',
            appName: 'Debate Arena',
            appInstanceId: 'instance-1b',
            lifecycle: 'complete',
            summary: 'Raw partner completion text.',
            values: {
              chatbridgeCompletion: completionPayload,
            },
          },
        ],
      },
    ]

    const result = await convertToModelMessages(messages)

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Debate Arena completed the rubric pass and stored the winner. Approved details: winner: Team A.',
          },
        ],
      },
    ])
  })

  it('derives host-owned model memory from structured Debate Arena state when no completion payload exists yet', async () => {
    const messages: Message[] = [
      {
        id: 'msg-debate-active',
        role: 'assistant',
        contentParts: [
          {
            type: 'app',
            appId: 'debate-arena',
            appName: 'Debate Arena',
            appInstanceId: 'debate-instance-active',
            lifecycle: 'active',
            values: {
              chatbridgeDebateArena: {
                schemaVersion: 1,
                phase: 'opening',
                motion: 'Schools should allow structured AI writing support in class.',
                teams: [
                  {
                    id: 'team-affirmative',
                    name: 'Team Redwood',
                    stance: 'affirmative',
                  },
                  {
                    id: 'team-negative',
                    name: 'Team Blue',
                    stance: 'negative',
                  },
                ],
                rubricFocus: ['evidence quality', 'counterargument clarity'],
                currentSpeaker: {
                  name: 'Maya',
                  teamId: 'team-affirmative',
                  roleLabel: 'evidence reply',
                },
              },
            },
          },
        ],
      },
    ]

    const result = await convertToModelMessages(messages)

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: expect.stringContaining('Debate Arena is running the opening round'),
          },
        ],
      },
    ])
  })

  it('does not expose raw app summaries when host normalization has not approved them', async () => {
    const messages: Message[] = [
      {
        id: 'msg-2',
        role: 'assistant',
        contentParts: [
          {
            type: 'app',
            appId: 'story-builder',
            appName: 'Story Builder',
            appInstanceId: 'instance-2',
            lifecycle: 'complete',
            summary: 'Raw partner summary that should stay out of model context.',
          },
        ],
      },
    ]

    const result = await convertToModelMessages(messages)

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [],
      },
    ])
  })
})

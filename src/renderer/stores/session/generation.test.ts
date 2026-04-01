import '../../../../test/integration/chatbridge/setup'
import { describe, expect, it } from 'vitest'
import type { Message, SessionSettings } from '@shared/types'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX, getChatBridgeAppContextMessageId } from '@/packages/chatbridge/context'
import { genMessageContext } from './generation'

function createTextMessage(id: string, role: Message['role'], text: string): Message {
  return {
    id,
    role,
    contentParts: [{ type: 'text', text }],
  }
}

function createAppMessage(id: string, lifecycle: 'active' | 'complete' | 'stale', summaryForModel?: string): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [
      {
        type: 'app',
        appId: 'story-builder',
        appName: 'Story Builder',
        appInstanceId: `story-builder-${id}`,
        lifecycle,
        summary: `Raw ${lifecycle} summary`,
        ...(summaryForModel ? { summaryForModel } : {}),
      },
    ],
  }
}

const settings = {
  maxContextMessageCount: 20,
  provider: 'openai',
} as SessionSettings

describe('genMessageContext chatbridge continuity', () => {
  it('injects host-approved app context into prompt assembly after compaction removes the source app message', async () => {
    const appMessage = createAppMessage('app-msg', 'complete', 'Host-approved app continuity summary.')
    const boundary = createTextMessage('m-boundary', 'assistant', 'Boundary')
    const followUp = createTextMessage('m-followup', 'user', 'What happened in the app?')
    const summaryMessage: Message = {
      id: 'summary-1',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'Conversation summary' }],
      isSummary: true,
    }

    const result = await genMessageContext(settings, [appMessage, boundary, followUp, summaryMessage], false, {
      compactionPoints: [
        {
          summaryMessageId: 'summary-1',
          boundaryMessageId: 'm-boundary',
          createdAt: Date.now(),
        },
      ],
    })

    expect(result.map((message) => message.id)).toEqual([
      getChatBridgeAppContextMessageId({
        messageId: 'app-msg',
        appId: 'story-builder',
        appName: 'Story Builder',
        appInstanceId: 'story-builder-app-msg',
        lifecycle: 'complete',
        summaryForModel: 'Host-approved app continuity summary.',
      }),
      'summary-1',
      'm-followup',
    ])
  })

  it('keeps a primary active app context ahead of one recent completed app context after compaction', async () => {
    const activeMessage = createAppMessage('story-active', 'active', 'Host-approved Story Builder active context.')
    const completeMessage: Message = {
      id: 'debate-complete',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-arena-debate-complete',
          lifecycle: 'complete',
          summary: 'Raw completed debate summary',
          summaryForModel: 'Host-approved Debate Arena recent context.',
        },
      ],
    }
    const boundary = createTextMessage('m-boundary', 'assistant', 'Boundary')
    const followUp = createTextMessage('m-followup', 'user', 'Which app is still active?')
    const summaryMessage: Message = {
      id: 'summary-1',
      role: 'assistant',
      contentParts: [{ type: 'text', text: 'Conversation summary' }],
      isSummary: true,
    }

    const result = await genMessageContext(settings, [completeMessage, activeMessage, boundary, followUp, summaryMessage], false, {
      compactionPoints: [
        {
          summaryMessageId: 'summary-1',
          boundaryMessageId: 'm-boundary',
          createdAt: Date.now(),
        },
      ],
    })

    expect(result[0].id).toBe(
      getChatBridgeAppContextMessageId({
        messageId: 'story-active',
        appId: 'story-builder',
        appName: 'Story Builder',
        appInstanceId: 'story-builder-story-active',
        lifecycle: 'active',
        summaryForModel: 'Host-approved Story Builder active context.',
      })
    )
    expect(result[1].id).toBe(
      getChatBridgeAppContextMessageId({
        messageId: 'debate-complete',
        appId: 'debate-arena',
        appName: 'Debate Arena',
        appInstanceId: 'debate-arena-debate-complete',
        lifecycle: 'complete',
        summaryForModel: 'Host-approved Debate Arena recent context.',
      })
    )
  })

  it('fails closed on stale app state during prompt assembly', async () => {
    const activeMessage: Message = {
      id: 'app-active',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-builder-instance-1',
          lifecycle: 'active',
          summary: 'Raw active summary',
          summaryForModel: 'Host-approved active summary.',
        },
      ],
    }
    const staleMessage: Message = {
      id: 'app-stale',
      role: 'assistant',
      contentParts: [
        {
          type: 'app',
          appId: 'story-builder',
          appName: 'Story Builder',
          appInstanceId: 'story-builder-instance-1',
          lifecycle: 'stale',
          summary: 'Cached app state expired before a fresh checkpoint arrived.',
        },
      ],
    }
    const followUp = createTextMessage('m-followup', 'user', 'Can I rely on the old state?')

    const result = await genMessageContext(settings, [activeMessage, staleMessage, followUp], false)

    const activeAppPart = result[0].contentParts.find((part) => part.type === 'app')
    expect(result.some((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))).toBe(false)
    expect(activeAppPart && activeAppPart.type === 'app' ? activeAppPart.summaryForModel : undefined).toBeUndefined()
  })
})

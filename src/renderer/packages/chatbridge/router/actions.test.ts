import '../../../../../test/integration/chatbridge/setup'

import { describe, expect, it } from 'vitest'
import { createChatBridgeRouteMessagePart } from '@shared/chatbridge'
import type { MessageContentParts } from '@shared/types'
import { applyChatBridgeRouteArtifactAction } from './actions'

function createClarifyRoutePart() {
  return createChatBridgeRouteMessagePart({
    schemaVersion: 2,
    hostRuntime: 'desktop-electron',
    kind: 'clarify',
    reasonCode: 'ambiguous-match',
    prompt: 'Help me sketch a weather-themed poster.',
    summary: 'This request could fit Drawing Kit or Weather Dashboard, so the host is asking before launching anything.',
    selectedAppId: 'drawing-kit',
    matches: [
      {
        appId: 'drawing-kit',
        appName: 'Drawing Kit',
        matchedContexts: [],
        matchedTerms: ['sketch', 'poster'],
        score: 7,
        exactAppMatch: false,
        exactToolMatch: false,
      },
      {
        appId: 'weather-dashboard',
        appName: 'Weather Dashboard',
        matchedContexts: [],
        matchedTerms: ['weather'],
        score: 4,
        exactAppMatch: false,
        exactToolMatch: false,
      },
    ],
  })
}

describe('applyChatBridgeRouteArtifactAction', () => {
  it('records a host-owned chat-only acknowledgement without launching an app', async () => {
    const part = createClarifyRoutePart()

    const result = await applyChatBridgeRouteArtifactAction({
      contentParts: [part],
      part,
      action: {
        kind: 'chat-only',
      },
    })

    expect(result.outcome).toBe('chat-only')
    expect(result.nextContentParts).toMatchObject([
      {
        type: 'app',
        title: 'Continue in chat',
        statusText: 'Chat only',
        values: {
          chatbridgeRouteArtifactState: {
            status: 'chat-only',
          },
        },
      },
    ])
  })

  it('turns a clarify choice into a reviewed launch path while preserving the route receipt', async () => {
    const part = createClarifyRoutePart()

    const result = await applyChatBridgeRouteArtifactAction({
      contentParts: [part],
      part,
      action: {
        kind: 'launch-app',
        appId: 'drawing-kit',
      },
      createToolCallId: () => 'tool-route-choice-drawing',
    })

    expect(result.outcome).toBe('launch-requested')
    expect(result.selectedAppId).toBe('drawing-kit')
    expect(result.nextContentParts[0]).toMatchObject({
      type: 'app',
      title: 'Opening Drawing Kit',
      statusText: 'Opening',
      values: {
        chatbridgeRouteArtifactState: {
          status: 'launch-requested',
          selectedAppId: 'drawing-kit',
        },
      },
    })
    expect(result.nextContentParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-call',
          toolCallId: 'tool-route-choice-drawing',
          toolName: 'drawing_kit_open',
        }),
        expect.objectContaining({
          type: 'app',
          appId: 'drawing-kit',
          appName: 'Drawing Kit',
          lifecycle: 'launching',
        }),
      ])
    )
  })

  it('rejects stale replay after the route receipt already resolved', async () => {
    const part = createClarifyRoutePart()
    const resolved = await applyChatBridgeRouteArtifactAction({
      contentParts: [part],
      part,
      action: {
        kind: 'chat-only',
      },
    })
    const resolvedPart = resolved.nextContentParts[0]

    if (resolvedPart?.type !== 'app') {
      throw new Error('Expected the resolved route part to remain an app part.')
    }

    const replayed = await applyChatBridgeRouteArtifactAction({
      contentParts: resolved.nextContentParts as MessageContentParts,
      part: resolvedPart,
      action: {
        kind: 'launch-app',
        appId: 'drawing-kit',
      },
    })

    expect(replayed.outcome).toBe('stale')
    expect(replayed.nextContentParts).toEqual(resolved.nextContentParts)
  })
})

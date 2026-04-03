import '../../../../../test/integration/chatbridge/setup'

import type { ToolSet } from 'ai'
import { tool } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Message, MessageInfoPart } from '@shared/types'
import { prepareChatBridgeExecutionGovernor, normalizeChatBridgeExecutionGovernorContentParts } from './execution-governor'

function createTextMessage(id: string, text: string): Message {
  return {
    id,
    role: 'user',
    timestamp: 1,
    contentParts: [{ type: 'text', text }],
  }
}

function createBaseTools(): ToolSet {
  return {
    ping: tool({
      description: 'Ping the host.',
      inputSchema: z.object({}),
      execute: async () => ({
        ok: true,
      }),
    }),
  }
}

describe('ChatBridge renderer execution governor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps tool-use-disabled turns bounded while still returning the wrapped base tool set', () => {
    const traceAdapter = {
      recordEvent: vi.fn(async () => undefined),
    }

    const result = prepareChatBridgeExecutionGovernor({
      messages: [createTextMessage('msg-no-tools', 'hello there')],
      baseTools: createBaseTools(),
      modelSupportsToolUse: false,
      sessionId: 'session-no-tools',
      traceAdapter,
      traceParentRunId: 'renderer-run-no-tools',
      correlationMetadata: {
        session_id: 'session-no-tools',
      },
    })

    expect(Object.keys(result.tools)).toEqual(['ping'])
    expect(result.reviewedRouteArtifact).toBeUndefined()
    expect(result.routeResolution).toBeUndefined()
    expect(traceAdapter.recordEvent).not.toHaveBeenCalled()
  })

  it('prepares an invoke resolution for an explicit Drawing Kit request and emits the stable route-decision trace event', () => {
    const traceAdapter = {
      recordEvent: vi.fn(async () => undefined),
    }

    const result = prepareChatBridgeExecutionGovernor({
      messages: [createTextMessage('msg-drawing', 'Open Drawing Kit and start a sticky-note doodle dare.')],
      baseTools: {},
      modelSupportsToolUse: true,
      sessionId: 'session-drawing',
      traceAdapter,
      traceParentRunId: 'renderer-run-drawing',
      correlationMetadata: {
        session_id: 'session-drawing',
      },
    })

    expect(Object.keys(result.tools)).toEqual(['drawing_kit_open'])
    expect(result.reviewedRouteArtifact).toBeUndefined()
    expect(result.routeResolution).toMatchObject({
      routeDecision: {
        kind: 'invoke',
        selectedAppId: 'drawing-kit',
      },
      selectionSource: 'route-decision',
      toolNames: ['drawing_kit_open'],
      tracePayload: {
        decisionKind: 'invoke',
        selectedAppId: 'drawing-kit',
        selectionSource: 'route-decision',
        toolNames: ['drawing_kit_open'],
        artifactInserted: false,
        artifactKind: null,
      },
    })
    expect(traceAdapter.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbridge.routing.reviewed-app-decision',
        parentRunId: 'renderer-run-drawing',
        outputs: expect.objectContaining({
          decisionKind: 'invoke',
          selectedAppId: 'drawing-kit',
          selectionSource: 'route-decision',
          toolNames: ['drawing_kit_open'],
        }),
      })
    )
  })

  it('prepares a clarify artifact for an ambiguous active-app request without mounting reviewed tools', () => {
    const traceAdapter = {
      recordEvent: vi.fn(async () => undefined),
    }

    const result = prepareChatBridgeExecutionGovernor({
      messages: [createTextMessage('msg-clarify', 'Help me sketch a weather-themed poster.')],
      baseTools: {},
      modelSupportsToolUse: true,
      sessionId: 'session-clarify',
      traceAdapter,
      traceParentRunId: 'renderer-run-clarify',
      correlationMetadata: {
        session_id: 'session-clarify',
      },
    })

    expect(Object.keys(result.tools)).toEqual([])
    expect(result.reviewedRouteArtifact).toMatchObject({
      type: 'app',
      title: 'Choose the next step',
      values: {
        chatbridgeRouteDecision: {
          kind: 'clarify',
        },
      },
    })
    expect(result.routeResolution).toMatchObject({
      routeDecision: {
        kind: 'clarify',
      },
      toolNames: [],
      tracePayload: {
        decisionKind: 'clarify',
        artifactInserted: true,
        artifactKind: 'clarify',
      },
    })
  })

  it('keeps route-decision trace failures non-fatal for the governor preparation step', () => {
    const traceAdapter = {
      recordEvent: vi.fn(async () => {
        throw new Error('LangSmith unavailable')
      }),
    }

    expect(() =>
      prepareChatBridgeExecutionGovernor({
        messages: [createTextMessage('msg-refuse', 'What should I cook for dinner tonight?')],
        baseTools: {},
        modelSupportsToolUse: true,
        sessionId: 'session-refuse',
        traceAdapter,
        traceParentRunId: 'renderer-run-refuse',
        correlationMetadata: {
          session_id: 'session-refuse',
        },
      })
    ).not.toThrow()
  })

  it('normalizes info parts, route artifacts, and content parts through the governor helper', () => {
    const infoPart: MessageInfoPart = {
      type: 'info',
      text: 'OCR completed for the attached image.',
    }
    const { reviewedRouteArtifact } = prepareChatBridgeExecutionGovernor({
      messages: [createTextMessage('msg-route', 'What should I cook for dinner tonight?')],
      baseTools: {},
      modelSupportsToolUse: true,
      sessionId: 'session-route',
      traceAdapter: {
        recordEvent: vi.fn(async () => undefined),
      },
      traceParentRunId: 'renderer-run-route',
      correlationMetadata: {
        session_id: 'session-route',
      },
    })

    const normalized = normalizeChatBridgeExecutionGovernorContentParts([infoPart], [{ type: 'text', text: 'host reply' }], {
      reviewedRouteArtifact,
    })

    expect(normalized).toMatchObject([
      {
        type: 'info',
        text: 'OCR completed for the attached image.',
      },
      {
        type: 'app',
        title: 'Keep this in chat',
      },
      {
        type: 'text',
        text: 'host reply',
      },
    ])
  })
})

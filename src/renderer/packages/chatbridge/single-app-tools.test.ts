import '../../../../test/integration/chatbridge/setup'

import type { ToolExecutionOptions } from 'ai'
import { describe, expect, it } from 'vitest'
import { createMessage } from '@shared/types'
import type { ReviewedAppCatalogEntry } from '@shared/chatbridge'
import { prepareToolsForExecution } from '@/packages/model-calls/stream-text'
import { createReviewedSingleAppToolSet } from './single-app-tools'

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

function createDesktopOnlyStoryBuilderEntry(): ReviewedAppCatalogEntry {
  return {
    manifest: {
      appId: 'story-builder',
      name: 'Story Builder',
      version: '1.2.3',
      protocolVersion: 1,
      origin: 'https://apps.example.com',
      uiEntry: 'https://apps.example.com/story-builder',
      authMode: 'oauth',
      permissions: [
        {
          id: 'drive.read',
          resource: 'drive',
          access: 'read',
          required: true,
          purpose: 'Resume a reviewed draft from Drive.',
        },
      ],
      toolSchemas: [
        {
          name: 'story_builder_resume',
          description: 'Resume the latest reviewed draft.',
          schemaVersion: 1,
          inputSchema: {
            type: 'object',
            properties: {
              request: { type: 'string' },
            },
          },
        },
      ],
      supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete', 'app.requestAuth'],
      completionModes: ['summary', 'handoff'],
      timeouts: {
        launchMs: 15_000,
        idleMs: 120_000,
        completionMs: 10_000,
      },
      safetyMetadata: {
        reviewed: true,
        sandbox: 'hosted-iframe',
        handlesStudentData: true,
        requiresTeacherApproval: false,
      },
      launchSurfaces: {
        'desktop-electron': {
          sandbox: 'hosted-iframe',
        },
      },
      tenantAvailability: {
        default: 'enabled',
        allow: [],
        deny: [],
      },
    },
    approval: {
      status: 'approved',
      reviewedAt: 1_711_930_000_000,
      reviewedBy: 'platform-review',
      catalogVersion: 3,
    },
  }
}

describe('ChatBridge reviewed single-app tools', () => {
  it('creates the approved Chess host tool and executes it through the host contract', async () => {
    const { selection, tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Open Chess and analyze this FEN for me.')],
    })

    expect(selection).toMatchObject({
      status: 'matched',
      appId: 'chess',
      toolName: 'chess_prepare_session',
    })
    expect(Object.keys(tools)).toEqual(['chess_prepare_session'])

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        request: 'Analyze this chess position for me.',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      },
      getExecutionOptions('tool-chess-success')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      appId: 'chess',
      toolName: 'chess_prepare_session',
      executionAuthority: 'host',
      outcome: {
        status: 'success',
        result: {
          appId: 'chess',
          appName: 'Chess',
          capability: 'prepare-session',
          launchReady: true,
        },
      },
    })
  })

  it('creates the approved Drawing Kit host tool and executes it through the host contract', async () => {
    const prompt = 'Open Drawing Kit and start a sticky-note doodle dare.'
    const { selection, tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', prompt)],
    })

    expect(selection).toMatchObject({
      status: 'matched',
      appId: 'drawing-kit',
      toolName: 'drawing_kit_open',
    })
    expect(Object.keys(tools)).toEqual(['drawing_kit_open'])

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-506')
    const result = await preparedTools.drawing_kit_open.execute?.(
      {
        request: prompt,
      },
      getExecutionOptions('tool-drawing-success')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      appId: 'drawing-kit',
      toolName: 'drawing_kit_open',
      executionAuthority: 'host',
      outcome: {
        status: 'success',
        result: {
          appId: 'drawing-kit',
          appName: 'Drawing Kit',
          launchReady: true,
        },
      },
    })
  })

  it('creates the approved Weather Dashboard host tool and preserves the location hint through the host contract', async () => {
    const prompt = 'Open Weather Dashboard for Chicago and show the forecast.'
    const { selection, tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', prompt)],
    })

    expect(selection).toMatchObject({
      status: 'matched',
      appId: 'weather-dashboard',
      toolName: 'weather_dashboard_open',
    })
    expect(Object.keys(tools)).toEqual(['weather_dashboard_open'])

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-510')
    const result = await preparedTools.weather_dashboard_open.execute?.(
      {
        request: prompt,
        location: 'Chicago',
      },
      getExecutionOptions('tool-weather-success')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      appId: 'weather-dashboard',
      toolName: 'weather_dashboard_open',
      executionAuthority: 'host',
      outcome: {
        status: 'success',
        result: {
          appId: 'weather-dashboard',
          appName: 'Weather Dashboard',
          launchReady: true,
          location: 'Chicago',
        },
      },
    })
  })

  it('fails closed when the Chess tool receives malformed args', async () => {
    const { tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Analyze this chess position.')],
    })

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        fen: 42,
      } as never,
      getExecutionOptions('tool-chess-invalid-input')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      outcome: {
        status: 'rejected',
        error: {
          code: 'invalid_input',
        },
      },
    })
  })

  it('normalizes Chess invocation failures into host-visible errors', async () => {
    const { tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Analyze this chess position.')],
      executors: {
        chess_prepare_session: async () => {
          throw new Error('Chess backend unavailable')
        },
      },
    })

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-300')
    const result = await preparedTools.chess_prepare_session.execute?.(
      {
        request: 'Analyze this chess position.',
      },
      getExecutionOptions('tool-chess-failure')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      outcome: {
        status: 'error',
        error: {
          code: 'tool_execution_failed',
          details: {
            message: 'Chess backend unavailable',
          },
        },
      },
    })
  })

  it('normalizes Drawing Kit invocation failures into host-visible errors', async () => {
    const prompt = 'Open Drawing Kit and start a snack-stack doodle dare.'
    const { tools } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', prompt)],
      executors: {
        drawing_kit_open: async () => {
          throw new Error('Drawing Kit bridge unavailable')
        },
      },
    })

    const preparedTools = prepareToolsForExecution(tools, 'session-cb-506-drawing')
    const result = await preparedTools.drawing_kit_open.execute?.(
      {
        request: prompt,
      },
      getExecutionOptions('tool-drawing-failure')
    )

    expect(result).toMatchObject({
      kind: 'chatbridge.host.tool.record.v1',
      outcome: {
        status: 'error',
        error: {
          code: 'tool_execution_failed',
          details: {
            message: 'Drawing Kit bridge unavailable',
          },
        },
      },
    })
  })

  it('keeps desktop-only reviewed apps discoverable in routing while refusing to expose launch tools on web runtime', () => {
    const { selection, tools, routeDecision } = createReviewedSingleAppToolSet({
      messages: [createMessage('user', 'Open Story Builder and continue my outline draft.')],
      entries: [createDesktopOnlyStoryBuilderEntry()],
      contextInput: {
        hostRuntime: 'web-browser',
        teacherApproved: true,
        grantedPermissions: ['drive.read'],
      },
    })

    expect(routeDecision).toMatchObject({
      kind: 'refuse',
      reasonCode: 'runtime-unsupported',
      selectedAppId: 'story-builder',
      hostRuntime: 'web-browser',
    })
    expect(selection.status).toBe('chat-only')
    expect(tools).toEqual({})
  })
})

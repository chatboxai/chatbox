import '../setup'

import { buildContextForAI } from '@/packages/context-management/context-builder'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX } from '@/packages/chatbridge/context'
import {
  createWeatherDashboardDegradedSnapshot,
  createWeatherDashboardReadySnapshot,
} from '@shared/chatbridge'
import { CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION } from '@shared/chatbridge/tools'
import type { CompactionPoint, Message, MessageAppPart, MessageToolCallPart, Session } from '@shared/types'
import { createMessage } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  applyReviewedAppLaunchBootstrapToSession,
  applyReviewedAppLaunchBridgeEventToSession,
  applyReviewedAppLaunchBridgeReadyToSession,
  upsertReviewedAppLaunchParts,
} from '@/packages/chatbridge/reviewed-app-launch'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function createWeatherLaunchToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-weather-scenario-1',
    toolName: 'weather_dashboard_open',
    args: {
      request: 'Open Weather Dashboard for Chicago and show the forecast.',
      location: 'Chicago',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'weather_dashboard_open',
      appId: 'weather-dashboard',
      sessionId: 'session-reviewed-launch-weather-scenario-1',
      schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
      executionAuthority: 'host',
      effect: 'read',
      retryClassification: 'safe',
      invocation: {
        args: {
          request: 'Open Weather Dashboard for Chicago and show the forecast.',
          location: 'Chicago',
        },
      },
      outcome: {
        status: 'success',
        result: {
          appId: 'weather-dashboard',
          appName: 'Weather Dashboard',
          capability: 'open',
          launchReady: true,
          summary: 'Prepared the reviewed Weather Dashboard request for the host-owned launch path.',
          request: 'Open Weather Dashboard for Chicago and show the forecast.',
          location: 'Chicago',
        },
      },
    },
  }
}

function createSessionWithLaunchPart(): { session: Session; launchPart: MessageAppPart } {
  const assistantMessage = createMessage('assistant')
  assistantMessage.id = 'assistant-reviewed-weather-scenario-1'
  assistantMessage.contentParts = upsertReviewedAppLaunchParts([createWeatherLaunchToolCallPart()])

  const launchPart = assistantMessage.contentParts.find((part): part is MessageAppPart => part.type === 'app')
  if (!launchPart) {
    throw new Error('Expected a reviewed Weather launch part.')
  }

  return {
    session: {
      id: 'session-reviewed-launch-weather-scenario-1',
      name: 'Reviewed Weather launch scenario',
      messages: [assistantMessage],
      settings: {},
    },
    launchPart,
  }
}

function getLaunchPart(session: Session): MessageAppPart {
  const message = session.messages.find((candidate) => candidate.id === 'assistant-reviewed-weather-scenario-1')
  const launchPart = message?.contentParts.find((part): part is MessageAppPart => part.type === 'app')

  if (!launchPart) {
    throw new Error('Expected the Weather scenario to keep the launch part.')
  }

  return launchPart
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-weather-dashboard-flagship',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['persistence', 'recovery'],
      storyId: 'CB-510',
    },
    testCase,
    execute
  )
}

describe('ChatBridge Weather Dashboard flagship lifecycle', () => {
  it('injects a host-owned weather summary for follow-up chat after the dashboard loads', () =>
    traceScenario('injects a host-owned weather summary for follow-up chat after the dashboard loads', () => {
      const { session, launchPart } = createSessionWithLaunchPart()

      const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
        messageId: 'assistant-reviewed-weather-scenario-1',
        part: launchPart,
        bridgeSessionId: 'bridge-session-reviewed-weather-scenario-1',
        now: () => 10_000,
        createId: () => 'event-reviewed-weather-created-1',
      })

      const readied = applyReviewedAppLaunchBridgeReadyToSession(bootstrapped, {
        messageId: 'assistant-reviewed-weather-scenario-1',
        part: getLaunchPart(bootstrapped),
        event: {
          kind: 'app.ready',
          bridgeSessionId: 'bridge-session-reviewed-weather-scenario-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-weather-scenario-1',
          ackNonce: 'bridge-nonce-reviewed-weather-scenario-1',
          sequence: 1,
        },
        now: () => 11_000,
        createId: () => 'event-reviewed-weather-ready-1',
      })

      const loadedSnapshot = createWeatherDashboardReadySnapshot({
        request: 'Open Weather Dashboard for Chicago and show the forecast.',
        locationQuery: 'Chicago',
        locationName: 'Chicago, Illinois, United States',
        timezone: 'America/Chicago',
        units: 'imperial',
        updatedAt: 12_000,
        cacheStatus: 'miss',
        current: {
          temperature: 72,
          apparentTemperature: 70,
          weatherCode: 1,
          conditionLabel: 'Mostly clear',
          windSpeed: 9,
        },
        forecast: [
          {
            dateKey: '2026-04-02',
            dayLabel: 'Thu',
            high: 74,
            low: 58,
            weatherCode: 1,
            conditionLabel: 'Mostly clear',
            precipitationChance: 10,
          },
          {
            dateKey: '2026-04-03',
            dayLabel: 'Fri',
            high: 76,
            low: 60,
            weatherCode: 2,
            conditionLabel: 'Partly cloudy',
            precipitationChance: 20,
          },
        ],
      })

      const activated = applyReviewedAppLaunchBridgeEventToSession(readied, {
        messageId: 'assistant-reviewed-weather-scenario-1',
        part: getLaunchPart(readied),
        event: {
          kind: 'app.state',
          bridgeSessionId: 'bridge-session-reviewed-weather-scenario-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-weather-scenario-1',
          sequence: 2,
          idempotencyKey: 'state-reviewed-weather-scenario-2',
          snapshot: loadedSnapshot,
        },
        now: () => 12_000,
        createId: () => 'event-reviewed-weather-state-1',
      })

      const compactedSummary: Message = {
        id: 'summary-reviewed-weather-scenario-1',
        role: 'assistant',
        timestamp: 13_000,
        isSummary: true,
        contentParts: [{ type: 'text', text: 'Compacted summary of earlier Weather Dashboard activity.' }],
      }
      const followUp = createMessage('weather-follow-up-user', 'user', 'Summarize the weather you just showed me.')
      const compactionPoints: CompactionPoint[] = [
        {
          summaryMessageId: compactedSummary.id,
          boundaryMessageId: 'assistant-reviewed-weather-scenario-1',
          createdAt: 13_000,
        },
      ]

      const context = buildContextForAI({
        messages: [...activated.messages, followUp, compactedSummary],
        compactionPoints,
      })

      const injectedContext = context.find((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))
      expect(injectedContext?.contentParts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Chicago, Illinois, United States'),
      })
      expect((injectedContext?.contentParts[0] as { text?: string } | undefined)?.text).toContain('Mostly clear')
      expect(getLaunchPart(activated)).toMatchObject({
        lifecycle: 'active',
        statusText: 'Live weather',
        snapshot: {
          locationName: 'Chicago, Illinois, United States',
          cacheStatus: 'miss',
        },
      })
    }))

  it('keeps the last safe weather snapshot visible when upstream refresh fails', () =>
    traceScenario('keeps the last safe weather snapshot visible when upstream refresh fails', () => {
      const { session, launchPart } = createSessionWithLaunchPart()

      const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
        messageId: 'assistant-reviewed-weather-scenario-1',
        part: launchPart,
        bridgeSessionId: 'bridge-session-reviewed-weather-scenario-2',
        now: () => 20_000,
        createId: () => 'event-reviewed-weather-created-2',
      })

      const readied = applyReviewedAppLaunchBridgeReadyToSession(bootstrapped, {
        messageId: 'assistant-reviewed-weather-scenario-1',
        part: getLaunchPart(bootstrapped),
        event: {
          kind: 'app.ready',
          bridgeSessionId: 'bridge-session-reviewed-weather-scenario-2',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-weather-scenario-2',
          ackNonce: 'bridge-nonce-reviewed-weather-scenario-2',
          sequence: 1,
        },
        now: () => 21_000,
        createId: () => 'event-reviewed-weather-ready-2',
      })

      const degradedSnapshot = createWeatherDashboardDegradedSnapshot({
        request: 'Refresh weather in Chicago.',
        locationQuery: 'Chicago',
        locationName: 'Chicago, Illinois, United States',
        timezone: 'America/Chicago',
        units: 'imperial',
        updatedAt: 22_000,
        current: {
          temperature: 68,
          apparentTemperature: 67,
          weatherCode: 3,
          conditionLabel: 'Overcast',
          windSpeed: 12,
        },
        forecast: [
          {
            dateKey: '2026-04-02',
            dayLabel: 'Thu',
            high: 69,
            low: 55,
            weatherCode: 3,
            conditionLabel: 'Overcast',
            precipitationChance: 40,
          },
        ],
        degraded: {
          reason: 'upstream-timeout',
          title: 'Upstream timed out',
          message: 'The host kept the last good weather snapshot visible while upstream data is unavailable.',
          retryable: true,
          usingStaleSnapshot: true,
        },
      })

      const degraded = applyReviewedAppLaunchBridgeEventToSession(readied, {
        messageId: 'assistant-reviewed-weather-scenario-1',
        part: getLaunchPart(readied),
        event: {
          kind: 'app.state',
          bridgeSessionId: 'bridge-session-reviewed-weather-scenario-2',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-weather-scenario-2',
          sequence: 2,
          idempotencyKey: 'state-reviewed-weather-scenario-3',
          snapshot: degradedSnapshot,
        },
        now: () => 22_000,
        createId: () => 'event-reviewed-weather-state-2',
      })

      expect(getLaunchPart(degraded)).toMatchObject({
        lifecycle: 'active',
        statusText: 'Showing cached snapshot',
        snapshot: {
          status: 'degraded',
          cacheStatus: 'stale-fallback',
          degraded: {
            usingStaleSnapshot: true,
          },
        },
      })
      expect(getLaunchPart(degraded).summaryForModel).toContain('last good snapshot')
    }))
})

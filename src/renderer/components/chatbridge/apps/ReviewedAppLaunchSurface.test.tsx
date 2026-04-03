/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, waitFor } from '@testing-library/react'
import type { BridgeReadyEvent } from '@shared/chatbridge/bridge-session'
import type { MessageAppPart, Session } from '@shared/types'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const controller = {
    attach: vi.fn(),
    waitForReady: vi.fn(async () => undefined),
    renderHtml: vi.fn(),
    getSession: vi.fn(() => ({
      envelope: {
        bridgeSessionId: 'bridge-session-reviewed-1',
      },
    })),
    dispose: vi.fn(),
  }

  return {
    controller,
    createBridgeHostController: vi.fn(() => controller),
    startRun: vi.fn(async () => ({
      runId: 'launch-trace-reviewed-1',
      end: vi.fn(async () => undefined),
    })),
    updateSessionWithMessages: vi.fn(async () => {
      const baseSession: Session = {
        id: 'session-reviewed-launch-1',
        name: 'Reviewed launch session',
        messages: [],
        settings: {},
      }

      return baseSession
    }),
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'chatbridge-weather:get-dashboard') {
        return {
          snapshot: {
            schemaVersion: 1,
            appId: 'weather-dashboard',
            request: 'Open Weather Dashboard for Chicago and show the forecast.',
            locationQuery: 'Chicago',
            locationName: 'Chicago, Illinois, United States',
            timezone: 'America/Chicago',
            units: 'imperial',
            status: 'ready',
            statusText: 'Live weather',
            summary:
              'Weather Dashboard is active for Chicago, Illinois, United States. Current conditions are 72°F and Mostly clear.',
            headline: '72°F and Mostly clear',
            dataStateLabel: 'Fresh host snapshot',
            lastUpdatedLabel: 'Updated 2:15 PM CDT',
            sourceLabel: 'Host weather boundary',
            cacheStatus: 'miss',
            refreshHint: 'Refresh weather to recheck the host-owned upstream snapshot.',
            updatedAt: 1717000000000,
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
            ],
          },
        }
      }

      throw new Error(`Unexpected channel: ${channel}`)
    }),
  }
})

vi.mock('@/packages/chatbridge/bridge/host-controller', () => ({
  createBridgeHostController: mocks.createBridgeHostController,
}))

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: mocks.startRun,
    enabled: true,
  },
}))

vi.mock('@/stores/chatStore', () => ({
  updateSessionWithMessages: mocks.updateSessionWithMessages,
}))

import { ReviewedAppLaunchSurface } from './ReviewedAppLaunchSurface'

function createReviewedLaunchPart(): MessageAppPart {
  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'reviewed-launch:tool-reviewed-launch-1',
    lifecycle: 'launching',
    toolCallId: 'tool-reviewed-launch-1',
    summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
    summaryForModel: 'Prepared the reviewed Chess session request for the host-owned launch path.',
    title: 'Chess launch',
    description: 'The host is launching Chess through the reviewed bridge runtime.',
    statusText: 'Launching',
    fallbackTitle: 'Chess fallback',
    fallbackText: 'The host will keep Chess launch and recovery in this thread if the runtime cannot finish starting.',
    values: {
      chatbridgeReviewedAppLaunch: {
        schemaVersion: 1,
        appId: 'chess',
        appName: 'Chess',
        appVersion: '0.1.0',
        toolName: 'chess_prepare_session',
        capability: 'prepare-session',
        summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
        request: 'Open Chess and analyze this FEN.',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      },
    },
  }
}

function createWeatherReviewedLaunchPart(): MessageAppPart {
  return {
    type: 'app',
    appId: 'weather-dashboard',
    appName: 'Weather Dashboard',
    appInstanceId: 'reviewed-launch:tool-reviewed-launch-weather-1',
    lifecycle: 'launching',
    toolCallId: 'tool-reviewed-launch-weather-1',
    summary: 'Prepared the reviewed Weather Dashboard request for the host-owned launch path.',
    summaryForModel: 'Prepared the reviewed Weather Dashboard request for the host-owned launch path.',
    title: 'Weather Dashboard launch',
    description: 'The host is launching Weather Dashboard through the reviewed runtime.',
    statusText: 'Launching',
    fallbackTitle: 'Weather Dashboard fallback',
    fallbackText: 'The host will keep Weather Dashboard launch and recovery in this thread if live weather cannot load.',
    values: {
      chatbridgeReviewedAppLaunch: {
        schemaVersion: 1,
        appId: 'weather-dashboard',
        appName: 'Weather Dashboard',
        appVersion: '0.1.0',
        toolName: 'weather_dashboard_open',
        capability: 'open',
        summary: 'Prepared the reviewed Weather Dashboard request for the host-owned launch path.',
        request: 'Open Weather Dashboard for Chicago and show the forecast.',
        location: 'Chicago',
      },
    },
  }
}

describe('ReviewedAppLaunchSurface', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:reviewed-runtime'),
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'electronAPI', {
      value: {
        invoke: mocks.invoke,
      },
      configurable: true,
      writable: true,
    })
  })

  it('boots a reviewed app launch through the bridge controller instead of the seeded chess runtime', async () => {
    const { container, queryByRole } = render(
      <MantineProvider>
        <ReviewedAppLaunchSurface
          part={createReviewedLaunchPart()}
          sessionId="session-reviewed-launch-1"
          messageId="assistant-reviewed-launch-1"
        />
      </MantineProvider>
    )

    expect(queryByRole('button', { name: /g1, white knight/i })).toBeNull()

    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    if (!iframe) {
      return
    }

    Object.defineProperty(iframe, 'contentWindow', {
      value: window,
      configurable: true,
    })

    fireEvent.load(iframe)

    await waitFor(() => {
      expect(mocks.createBridgeHostController).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'chess',
          appName: 'Chess',
          appInstanceId: 'reviewed-launch:tool-reviewed-launch-1',
          capabilities: ['launch-reviewed-app'],
          traceParentRunId: 'launch-trace-reviewed-1',
        })
      )
    })

    const firstControllerCall = mocks.createBridgeHostController.mock.calls[0] as unknown as [unknown] | undefined
    expect(firstControllerCall).toBeTruthy()
    if (!firstControllerCall) {
      return
    }
    const controllerOptions = firstControllerCall[0] as {
      onReady?: (event: BridgeReadyEvent) => void
      onAcceptedAppEvent?: (event: unknown) => void
    }

    await waitFor(() => {
      expect(mocks.controller.attach).toHaveBeenCalledTimes(1)
      expect(mocks.updateSessionWithMessages).toHaveBeenCalledTimes(1)
    })

    controllerOptions.onReady?.({
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-reviewed-1',
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-1',
      bridgeToken: 'bridge-token-reviewed-1',
      ackNonce: 'bridge-nonce-reviewed-1',
      sequence: 1,
    })
    controllerOptions.onAcceptedAppEvent?.({
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-reviewed-1',
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-1',
      bridgeToken: 'bridge-token-reviewed-1',
      sequence: 2,
      idempotencyKey: 'state-reviewed-launch-2',
      snapshot: {
        kind: 'reviewed-app-launch',
        schemaVersion: 1,
        summary: 'Chess bridge runtime is live inside the host-owned shell.',
        statusText: 'Bridge active',
      },
    })

    await waitFor(() => {
      expect(mocks.updateSessionWithMessages).toHaveBeenCalledTimes(2)
    })
  })

  it('renders Weather Dashboard through the dedicated host-owned weather surface', async () => {
    const { container, getByRole, findByText } = render(
      <MantineProvider>
        <ReviewedAppLaunchSurface
          part={createWeatherReviewedLaunchPart()}
          sessionId="session-reviewed-launch-weather-1"
          messageId="assistant-reviewed-launch-weather-1"
        />
      </MantineProvider>
    )

    expect(container.querySelector('iframe')).toBeNull()
    expect(getByRole('button', { name: /refresh weather/i })).toBeTruthy()
    await findByText('Chicago, Illinois, United States')

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        'chatbridge-weather:get-dashboard',
        expect.objectContaining({
          request: 'Open Weather Dashboard for Chicago and show the forecast.',
          location: 'Chicago',
          refresh: false,
        })
      )
    })
    expect(mocks.createBridgeHostController).not.toHaveBeenCalled()
  })
})

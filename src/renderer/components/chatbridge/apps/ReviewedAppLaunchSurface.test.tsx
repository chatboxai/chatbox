/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import type { BridgeReadyEvent } from '@shared/chatbridge/bridge-session'
import type { MessageAppPart, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('ReviewedAppLaunchSurface', () => {
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
  })

  it('boots a reviewed app launch through the bridge controller instead of the seeded chess runtime', async () => {
    const { container, queryByRole } = render(
      <ReviewedAppLaunchSurface
        part={createReviewedLaunchPart()}
        sessionId="session-reviewed-launch-1"
        messageId="assistant-reviewed-launch-1"
      />
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
})

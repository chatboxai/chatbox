import '../setup'

import { createChatBridgeTimeoutRecoveryContract, readChatBridgeDegradedCompletion } from '@shared/chatbridge'
import { CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION } from '@shared/chatbridge/tools'
import { createMessage, type MessageAppPart, type MessageToolCallPart, type Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  applyReviewedAppLaunchBootstrapToSession,
  applyReviewedAppLaunchBridgeEventToSession,
  applyReviewedAppLaunchBridgeReadyToSession,
  applyReviewedAppLaunchRecoveryToSession,
  upsertReviewedAppLaunchParts,
} from '@/packages/chatbridge/reviewed-app-launch'
import { createChatBridgePartnerHarness } from '../mocks/partner-harness'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function createReviewedLaunchToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-bridge-1',
    toolName: 'drawing_kit_open',
    args: {
      request: 'Open Drawing Kit and sketch a quick concept map.',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'drawing_kit_open',
      appId: 'drawing-kit',
      sessionId: 'session-reviewed-bridge-1',
      schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
      executionAuthority: 'host',
      effect: 'read',
      retryClassification: 'safe',
      invocation: {
        args: {
          request: 'Open Drawing Kit and sketch a quick concept map.',
        },
      },
      outcome: {
        status: 'success',
        result: {
          appId: 'drawing-kit',
          appName: 'Drawing Kit',
          capability: 'open',
          launchReady: true,
          summary: 'Prepared Drawing Kit for the reviewed launch path.',
          request: 'Open Drawing Kit and sketch a quick concept map.',
        },
      },
    },
  }
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-reviewed-app-bridge-launch',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['bridge', 'recovery'],
      storyId: 'CB-305',
    },
    testCase,
    execute
  )
}

function createSessionWithLaunchPart(): { session: Session; launchPart: MessageAppPart } {
  const assistantMessage = createMessage('assistant')
  assistantMessage.id = 'assistant-reviewed-bridge-1'
  assistantMessage.contentParts = upsertReviewedAppLaunchParts([createReviewedLaunchToolCallPart()])

  const launchPart = assistantMessage.contentParts.find(
    (part): part is MessageAppPart => part.type === 'app'
  )

  if (!launchPart) {
    throw new Error('Expected a reviewed app launch part.')
  }

  return {
    session: {
      id: 'session-reviewed-bridge-1',
      name: 'Reviewed bridge session',
      messages: [assistantMessage],
      settings: {},
    },
    launchPart,
  }
}

function getLaunchPart(session: Session): MessageAppPart {
  const message = session.messages.find((candidate) => candidate.id === 'assistant-reviewed-bridge-1')
  const launchPart = message?.contentParts.find((part): part is MessageAppPart => part.type === 'app')

  if (!launchPart) {
    throw new Error('Expected the reviewed bridge session to keep the launch part.')
  }

  return launchPart
}

describe('ChatBridge reviewed app bridge launch adoption', () => {
  it('drives a reviewed app launch through the bridge host controller and persists host-owned lifecycle state', () =>
    traceScenario(
      'drives a reviewed app launch through the bridge host controller and persists host-owned lifecycle state',
      async () => {
        const { session, launchPart } = createSessionWithLaunchPart()
        const harness = createChatBridgePartnerHarness({
          appId: 'drawing-kit',
          appName: 'Drawing Kit',
          appVersion: '0.1.0',
          appInstanceId: launchPart.appInstanceId,
          expectedOrigin: 'https://apps.example.com',
          capabilities: ['launch-reviewed-app'],
          createIds: ['bridge-session-reviewed-1', 'bridge-token-reviewed-1', 'bridge-nonce-reviewed-1'],
          now: () => 10_000,
        })

        let nextSession = applyReviewedAppLaunchBootstrapToSession(session, {
          messageId: 'assistant-reviewed-bridge-1',
          part: launchPart,
          bridgeSessionId: harness.controller.getSession().envelope.bridgeSessionId,
          now: () => 10_000,
          createId: () => 'event-reviewed-created-1',
        })

        const readyPromise = harness.waitForReady()
        harness.sendAppEvent({
          kind: 'app.ready',
          bridgeSessionId: 'bridge-session-reviewed-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-1',
          ackNonce: 'bridge-nonce-reviewed-1',
          sequence: 1,
        })
        await readyPromise

        nextSession = applyReviewedAppLaunchBridgeReadyToSession(nextSession, {
          messageId: 'assistant-reviewed-bridge-1',
          part: getLaunchPart(nextSession),
          event: {
            kind: 'app.ready',
            bridgeSessionId: 'bridge-session-reviewed-1',
            appInstanceId: launchPart.appInstanceId,
            bridgeToken: 'bridge-token-reviewed-1',
            ackNonce: 'bridge-nonce-reviewed-1',
            sequence: 1,
          },
          now: () => 11_000,
          createId: () => 'event-reviewed-ready-1',
        })

        harness.sendAppEvent({
          kind: 'app.state',
          bridgeSessionId: 'bridge-session-reviewed-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-1',
          sequence: 2,
          idempotencyKey: 'state-reviewed-bridge-2',
          snapshot: {
            kind: 'reviewed-app-launch',
            schemaVersion: 1,
            summary: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
            statusText: 'Bridge active',
            request: 'Open Drawing Kit and sketch a quick concept map.',
          },
        })

        nextSession = applyReviewedAppLaunchBridgeEventToSession(nextSession, {
          messageId: 'assistant-reviewed-bridge-1',
          part: getLaunchPart(nextSession),
          event: {
            kind: 'app.state',
            bridgeSessionId: 'bridge-session-reviewed-1',
            appInstanceId: launchPart.appInstanceId,
            bridgeToken: 'bridge-token-reviewed-1',
            sequence: 2,
            idempotencyKey: 'state-reviewed-bridge-2',
            snapshot: {
              kind: 'reviewed-app-launch',
              schemaVersion: 1,
              summary: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
              statusText: 'Bridge active',
              request: 'Open Drawing Kit and sketch a quick concept map.',
            },
          },
          now: () => 12_000,
          createId: () => 'event-reviewed-state-1',
        })

        expect(getLaunchPart(nextSession)).toMatchObject({
          lifecycle: 'active',
          bridgeSessionId: 'bridge-session-reviewed-1',
          summary: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
          snapshot: {
            kind: 'reviewed-app-launch',
          },
        })
        expect(nextSession.chatBridgeAppRecords).toMatchObject({
          instances: [
            {
              id: launchPart.appInstanceId,
              status: 'active',
              bridgeSessionId: 'bridge-session-reviewed-1',
            },
          ],
          events: [{ kind: 'instance.created' }, { kind: 'bridge.ready' }, { kind: 'state.updated' }],
        })
      }
    ))

  it('fails bridge launch into explicit host recovery instead of dropping into the artifact preview path', () =>
    traceScenario(
      'fails bridge launch into explicit host recovery instead of dropping into the artifact preview path',
      () => {
        const { session, launchPart } = createSessionWithLaunchPart()

        const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
          messageId: 'assistant-reviewed-bridge-1',
          part: launchPart,
          bridgeSessionId: 'bridge-session-reviewed-timeout-1',
          now: () => 20_000,
          createId: () => 'event-reviewed-created-timeout-1',
        })

        const recovered = applyReviewedAppLaunchRecoveryToSession(bootstrapped, {
          messageId: 'assistant-reviewed-bridge-1',
          part: getLaunchPart(bootstrapped),
          contract: createChatBridgeTimeoutRecoveryContract({
            appId: 'drawing-kit',
            appName: 'Drawing Kit',
            appInstanceId: launchPart.appInstanceId,
            bridgeSessionId: 'bridge-session-reviewed-timeout-1',
            waitedMs: 5_000,
          }),
          now: () => 21_000,
          createId: () => 'event-reviewed-timeout-1',
        })

        const recoveredPart = getLaunchPart(recovered)
        expect(recoveredPart).toMatchObject({
          appId: 'drawing-kit',
          lifecycle: 'error',
          statusText: 'Timed out',
          error:
            'Drawing Kit timed out before the host could trust a live response, so recovery stays explicit in the thread.',
        })
        expect(readChatBridgeDegradedCompletion(recoveredPart)).toMatchObject({
          kind: 'stale-checkpoint',
          statusLabel: 'Timed out',
          actions: [
            { id: 'continue-in-chat', label: 'Continue safely' },
            { id: 'ask-for-explanation', label: 'Ask for explanation' },
          ],
        })
      }
    ))
})

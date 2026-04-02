import {
  createChatBridgeRuntimeCrashRecoveryContract,
  readChatBridgeDegradedCompletion,
} from '@shared/chatbridge'
import type { BridgeReadyEvent, BridgeAppEvent } from '@shared/chatbridge/bridge-session'
import { CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION } from '@shared/chatbridge/tools'
import { createMessage, type MessageAppPart, type MessageToolCallPart, type Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  applyReviewedAppLaunchBootstrapToSession,
  applyReviewedAppLaunchBridgeEventToSession,
  applyReviewedAppLaunchBridgeReadyToSession,
  applyReviewedAppLaunchRecoveryToSession,
  readChatBridgeReviewedAppLaunch,
  upsertReviewedAppLaunchParts,
} from './reviewed-app-launch'

function createReviewedLaunchToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-1',
    toolName: 'chess_prepare_session',
    args: {
      request: 'Open Chess and analyze this FEN.',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'chess_prepare_session',
      appId: 'chess',
      sessionId: 'session-reviewed-launch-1',
      schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
      executionAuthority: 'host',
      effect: 'read',
      retryClassification: 'safe',
      invocation: {
        args: {
          request: 'Open Chess and analyze this FEN.',
          fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        },
      },
      outcome: {
        status: 'success',
        result: {
          appId: 'chess',
          appName: 'Chess',
          capability: 'prepare-session',
          launchReady: true,
          summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
          request: 'Open Chess and analyze this FEN.',
          fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        },
      },
    },
  }
}

function createSessionWithLaunchParts(): { session: Session; launchPart: MessageAppPart } {
  const assistantMessage = createMessage('assistant')
  assistantMessage.id = 'assistant-reviewed-launch-1'
  assistantMessage.contentParts = upsertReviewedAppLaunchParts([createReviewedLaunchToolCallPart()])

  const launchPart = assistantMessage.contentParts.find(
    (part): part is MessageAppPart => part.type === 'app'
  )
  if (!launchPart) {
    throw new Error('Expected a reviewed app launch part.')
  }

  return {
    session: {
      id: 'session-reviewed-launch-1',
      name: 'Reviewed launch session',
      messages: [assistantMessage],
      settings: {},
    },
    launchPart,
  }
}

function getLaunchPart(session: Session): MessageAppPart {
  const message = session.messages.find((candidate) => candidate.id === 'assistant-reviewed-launch-1')
  const launchPart = message?.contentParts.find((part): part is MessageAppPart => part.type === 'app')

  if (!launchPart) {
    throw new Error('Expected the session to contain a reviewed launch app part.')
  }

  return launchPart
}

describe('reviewed app launch adoption', () => {
  it('converts successful reviewed host-tool results into launchable app parts', () => {
    const [toolCall, derivedLaunchPart] = upsertReviewedAppLaunchParts([createReviewedLaunchToolCallPart()])
    if (derivedLaunchPart?.type !== 'app') {
      throw new Error('Expected the derived reviewed launch part to be an app part.')
    }

    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tool-reviewed-launch-1',
    })
    expect(derivedLaunchPart).toMatchObject({
      type: 'app',
      appId: 'chess',
      appName: 'Chess',
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-1',
      lifecycle: 'launching',
      toolCallId: 'tool-reviewed-launch-1',
      summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
      summaryForModel: 'Prepared the reviewed Chess session request for the host-owned launch path.',
      statusText: 'Launching',
    })
    expect(readChatBridgeReviewedAppLaunch(derivedLaunchPart.values)).toMatchObject({
      appId: 'chess',
      appName: 'Chess',
      toolName: 'chess_prepare_session',
      request: 'Open Chess and analyze this FEN.',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    })
  })

  it('preserves an existing bridge-owned launch part when the tool result is normalized again', () => {
    const existingParts = upsertReviewedAppLaunchParts([createReviewedLaunchToolCallPart()])
    const existingLaunchPart = existingParts.find((part): part is MessageAppPart => part.type === 'app')

    if (!existingLaunchPart) {
      throw new Error('Expected an existing reviewed launch part.')
    }

    const rerenderedParts = upsertReviewedAppLaunchParts([
      createReviewedLaunchToolCallPart(),
      {
        ...existingLaunchPart,
        lifecycle: 'active',
        bridgeSessionId: 'bridge-session-reviewed-1',
        statusText: 'Bridge active',
        summary: 'Chess bridge runtime is live inside the thread.',
      },
    ])

    const rerenderedLaunchPart = rerenderedParts.find((part): part is MessageAppPart => part.type === 'app')
    expect(rerenderedLaunchPart).toMatchObject({
      appInstanceId: existingLaunchPart.appInstanceId,
      lifecycle: 'active',
      bridgeSessionId: 'bridge-session-reviewed-1',
      statusText: 'Bridge active',
      summary: 'Chess bridge runtime is live inside the thread.',
    })
  })

  it('persists bootstrap, ready, active, and recovery state into the host-owned session record', () => {
    const { session, launchPart } = createSessionWithLaunchParts()

    const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
      messageId: 'assistant-reviewed-launch-1',
      part: launchPart,
      bridgeSessionId: 'bridge-session-reviewed-1',
      now: () => 10_000,
      createId: () => 'event-created-reviewed-launch-1',
    })
    const bootstrappedPart = getLaunchPart(bootstrapped)

    expect(bootstrappedPart).toMatchObject({
      lifecycle: 'launching',
      bridgeSessionId: 'bridge-session-reviewed-1',
      statusText: 'Launching',
    })
    expect(bootstrapped.chatBridgeAppRecords).toMatchObject({
      instances: [
        {
          id: 'reviewed-launch:tool-reviewed-launch-1',
          appId: 'chess',
          bridgeSessionId: 'bridge-session-reviewed-1',
          status: 'launching',
        },
      ],
      events: [
        {
          kind: 'instance.created',
        },
      ],
    })

    const readyEvent: BridgeReadyEvent = {
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-reviewed-1',
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-1',
      bridgeToken: 'bridge-token-reviewed-1',
      ackNonce: 'bridge-nonce-reviewed-1',
      sequence: 1,
    }
    const readied = applyReviewedAppLaunchBridgeReadyToSession(bootstrapped, {
      messageId: 'assistant-reviewed-launch-1',
      part: bootstrappedPart,
      event: readyEvent,
      now: () => 11_000,
      createId: () => 'event-ready-reviewed-launch-1',
    })
    const readyPart = getLaunchPart(readied)

    expect(readyPart).toMatchObject({
      lifecycle: 'ready',
      bridgeSessionId: 'bridge-session-reviewed-1',
      statusText: 'Ready',
    })

    const stateEvent: Extract<BridgeAppEvent, { kind: 'app.state' }> = {
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
        request: 'Open Chess and analyze this FEN.',
      },
    }
    const activated = applyReviewedAppLaunchBridgeEventToSession(readied, {
      messageId: 'assistant-reviewed-launch-1',
      part: readyPart,
      event: stateEvent,
      now: () => 12_000,
      createId: () => 'event-state-reviewed-launch-1',
    })
    const activePart = getLaunchPart(activated)

    expect(activePart).toMatchObject({
      lifecycle: 'active',
      summary: 'Chess bridge runtime is live inside the host-owned shell.',
      summaryForModel: 'Chess bridge runtime is live inside the host-owned shell.',
      statusText: 'Bridge active',
      snapshot: {
        kind: 'reviewed-app-launch',
        summary: 'Chess bridge runtime is live inside the host-owned shell.',
      },
    })
    expect(activated.chatBridgeAppRecords).toMatchObject({
      instances: [
        {
          id: 'reviewed-launch:tool-reviewed-launch-1',
          status: 'active',
          bridgeSessionId: 'bridge-session-reviewed-1',
        },
      ],
      events: [
        { kind: 'instance.created' },
        { kind: 'bridge.ready' },
        { kind: 'state.updated' },
      ],
    })

    const recovered = applyReviewedAppLaunchRecoveryToSession(activated, {
      messageId: 'assistant-reviewed-launch-1',
      part: activePart,
      contract: createChatBridgeRuntimeCrashRecoveryContract({
        appId: 'chess',
        appName: 'Chess',
        appInstanceId: activePart.appInstanceId,
        bridgeSessionId: activePart.bridgeSessionId,
        error: 'The reviewed launch runtime crashed.',
      }),
      now: () => 13_000,
      createId: () => 'event-error-reviewed-launch-1',
    })
    const recoveredPart = getLaunchPart(recovered)

    expect(recoveredPart).toMatchObject({
      lifecycle: 'error',
      statusText: 'Runtime crash',
      error: 'Chess crashed, but the conversation can continue from preserved host-owned context.',
    })
    expect(readChatBridgeDegradedCompletion(recoveredPart)).toMatchObject({
      kind: 'runtime-error',
      statusLabel: 'Runtime crash',
      actions: [
        { id: 'continue-in-chat', label: 'Continue safely' },
        { id: 'dismiss-runtime', label: 'Dismiss runtime' },
      ],
    })
    expect(recovered.chatBridgeAppRecords).toMatchObject({
      instances: [
        {
          id: 'reviewed-launch:tool-reviewed-launch-1',
          status: 'error',
        },
      ],
      events: [
        { kind: 'instance.created' },
        { kind: 'bridge.ready' },
        { kind: 'state.updated' },
        { kind: 'error.recorded' },
      ],
    })
  })
})

/**
 * @vitest-environment jsdom
 */

import '../../../../test/integration/chatbridge/setup'

import {
  createChatBridgeRuntimeCrashRecoveryContract,
  createDrawingKitAppSnapshot,
  readChatBridgeDegradedCompletion,
} from '@shared/chatbridge'
import {
  CHESS_APP_ID,
  CHESS_APP_NAME,
  ChessAppSnapshotSchema,
  DEFAULT_CHESS_AI_CONFIG,
  createChessAppSnapshotFromGame,
} from '@shared/chatbridge/apps/chess'
import type { BridgeAppEvent, BridgeReadyEvent } from '@shared/chatbridge/bridge-session'
import { CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION } from '@shared/chatbridge/tools'
import { createMessage, type MessageAppPart, type MessageToolCallPart, type Session } from '@shared/types'
import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import {
  applyReviewedAppLaunchBootstrapToSession,
  applyReviewedAppLaunchBridgeEventToSession,
  applyReviewedAppLaunchBridgeReadyToSession,
  applyReviewedAppLaunchRecoveryToSession,
  readChatBridgeReviewedAppLaunch,
  upsertReviewedAppLaunchParts,
} from './reviewed-app-launch'

function createChessToolCallPart(): MessageToolCallPart {
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

function createChessNewGameToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-new-game-1',
    toolName: 'chess_prepare_session',
    args: {
      request: 'Open Chess and let me play a new game.',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'chess_prepare_session',
      appId: 'chess',
      sessionId: 'session-reviewed-launch-new-game-1',
      schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
      executionAuthority: 'host',
      effect: 'read',
      retryClassification: 'safe',
      invocation: {
        args: {
          request: 'Open Chess and let me play a new game.',
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
          request: 'Open Chess and let me play a new game.',
        },
      },
    },
  }
}

function createDrawingKitLaunchToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-drawing-1',
    toolName: 'drawing_kit_open',
    args: {
      request: 'Open Drawing Kit and start a sticky-note doodle dare.',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'drawing_kit_open',
      appId: 'drawing-kit',
      sessionId: 'session-reviewed-launch-drawing-1',
      schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
      executionAuthority: 'host',
      effect: 'read',
      retryClassification: 'safe',
      invocation: {
        args: {
          request: 'Open Drawing Kit and start a sticky-note doodle dare.',
        },
      },
      outcome: {
        status: 'success',
        result: {
          appId: 'drawing-kit',
          appName: 'Drawing Kit',
          capability: 'open',
          launchReady: true,
          summary: 'Prepared the reviewed Drawing Kit request for the host-owned launch path.',
          request: 'Open Drawing Kit and start a sticky-note doodle dare.',
        },
      },
    },
  }
}

function createWeatherDashboardLaunchToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-weather-1',
    toolName: 'weather_dashboard_open',
    args: {
      request: 'Open Weather Dashboard for Chicago and show the forecast.',
      location: 'Chicago',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'weather_dashboard_open',
      appId: 'weather-dashboard',
      sessionId: 'session-reviewed-launch-weather-1',
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

function createSessionWithGenericLaunchPart(): { session: Session; launchPart: MessageAppPart } {
  const assistantMessage = createMessage('assistant')
  assistantMessage.id = 'assistant-reviewed-launch-1'
  assistantMessage.contentParts = upsertReviewedAppLaunchParts([createDrawingKitLaunchToolCallPart()])

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

function getLaunchPart(session: Session, messageId = 'assistant-reviewed-launch-1'): MessageAppPart {
  const message = session.messages.find((candidate) => candidate.id === messageId)
  const launchPart = message?.contentParts.find((part): part is MessageAppPart => part.type === 'app')

  if (!launchPart) {
    throw new Error('Expected the session to contain a reviewed launch app part.')
  }

  return launchPart
}

describe('reviewed app launch adoption', () => {
  it('converts successful chess host-tool results into live chess app parts', () => {
    const [toolCall, derivedChessPart] = upsertReviewedAppLaunchParts([createChessToolCallPart()])
    if (derivedChessPart?.type !== 'app') {
      throw new Error('Expected the derived Chess part to be an app part.')
    }

    const snapshot = ChessAppSnapshotSchema.parse(derivedChessPart.snapshot)

    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolCallId: 'tool-reviewed-launch-1',
    })
    expect(derivedChessPart).toMatchObject({
      type: 'app',
      appId: CHESS_APP_ID,
      appName: CHESS_APP_NAME,
      appInstanceId: 'chess-launch:tool-reviewed-launch-1',
      lifecycle: 'active',
      toolCallId: 'tool-reviewed-launch-1',
      statusText: 'White to move',
      summary: 'Chess board ready. White to move from the loaded position.',
      summaryForModel: 'Chess board ready. White to move from the loaded position.',
    })
    expect(readChatBridgeReviewedAppLaunch(derivedChessPart.values)).toBeNull()
    expect(snapshot).toMatchObject({
      appId: 'chess',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      turn: 'white',
      status: {
        phase: 'active',
      },
    })
    expect(snapshot.ai).toBeUndefined()
  })

  it('defaults a new reviewed chess game into white-vs-black AI mode', () => {
    const [, derivedChessPart] = upsertReviewedAppLaunchParts([createChessNewGameToolCallPart()])
    if (derivedChessPart?.type !== 'app') {
      throw new Error('Expected the derived Chess part to be an app part.')
    }

    const snapshot = ChessAppSnapshotSchema.parse(derivedChessPart.snapshot)

    expect(derivedChessPart).toMatchObject({
      type: 'app',
      appId: CHESS_APP_ID,
      appName: CHESS_APP_NAME,
      appInstanceId: 'chess-launch:tool-reviewed-launch-new-game-1',
      lifecycle: 'active',
      summary: 'Chess board ready. White to move from the starting position.',
      statusText: 'White to move',
    })
    expect(snapshot.ai).toEqual(DEFAULT_CHESS_AI_CONFIG)
  })

  it('preserves an existing live chess app part when the tool result is normalized again', () => {
    const existingParts = upsertReviewedAppLaunchParts([createChessToolCallPart()])
    const existingChessPart = existingParts.find((part): part is MessageAppPart => part.type === 'app')

    if (!existingChessPart) {
      throw new Error('Expected an existing Chess app part.')
    }

    const game = new Chess()
    const move = game.move({ from: 'e2', to: 'e4' })
    if (!move) {
      throw new Error('Expected e4 to be legal.')
    }

    const updatedSnapshot = createChessAppSnapshotFromGame(game, {
      lastAction: {
        kind: 'accepted',
        message: 'e4 is legal.',
        move: createChessAppSnapshotFromGame(game).moveHistory[0]!,
      },
    })

    const rerenderedParts = upsertReviewedAppLaunchParts([
      createChessToolCallPart(),
      {
        ...existingChessPart,
        snapshot: updatedSnapshot,
        summary: 'Chess updated to e4. Black to move.',
        summaryForModel: 'Chess updated to e4. Black to move.',
        statusText: 'Black to move',
      },
    ])

    const rerenderedChessPart = rerenderedParts.find((part): part is MessageAppPart => part.type === 'app')
    expect(rerenderedChessPart).toMatchObject({
      appInstanceId: existingChessPart.appInstanceId,
      lifecycle: 'active',
      summary: 'Chess updated to e4. Black to move.',
      statusText: 'Black to move',
      snapshot: {
        moveHistory: [
          {
            san: 'e4',
          },
        ],
      },
    })
  })

  it('keeps the generic reviewed-launch shell for non-Chess apps', () => {
    const [, derivedLaunchPart] = upsertReviewedAppLaunchParts([createDrawingKitLaunchToolCallPart()])
    if (derivedLaunchPart?.type !== 'app') {
      throw new Error('Expected the derived launch part to be an app part.')
    }

    expect(derivedLaunchPart).toMatchObject({
      type: 'app',
      appId: 'drawing-kit',
      appName: 'Drawing Kit',
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-drawing-1',
      lifecycle: 'launching',
      toolCallId: 'tool-reviewed-launch-drawing-1',
      summary: 'Prepared the reviewed Drawing Kit request for the host-owned launch path.',
      summaryForModel: 'Prepared the reviewed Drawing Kit request for the host-owned launch path.',
      statusText: 'Launching',
    })
    expect(readChatBridgeReviewedAppLaunch(derivedLaunchPart.values)).toMatchObject({
      appId: 'drawing-kit',
      appName: 'Drawing Kit',
      toolName: 'drawing_kit_open',
      request: 'Open Drawing Kit and start a sticky-note doodle dare.',
    })
  })

  it('preserves weather location hints on the generic reviewed launch shell', () => {
    const [, derivedLaunchPart] = upsertReviewedAppLaunchParts([createWeatherDashboardLaunchToolCallPart()])
    if (derivedLaunchPart?.type !== 'app') {
      throw new Error('Expected the derived weather launch part to be an app part.')
    }

    expect(derivedLaunchPart).toMatchObject({
      type: 'app',
      appId: 'weather-dashboard',
      appName: 'Weather Dashboard',
      lifecycle: 'launching',
      statusText: 'Launching',
    })
    expect(readChatBridgeReviewedAppLaunch(derivedLaunchPart.values)).toMatchObject({
      appId: 'weather-dashboard',
      toolName: 'weather_dashboard_open',
      request: 'Open Weather Dashboard for Chicago and show the forecast.',
      location: 'Chicago',
    })
  })

  it('fails closed when the reviewed Chess launch payload contains invalid board input', () => {
    const [, derivedChessPart] = upsertReviewedAppLaunchParts([
      {
        ...createChessToolCallPart(),
        args: {
          request: 'Open Chess with this broken board state.',
          fen: 'not-a-valid-fen',
        },
        result: {
          ...(createChessToolCallPart().result as NonNullable<MessageToolCallPart['result']>),
          outcome: {
            status: 'success',
            result: {
              appId: 'chess',
              appName: 'Chess',
              capability: 'prepare-session',
              launchReady: true,
              summary: 'Prepared the reviewed Chess session request for the host-owned launch path.',
              request: 'Open Chess with this broken board state.',
              fen: 'not-a-valid-fen',
            },
          },
        },
      },
    ])

    if (derivedChessPart?.type !== 'app') {
      throw new Error('Expected the derived Chess part to be an app part.')
    }

    expect(derivedChessPart).toMatchObject({
      appId: CHESS_APP_ID,
      lifecycle: 'error',
      statusText: 'Input error',
    })
    expect(readChatBridgeReviewedAppLaunch(derivedChessPart.values)).toBeNull()
    expect(derivedChessPart.summary).toContain('Invalid FEN')
  })

  it('persists bootstrap, ready, active, and recovery state into the host-owned session record for generic reviewed apps', () => {
    const { session, launchPart } = createSessionWithGenericLaunchPart()

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
          id: 'reviewed-launch:tool-reviewed-launch-drawing-1',
          appId: 'drawing-kit',
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
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-drawing-1',
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
      appInstanceId: 'reviewed-launch:tool-reviewed-launch-drawing-1',
      bridgeToken: 'bridge-token-reviewed-1',
      sequence: 2,
      idempotencyKey: 'state-reviewed-bridge-2',
      snapshot: {
        kind: 'reviewed-app-launch',
        schemaVersion: 1,
        summary: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
        statusText: 'Bridge active',
        request: 'Open Drawing Kit and start a sticky-note doodle dare.',
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
      summary: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
      summaryForModel: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
      statusText: 'Bridge active',
      snapshot: {
        kind: 'reviewed-app-launch',
        summary: 'Drawing Kit bridge runtime is live inside the host-owned shell.',
      },
    })
    expect(activated.chatBridgeAppRecords).toMatchObject({
      instances: [
        {
          id: 'reviewed-launch:tool-reviewed-launch-drawing-1',
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
        appId: 'drawing-kit',
        appName: 'Drawing Kit',
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
      error: 'Drawing Kit crashed, but the conversation can continue from preserved host-owned context.',
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
          id: 'reviewed-launch:tool-reviewed-launch-drawing-1',
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

  it('keeps bounded Drawing Kit checkpoints and completion handoff inside the launch session record', () => {
    const assistantMessage = createMessage('assistant')
    assistantMessage.id = 'assistant-reviewed-launch-drawing-1'
    assistantMessage.contentParts = upsertReviewedAppLaunchParts([createDrawingKitLaunchToolCallPart()])

    const launchPart = assistantMessage.contentParts.find((part): part is MessageAppPart => part.type === 'app')
    if (!launchPart) {
      throw new Error('Expected a reviewed Drawing Kit launch part.')
    }

    const session: Session = {
      id: 'session-reviewed-launch-drawing-1',
      name: 'Reviewed Drawing launch session',
      messages: [assistantMessage],
      settings: {},
    }

    const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
      messageId: 'assistant-reviewed-launch-drawing-1',
      part: launchPart,
      bridgeSessionId: 'bridge-session-reviewed-drawing-1',
      now: () => 20_000,
      createId: () => 'event-created-reviewed-drawing-1',
    })

    const bootstrappedPart = getLaunchPart(bootstrapped, 'assistant-reviewed-launch-drawing-1')
    const readied = applyReviewedAppLaunchBridgeReadyToSession(bootstrapped, {
      messageId: 'assistant-reviewed-launch-drawing-1',
      part: bootstrappedPart,
      event: {
        kind: 'app.ready',
        bridgeSessionId: 'bridge-session-reviewed-drawing-1',
        appInstanceId: 'reviewed-launch:tool-reviewed-launch-drawing-1',
        bridgeToken: 'bridge-token-reviewed-drawing-1',
        ackNonce: 'bridge-nonce-reviewed-drawing-1',
        sequence: 1,
      },
      now: () => 21_000,
      createId: () => 'event-ready-reviewed-drawing-1',
    })

    const checkpointSnapshot = createDrawingKitAppSnapshot({
      request: 'Open Drawing Kit and start a sticky-note doodle dare.',
      roundLabel: 'Dare 05',
      roundPrompt: 'Draw the weirdest sandwich.',
      rewardLabel: 'Llama sticker',
      caption: 'Triple pickle sandwich',
      selectedTool: 'spray',
      status: 'checkpointed',
      strokeCount: 6,
      stickerCount: 3,
      checkpointId: 'drawing-kit-4200',
      lastUpdatedAt: 22_000,
      previewMarks: [
        {
          kind: 'line',
          tool: 'spray',
          color: '#ff8a4c',
          width: 3,
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.5, y: 0.4 },
          ],
        },
      ],
    })

    const activated = applyReviewedAppLaunchBridgeEventToSession(readied, {
      messageId: 'assistant-reviewed-launch-drawing-1',
      part: getLaunchPart(readied, 'assistant-reviewed-launch-drawing-1'),
      event: {
        kind: 'app.state',
        bridgeSessionId: 'bridge-session-reviewed-drawing-1',
        appInstanceId: 'reviewed-launch:tool-reviewed-launch-drawing-1',
        bridgeToken: 'bridge-token-reviewed-drawing-1',
        sequence: 2,
        idempotencyKey: 'state-reviewed-drawing-2',
        snapshot: checkpointSnapshot,
      },
      now: () => 22_000,
      createId: () => 'event-state-reviewed-drawing-1',
    })
    const activePart = getLaunchPart(activated, 'assistant-reviewed-launch-drawing-1')

    expect(activePart).toMatchObject({
      appId: 'drawing-kit',
      lifecycle: 'active',
      summary: checkpointSnapshot.summary,
      statusText: checkpointSnapshot.statusText,
      snapshot: {
        appId: 'drawing-kit',
        checkpointId: 'drawing-kit-4200',
        caption: 'Triple pickle sandwich',
      },
    })

    const completed = applyReviewedAppLaunchBridgeEventToSession(activated, {
        messageId: 'assistant-reviewed-launch-drawing-1',
        part: activePart,
        event: {
          kind: 'app.complete',
          bridgeSessionId: 'bridge-session-reviewed-drawing-1',
          appInstanceId: 'reviewed-launch:tool-reviewed-launch-drawing-1',
          bridgeToken: 'bridge-token-reviewed-drawing-1',
          sequence: 3,
          idempotencyKey: 'complete-reviewed-drawing-3',
          completion: {
            schemaVersion: 1,
            status: 'success',
            suggestedSummary: {
              text: 'Drawing Kit round complete. Triple pickle sandwich and the llama sticker are saved for follow-up chat.',
            },
            resumability: {
              resumable: true,
              checkpointId: 'drawing-kit-4200',
              resumeHint: 'Play again reopens Dare 05 from checkpoint drawing-kit-4200.',
            },
          },
        },
        now: () => 23_000,
        createId: () => 'event-complete-reviewed-drawing-1',
      })

    const completedPart = getLaunchPart(completed, 'assistant-reviewed-launch-drawing-1')
    expect(completedPart).toMatchObject({
      lifecycle: 'complete',
      summary: 'Drawing Kit round complete. Triple pickle sandwich and the llama sticker are saved for follow-up chat.',
      summaryForModel:
        'Drawing Kit round complete. Triple pickle sandwich and the llama sticker are saved for follow-up chat.',
      snapshot: {
        checkpointId: 'drawing-kit-4200',
        caption: 'Triple pickle sandwich',
      },
    })
    expect(completed.chatBridgeAppRecords?.events).toHaveLength(4)
    expect(completed.chatBridgeAppRecords?.events.map((event) => event.kind)).toEqual([
      'instance.created',
      'bridge.ready',
      'state.updated',
      'completion.recorded',
    ])
  })
})

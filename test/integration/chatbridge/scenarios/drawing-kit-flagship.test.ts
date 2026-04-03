import '../setup'

import {
  createChatBridgeRuntimeCrashRecoveryContract,
  createDrawingKitAppSnapshot,
  readChatBridgeDegradedCompletion,
} from '@shared/chatbridge'
import { CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION } from '@shared/chatbridge/tools'
import type { CompactionPoint, Message, MessageAppPart, MessageToolCallPart, Session } from '@shared/types'
import { createMessage } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildContextForAI } from '@/packages/context-management/context-builder'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX } from '@/packages/chatbridge/context'
import {
  applyReviewedAppLaunchBootstrapToSession,
  applyReviewedAppLaunchBridgeEventToSession,
  applyReviewedAppLaunchBridgeReadyToSession,
  applyReviewedAppLaunchRecoveryToSession,
  upsertReviewedAppLaunchParts,
} from '@/packages/chatbridge/reviewed-app-launch'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

function createDrawingKitLaunchToolCallPart(): MessageToolCallPart {
  return {
    type: 'tool-call',
    state: 'result',
    toolCallId: 'tool-reviewed-launch-drawing-scenario-1',
    toolName: 'drawing_kit_open',
    args: {
      request: 'Open Drawing Kit and start a sticky-note doodle dare.',
    },
    result: {
      kind: 'chatbridge.host.tool.record.v1',
      toolName: 'drawing_kit_open',
      appId: 'drawing-kit',
      sessionId: 'session-reviewed-launch-drawing-scenario-1',
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
          summary: 'Prepared the reviewed Drawing Kit doodle dare for the host-owned launch path.',
          request: 'Open Drawing Kit and start a sticky-note doodle dare.',
        },
      },
    },
  }
}

function createSessionWithLaunchPart(): { session: Session; launchPart: MessageAppPart } {
  const assistantMessage = createMessage('assistant')
  assistantMessage.id = 'assistant-reviewed-drawing-scenario-1'
  assistantMessage.contentParts = upsertReviewedAppLaunchParts([createDrawingKitLaunchToolCallPart()])

  const launchPart = assistantMessage.contentParts.find(
    (part): part is MessageAppPart => part.type === 'app'
  )

  if (!launchPart) {
    throw new Error('Expected a reviewed Drawing Kit launch part.')
  }

  return {
    session: {
      id: 'session-reviewed-launch-drawing-scenario-1',
      name: 'Reviewed Drawing launch scenario',
      messages: [assistantMessage],
      settings: {},
    },
    launchPart,
  }
}

function getLaunchPart(session: Session): MessageAppPart {
  const message = session.messages.find((candidate) => candidate.id === 'assistant-reviewed-drawing-scenario-1')
  const launchPart = message?.contentParts.find((part): part is MessageAppPart => part.type === 'app')

  if (!launchPart) {
    throw new Error('Expected the Drawing Kit scenario to keep the launch part.')
  }

  return launchPart
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-drawing-kit-flagship',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['persistence', 'recovery'],
      storyId: 'CB-509',
    },
    testCase,
    execute
  )
}

describe('ChatBridge Drawing Kit flagship lifecycle', () => {
  it('injects a host-owned Drawing Kit summary for follow-up chat after the round is locked', () =>
    traceScenario('injects a host-owned Drawing Kit summary for follow-up chat after the round is locked', () => {
      const { session, launchPart } = createSessionWithLaunchPart()

      const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: launchPart,
        bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-1',
        now: () => 10_000,
        createId: () => 'event-reviewed-drawing-created-1',
      })

      const readied = applyReviewedAppLaunchBridgeReadyToSession(bootstrapped, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: getLaunchPart(bootstrapped),
        event: {
          kind: 'app.ready',
          bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-drawing-scenario-1',
          ackNonce: 'bridge-nonce-reviewed-drawing-scenario-1',
          sequence: 1,
        },
        now: () => 11_000,
        createId: () => 'event-reviewed-drawing-ready-1',
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
        lastUpdatedAt: 12_000,
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
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: getLaunchPart(readied),
        event: {
          kind: 'app.state',
          bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-drawing-scenario-1',
          sequence: 2,
          idempotencyKey: 'state-reviewed-drawing-scenario-2',
          snapshot: checkpointSnapshot,
        },
        now: () => 12_000,
        createId: () => 'event-reviewed-drawing-state-1',
      })

      const completed = applyReviewedAppLaunchBridgeEventToSession(activated, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: getLaunchPart(activated),
        event: {
          kind: 'app.complete',
          bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-1',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-drawing-scenario-1',
          sequence: 3,
          idempotencyKey: 'complete-reviewed-drawing-scenario-3',
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
        now: () => 13_000,
        createId: () => 'event-reviewed-drawing-complete-1',
      })

      const compactedSummary: Message = {
        id: 'summary-reviewed-drawing-scenario-1',
        role: 'assistant',
        timestamp: 14_000,
        isSummary: true,
        contentParts: [{ type: 'text', text: 'Compacted summary of earlier Drawing Kit activity.' }],
      }
      const followUp = createMessage('drawing-follow-up-user', 'user', 'What did I just draw?')
      const compactionPoints: CompactionPoint[] = [
        {
          summaryMessageId: compactedSummary.id,
          boundaryMessageId: 'assistant-reviewed-drawing-scenario-1',
          createdAt: 14_000,
        },
      ]

      const context = buildContextForAI({
        messages: [...completed.messages, followUp, compactedSummary],
        compactionPoints,
      })

      const injectedContext = context.find((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))
      expect(injectedContext?.contentParts[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Triple pickle sandwich'),
      })
      expect((injectedContext?.contentParts[0] as { text?: string } | undefined)?.text).toContain('llama sticker')
      expect((injectedContext?.contentParts[0] as { text?: string } | undefined)?.text).not.toContain('0.2')
      expect(getLaunchPart(completed)).toMatchObject({
        lifecycle: 'complete',
        summaryForModel:
          'Drawing Kit round complete. Triple pickle sandwich and the llama sticker are saved for follow-up chat.',
        snapshot: {
          checkpointId: 'drawing-kit-4200',
          caption: 'Triple pickle sandwich',
        },
      })
    }))

  it('keeps the last Drawing Kit checkpoint visible when the reviewed runtime crashes', () =>
    traceScenario('keeps the last Drawing Kit checkpoint visible when the reviewed runtime crashes', () => {
      const { session, launchPart } = createSessionWithLaunchPart()

      const bootstrapped = applyReviewedAppLaunchBootstrapToSession(session, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: launchPart,
        bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-2',
        now: () => 20_000,
        createId: () => 'event-reviewed-drawing-created-2',
      })

      const readied = applyReviewedAppLaunchBridgeReadyToSession(bootstrapped, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: getLaunchPart(bootstrapped),
        event: {
          kind: 'app.ready',
          bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-2',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-drawing-scenario-2',
          ackNonce: 'bridge-nonce-reviewed-drawing-scenario-2',
          sequence: 1,
        },
        now: () => 21_000,
        createId: () => 'event-reviewed-drawing-ready-2',
      })

      const checkpointSnapshot = createDrawingKitAppSnapshot({
        request: 'Open Drawing Kit and start a sticky-note doodle dare.',
        roundLabel: 'Dare 05',
        roundPrompt: 'Draw the weirdest sandwich.',
        rewardLabel: 'Llama sticker',
        caption: 'Crooked sandwich tower',
        selectedTool: 'brush',
        status: 'checkpointed',
        strokeCount: 4,
        stickerCount: 1,
        checkpointId: 'drawing-kit-9900',
        lastUpdatedAt: 22_000,
      })

      const activated = applyReviewedAppLaunchBridgeEventToSession(readied, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: getLaunchPart(readied),
        event: {
          kind: 'app.state',
          bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-2',
          appInstanceId: launchPart.appInstanceId,
          bridgeToken: 'bridge-token-reviewed-drawing-scenario-2',
          sequence: 2,
          idempotencyKey: 'state-reviewed-drawing-scenario-4',
          snapshot: checkpointSnapshot,
        },
        now: () => 22_000,
        createId: () => 'event-reviewed-drawing-state-2',
      })

      const recovered = applyReviewedAppLaunchRecoveryToSession(activated, {
        messageId: 'assistant-reviewed-drawing-scenario-1',
        part: getLaunchPart(activated),
        contract: createChatBridgeRuntimeCrashRecoveryContract({
          appId: 'drawing-kit',
          appName: 'Drawing Kit',
          appInstanceId: launchPart.appInstanceId,
          bridgeSessionId: 'bridge-session-reviewed-drawing-scenario-2',
          error: 'Canvas worker crashed while banking the round.',
        }),
        now: () => 23_000,
        createId: () => 'event-reviewed-drawing-recovery-1',
      })

      const recoveredPart = getLaunchPart(recovered)
      expect(recoveredPart).toMatchObject({
        lifecycle: 'error',
        statusText: 'Runtime crash',
        error: 'Drawing Kit crashed, but the conversation can continue from preserved host-owned context.',
        snapshot: {
          checkpointId: 'drawing-kit-9900',
          caption: 'Crooked sandwich tower',
        },
      })
      expect(readChatBridgeDegradedCompletion(recoveredPart)).toMatchObject({
        kind: 'runtime-error',
        statusLabel: 'Runtime crash',
        actions: [
          { id: 'continue-in-chat', label: 'Continue safely' },
          { id: 'dismiss-runtime', label: 'Dismiss runtime' },
        ],
      })
    }))
})

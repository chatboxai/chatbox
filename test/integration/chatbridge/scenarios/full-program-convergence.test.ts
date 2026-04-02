import '../setup'

import type { ModelMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import {
  type ChatBridgeAppAuthGrant,
  ChatBridgeAppAuthGrantSchema,
  CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
  ChatBridgeStoryBuilderStateSchema,
  applyChatBridgeAppKillSwitch,
  clearChatBridgeObservabilityState,
  clearReviewedAppRegistry,
  defineReviewedApps,
  evaluateReviewedAppActiveSessionDisposition,
  getChatBridgeStoryBuilderSummaryForModel,
  listChatBridgeObservabilityEvents,
  validateChatBridgePartnerManifest,
  type ReviewedAppCatalogEntry,
} from '@shared/chatbridge'
import type { Message, StreamTextResult } from '@shared/types'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX } from '@/packages/chatbridge/context'
import { buildContextForSession } from '@/packages/context-management/context-builder'
import { getReviewedAppRouteDecision } from '@/packages/chatbridge/router'
import { streamText } from '@/packages/model-calls/stream-text'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { createChatBridgeAuthBroker } from 'src/main/chatbridge/auth-broker'
import { createChatBridgeResourceProxy } from 'src/main/chatbridge/resource-proxy'
import {
  buildChatBridgeChessMidGameSessionFixture,
  buildMultiAppContinuitySessionFixture,
} from '../fixtures/app-aware-session'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'
import { createChatBridgePartnerHarness } from '../mocks/partner-harness'

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

function createModelStub() {
  const chat = vi.fn(
    async (_messages: ModelMessage[], _options: CallChatCompletionOptions): Promise<StreamTextResult> => ({
      contentParts: [{ type: 'text', text: 'convergence-audit reply' }],
    })
  )

  const model: ModelInterface = {
    name: 'Test ChatBridge Model',
    modelId: 'test-chatbridge-model',
    isSupportVision: () => true,
    isSupportToolUse: () => false,
    isSupportSystemMessage: () => true,
    chat,
    paint: vi.fn(async () => []),
  }

  return {
    chat,
    model,
  }
}

function getInjectedSystemPrompt(coreMessages: ModelMessage[]) {
  const systemMessage = coreMessages.find((message) => message.role === 'system')
  expect(systemMessage).toBeDefined()
  expect(typeof systemMessage?.content).toBe('string')
  return systemMessage?.content as string
}

function createStoryBuilderGrant(): ChatBridgeAppAuthGrant {
  return ChatBridgeAppAuthGrantSchema.parse({
    schemaVersion: 1,
    grantId: 'grant-story-builder-1',
    userId: 'student-1',
    appId: 'story-builder',
    authMode: 'oauth',
    permissionIds: ['drive.read', 'drive.write'],
    credentialHandle: 'grant-handle-1',
    status: 'granted',
    createdAt: 100,
    updatedAt: 120,
    expiresAt: 10_000,
  })
}

function createConvergenceCatalog(): ReviewedAppCatalogEntry[] {
  return [
    createReviewedAppCatalogEntryFixture({
      manifest: {
        appId: 'chess',
        name: 'Chess',
        version: '0.1.0',
        uiEntry: 'https://apps.example.com/chess',
        authMode: 'host-session',
        permissions: [
          {
            id: 'session.context.read',
            resource: 'chat.session',
            access: 'read',
            required: true,
            purpose: 'Prepare a reviewed Chess session from the current conversation context.',
          },
        ],
        toolSchemas: [
          {
            name: 'chess_prepare_session',
            title: 'Prepare Chess Session',
            description:
              'Prepare a reviewed Chess session for chess, FEN, PGN, opening, board, and move-analysis requests.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                request: { type: 'string' },
                fen: { type: 'string' },
                pgn: { type: 'string' },
              },
              required: ['request'],
            },
          },
        ],
        supportedEvents: ['host.init', 'host.invokeTool', 'app.ready', 'app.state', 'app.complete', 'app.error'],
        completionModes: ['summary', 'state'],
        safetyMetadata: {
          reviewed: true,
          sandbox: 'hosted-iframe',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
      },
      approval: {
        catalogVersion: 4,
      },
    }),
    createReviewedAppCatalogEntryFixture({
      manifest: {
        appId: 'debate-arena',
        name: 'Debate Arena',
        version: '1.0.0',
        uiEntry: 'https://apps.example.com/debate-arena',
        authMode: 'none',
        permissions: [],
        toolSchemas: [
          {
            name: 'debate_arena_round',
            title: 'Launch Debate Round',
            description: 'Open a debate round and draft claims, rebuttals, or opening statements.',
            schemaVersion: 1,
            inputSchema: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
              },
              required: ['topic'],
            },
          },
        ],
        supportedEvents: ['host.init', 'app.ready', 'app.state', 'app.complete'],
        completionModes: ['summary', 'handoff'],
        safetyMetadata: {
          reviewed: true,
          sandbox: 'hosted-iframe',
          handlesStudentData: false,
          requiresTeacherApproval: false,
        },
        tenantAvailability: {
          default: 'enabled',
          allow: [],
          deny: [],
        },
      },
      approval: {
        catalogVersion: 4,
      },
    }),
    createReviewedAppCatalogEntryFixture(),
  ]
}

describe('ChatBridge full-program convergence audit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    queryClient.clear()
    clearReviewedAppRegistry()
    clearChatBridgeObservabilityState()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    queryClient.clear()
    clearReviewedAppRegistry()
    clearChatBridgeObservabilityState()
  })

  it('proves routing, flagship continuity, and authenticated Story Builder completion compose into one governed product', async () => {
    defineReviewedApps(createConvergenceCatalog())

    const chessRoute = getReviewedAppRouteDecision({
      promptInput:
        'Open Chess and analyze this FEN r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['session.context.read', 'drive.read', 'drive.write'],
      },
    })
    expect(chessRoute.decision).toMatchObject({
      kind: 'invoke',
      selectedAppId: 'chess',
      reasonCode: 'explicit-app-match',
    })

    const debateRoute = getReviewedAppRouteDecision({
      promptInput: 'Help me draft an opening statement for class.',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['drive.read', 'drive.write'],
      },
    })
    expect(debateRoute.decision.kind).toBe('clarify')
    expect(debateRoute.decision.matches.map((match) => match.appId)).toEqual(
      expect.arrayContaining(['debate-arena', 'story-builder'])
    )

    const storyRoute = getReviewedAppRouteDecision({
      promptInput: 'Open Story Builder and continue my outline.',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['drive.read', 'drive.write'],
      },
    })
    expect(storyRoute.decision).toMatchObject({
      kind: 'invoke',
      selectedAppId: 'story-builder',
      reasonCode: 'explicit-app-match',
    })

    const chessFixture = buildChatBridgeChessMidGameSessionFixture()
    const { chat, model } = createModelStub()
    const chessResult = await streamText(model, {
      sessionId: 'session-chess-convergence',
      messages: chessFixture.messages,
      onResultChangeWithCancel: vi.fn(),
    })

    expect(chat).toHaveBeenCalledOnce()
    const chessSystemPrompt = getInjectedSystemPrompt(chessResult.coreMessages)
    expect(chessSystemPrompt).toContain('ChatBridge active Chess context (host-owned and normalized):')
    expect(chessSystemPrompt).toContain('Context state: live')
    expect(chessSystemPrompt).toContain('Board FEN: r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6')
    expect(chessSystemPrompt).toContain('Use only this bounded host summary for position-specific chess advice.')

    const createdSession = await chatStore.createSession(buildMultiAppContinuitySessionFixture())
    queryClient.clear()
    const reloadedSession = await chatStore.getSession(createdSession.id)

    expect(reloadedSession).not.toBeNull()

    const continuityContext = buildContextForSession(reloadedSession!)
    const continuityMessages = continuityContext.filter((message) =>
      message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX)
    )

    expect(continuityMessages).toHaveLength(2)
    expect((continuityMessages[0].contentParts[0] as { text: string }).text).toContain('Debate Arena')
    expect((continuityMessages[0].contentParts[0] as { text: string }).text).toContain('Priority: Primary active app context')
    expect((continuityMessages[1].contentParts[0] as { text: string }).text).toContain('Story Builder')
    expect((continuityMessages[1].contentParts[0] as { text: string }).text).toContain(
      'Priority: Recent completed app context'
    )

    const broker = createChatBridgeAuthBroker({
      now: () => 500,
      createId: () => 'story-builder-handle-1',
    })
    const launch = broker.authorizeAppLaunch({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [createStoryBuilderGrant()],
      permissionIds: ['drive.read', 'drive.write'],
    })

    expect(launch).toMatchObject({
      authorized: true,
      grantedCapability: 'credential-handle',
    })
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => 550,
    })
    proxy.registerAction(
      {
        appId: 'story-builder',
        resource: 'drive',
        action: 'drive.readDraft',
        permissionId: 'drive.read',
        description: 'Read the latest Story Builder draft from Drive.',
        inputSchema: {
          type: 'object',
          properties: {
            draftId: { type: 'string' },
          },
          required: ['draftId'],
        },
      },
      ({ payload }) => ({
        draftId: payload.draftId,
        checkpointId: 'draft-42',
        excerpt:
          'Mara tucked the lantern beneath the library desk and counted the sirens again before she dared to breathe.',
      })
    )
    proxy.registerAction(
      {
        appId: 'story-builder',
        resource: 'drive',
        action: 'drive.saveDraft',
        permissionId: 'drive.write',
        description: 'Save the latest Story Builder draft through the host-managed proxy.',
        inputSchema: {
          type: 'object',
          properties: {
            draftId: { type: 'string' },
            wordCount: { type: 'number' },
          },
          required: ['draftId', 'wordCount'],
        },
      },
      ({ payload }) => ({
        draftId: payload.draftId,
        checkpointId: 'draft-43',
        savedAtLabel: 'Just now',
        wordCount: payload.wordCount,
      })
    )

    const readResponse = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-read-1',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-42',
      },
    })
    expect(readResponse).toMatchObject({
      status: 'success',
      audit: {
        outcome: 'granted',
        permissionId: 'drive.read',
      },
    })

    const saveResponse = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-save-1',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.saveDraft',
      payload: {
        draftId: 'draft-42',
        wordCount: 1048,
      },
    })
    expect(saveResponse).toMatchObject({
      status: 'success',
      result: {
        checkpointId: 'draft-43',
        wordCount: 1048,
      },
      audit: {
        outcome: 'granted',
        permissionId: 'drive.write',
      },
    })
    expect(JSON.stringify(saveResponse)).not.toContain('accessToken')
    expect(JSON.stringify(saveResponse)).not.toContain('refreshToken')

    const completionState = ChatBridgeStoryBuilderStateSchema.parse({
      schemaVersion: 1,
      mode: 'complete',
      drive: {
        provider: 'google-drive',
        status: 'connected',
        statusLabel: 'Drive synced',
        detail: 'The finished draft and checkpoint trail are saved in the host-approved Drive folder.',
        connectedAs: 'student.writer@example.edu',
        folderLabel: 'Creative Writing / Chapter 4',
        lastSyncedLabel: String(saveResponse.result.savedAtLabel),
      },
      draft: {
        title: 'Storm Lantern',
        chapterLabel: 'Chapter 4',
        summary: 'The completed chapter draft is back in chat with the latest checkpoint and next revision cue.',
        excerpt:
          'When the lights returned, Mara lifted the lantern from beneath the desk and saw her own reflection in the wet brass.',
        wordCount: Number(saveResponse.result.wordCount),
        saveState: 'saved',
        saveLabel: 'Final draft saved to Drive',
      },
      checkpoints: [
        {
          checkpointId: String(saveResponse.result.checkpointId),
          label: 'Final checkpoint',
          description: 'Completed chapter pass with resolved lantern reveal.',
          savedAtLabel: String(saveResponse.result.savedAtLabel),
          status: 'latest',
          locationLabel: 'Creative Writing / Chapter 4',
        },
      ],
      completion: {
        title: 'Draft returned to chat',
        description: 'The host preserved the completed chapter, Drive save, and revision cue for the next conversation turn.',
        handoffLabel: 'Ask for revision notes or continue with chapter five.',
        nextStepLabel: 'Continue the writing session from the final checkpoint if you want another pass.',
      },
    })

    const completionSummary = getChatBridgeStoryBuilderSummaryForModel(
      {
        appId: 'story-builder',
        appName: 'Story Builder',
      },
      completionState
    )
    expect(completionSummary).toContain('Story Builder completed Chapter 4 and handed the draft back to chat.')
    expect(completionSummary).toContain('Ask for revision notes or continue with chapter five.')
  })

  it('keeps policy denial, auth expiry, and partner runtime failures bounded to the host control plane', async () => {
    const catalog = createConvergenceCatalog()
    defineReviewedApps(catalog)

    applyChatBridgeAppKillSwitch({
      controlId: 'control-story-builder',
      appId: 'story-builder',
      version: '1.2.3',
      reason: 'Rollback after a partner regression.',
      disabledAt: 150,
      disabledBy: 'ops-oncall',
      activeSessionBehavior: 'allow-to-complete',
    })

    const refusedRoute = getReviewedAppRouteDecision({
      promptInput: 'Open Story Builder and continue my outline.',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['drive.read', 'drive.write'],
      },
    })

    const storyBuilderExclusion = refusedRoute.catalog.excluded.find(
      (decision) => decision.entry.manifest.appId === 'story-builder'
    )
    expect(storyBuilderExclusion?.reasons.map((reason) => reason.code)).toContain('app-version-disabled')
    expect(refusedRoute.decision).toMatchObject({
      kind: 'refuse',
    })
    expect(
      evaluateReviewedAppActiveSessionDisposition({
        appId: 'story-builder',
        version: '1.2.3',
        appName: 'Story Builder',
      })
    ).toMatchObject({
      action: 'continue',
    })
    expect(listChatBridgeObservabilityEvents({ appId: 'story-builder', version: '1.2.3' }).map((event) => event.kind)).toEqual([
      'kill-switch-applied',
    ])

    let currentNow = 500
    const broker = createChatBridgeAuthBroker({
      now: () => currentNow,
      createId: () => 'story-builder-handle-2',
    })
    const launch = broker.authorizeAppLaunch({
      userId: 'student-1',
      appId: 'story-builder',
      authMode: 'oauth',
      grants: [createStoryBuilderGrant()],
      permissionIds: ['drive.read'],
    })
    expect(launch.authorized).toBe(true)
    if (!launch.authorized || !launch.credentialHandle) {
      return
    }

    const proxy = createChatBridgeResourceProxy({
      validator: broker,
      now: () => currentNow,
    })
    proxy.registerAction(
      {
        appId: 'story-builder',
        resource: 'drive',
        action: 'drive.readDraft',
        permissionId: 'drive.read',
        description: 'Read a Story Builder draft from Drive.',
        inputSchema: {
          type: 'object',
          properties: {
            draftId: { type: 'string' },
          },
          required: ['draftId'],
        },
      },
      ({ payload }) => ({
        draftId: payload.draftId,
      })
    )

    currentNow = 1_000_000
    const expiredResponse = await proxy.execute({
      schemaVersion: 1,
      requestId: 'request-expired-1',
      handleId: launch.credentialHandle.handleId,
      userId: 'student-1',
      appId: 'story-builder',
      resource: 'drive',
      action: 'drive.readDraft',
      payload: {
        draftId: 'draft-42',
      },
    })
    expect(expiredResponse).toMatchObject({
      status: 'denied',
      errorCode: 'expired-handle',
    })
    expect(JSON.stringify(expiredResponse)).not.toContain('accessToken')
    expect(JSON.stringify(expiredResponse)).not.toContain('refreshToken')

    const storyBuilderEntry = catalog.find((entry) => entry.manifest.appId === 'story-builder')
    expect(storyBuilderEntry).toBeDefined()
    const report = validateChatBridgePartnerManifest(storyBuilderEntry!)
    expect(report.valid).toBe(true)
    expect(report.guidance?.authBoundary).toMatchObject({
      appGrantRequired: true,
      requiresHostMediatedAccess: true,
    })

    const harness = createChatBridgePartnerHarness({
      appId: 'story-builder',
      appName: 'Story Builder',
      appVersion: '1.2.3',
      appInstanceId: 'partner-instance-1',
      expectedOrigin: 'https://apps.example.com',
      capabilities: ['render-html-preview'],
      createIds: ['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1'],
      now: () => 2_000,
    })

    const readyPromise = harness.waitForReady()
    harness.sendAppEvent({
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      bridgeToken: 'bridge-token-1',
      ackNonce: 'bridge-nonce-1',
      sequence: 1,
    })
    await readyPromise

    harness.sendAppEvent({
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'state-2',
      snapshot: {
        route: '/drafts/draft-42',
      },
    })
    harness.sendAppEvent({
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'state-3',
      snapshot: {
        route: '/drafts/draft-42',
      },
    })
    harness.sendAppEvent({
      kind: 'app.complete',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 3,
      idempotencyKey: 'state-2',
      completion: {
        schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
        status: 'success',
      },
    })

    expect(harness.rejectedAppEvents.map((event) => event.reason)).toEqual([
      'replayed-sequence',
      'duplicate-idempotency-key',
    ])
    expect(harness.recoveryDecisions.map((decision) => decision.failureClass)).toEqual([
      'bridge-protocol-rejection',
      'bridge-protocol-rejection',
    ])
    expect(harness.observabilityEvents.map((event) => event.kind)).toEqual([
      'session-attached',
      'session-ready',
      'app-event-accepted',
      'app-event-rejected',
      'recovery-required',
      'app-event-rejected',
      'recovery-required',
    ])
  })
})

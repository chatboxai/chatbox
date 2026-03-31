import type { ModelMessage, ToolExecutionOptions } from 'ai'
import * as ls from 'langsmith/vitest'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { createBridgeHostController } from '@/packages/chatbridge/bridge/host-controller'
import {
  createChatBridgeAppRecordStore,
  hydrateChatBridgeAppRecordState,
  selectLatestChatBridgeAppEvent,
} from '@/packages/chatbridge/app-records'
import { createReviewedSingleAppToolSet } from '@/packages/chatbridge/single-app-tools'
import platform from '@/platform'
import type TestPlatform from '@/platform/test_platform'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { exportSessionChat } from '@/stores/session/export'
import { switchThread } from '@/stores/session/threads'
import { streamText } from '@/packages/model-calls/stream-text'
import {
  CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
  clearReviewedAppRegistry,
  createChatBridgeHostTool,
  defineReviewedApps,
  getChatBridgeHostToolPartUpdate,
  getReviewedApp,
  getReviewedAppCatalog,
} from '@shared/chatbridge'
import { createMessage } from '@shared/types'
import type { Message, MessageAppPart, MessageToolCallPart, StreamTextResult } from '@shared/types'
import type { ModelInterface } from '@shared/models/types'
import type { CallChatCompletionOptions } from '@shared/models/types'
import { prepareToolsForExecution } from '@/packages/model-calls/stream-text'
import { z } from 'zod'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'
import {
  buildAppAwareSessionFixture,
  buildChatBridgeChessMidGameSessionFixture,
  buildPartialLifecycleSessionFixture,
  createAppLifecycleMessage,
} from '../fixtures/app-aware-session'
import { runChatBridgeEvalScenario } from './scenario-runner'
import {
  createDeterministicIds,
  createMessageChannel,
  MockMessagePort,
} from './test-utils'

const testPlatform = platform as TestPlatform

function getToolCall(message: { contentParts: Array<{ type: string }> }): MessageToolCallPart {
  const toolCall = message.contentParts.find((part) => part.type === 'tool-call')
  expect(toolCall).toBeDefined()
  return toolCall as MessageToolCallPart
}

function getAppPart(message: { contentParts: Array<{ type: string }> }): MessageAppPart {
  const appPart = message.contentParts.find((part) => part.type === 'app')
  expect(appPart).toBeDefined()
  return appPart as MessageAppPart
}

function createTextMessage(id: string, role: Message['role'], text: string, timestamp: number): Message {
  return {
    id,
    role,
    timestamp,
    contentParts: [{ type: 'text', text }],
  }
}

function createModelStub() {
  const chat = vi.fn(async (_messages: ModelMessage[], _options: CallChatCompletionOptions): Promise<StreamTextResult> => ({
    contentParts: [{ type: 'text', text: 'board-aware reply' }],
  }))

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

function getExecutionOptions(toolCallId: string): ToolExecutionOptions {
  return {
    toolCallId,
    messages: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  testPlatform.clear()
  clearReviewedAppRegistry()
})

afterEach(() => {
  queryClient.clear()
  testPlatform.clear()
  clearReviewedAppRegistry()
  vi.useRealTimers()
})

ls.describe('ChatBridge EDD recompleted story coverage', () => {
  ls.test(
    'recompletes CB-102, CB-103, and CB-104 with durable shell artifacts and continuity evidence',
    {
      inputs: {
        storyIds: ['CB-102', 'CB-103', 'CB-104'],
        scenarioId: 'chatbridge-persistence-and-shell-artifacts',
      },
      referenceOutputs: {
        activeLifecycle: 'active',
        staleLifecycle: 'stale',
        exportedFormatCount: 3,
      },
    },
    async ({ referenceOutputs }) => {
      vi.useFakeTimers()

      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-persistence-and-shell-artifacts',
        storyIds: ['CB-102', 'CB-103', 'CB-104'],
        traceSteps: false,
        outputs: (result) => result,
        run: async ({ record, step }) => {
          const fixture = buildAppAwareSessionFixture()
          const createdSession = await step('session.createFixtureSession', {}, async () =>
            chatStore.createSession(fixture.sessionInput)
          )

          queryClient.clear()
          const reloadedSession = await step('session.reloadPersistedState', {}, async () =>
            chatStore.getSession(createdSession.id)
          )

          expect(reloadedSession).not.toBeNull()
          expect(reloadedSession?.messages.map((message) => message.id)).toEqual(fixture.currentMessageIds)
          expect(reloadedSession?.threads?.map((thread) => thread.id)).toEqual([fixture.historyThread.id])

          const currentToolCall = getToolCall(reloadedSession!.messages[2])
          const currentAppPart = getAppPart(reloadedSession!.messages[2])

          expect(currentAppPart).toMatchObject({
            lifecycle: 'active',
            summary: 'Restored the active story draft and preserved the exportable checkpoint.',
          })
          expect(currentToolCall).toMatchObject({
            toolName: 'chatbridge_app_state',
            state: 'result',
          })

          record('session.reloaded', {
            messageCount: reloadedSession?.messages.length ?? 0,
            historyThreadCount: reloadedSession?.threads?.length ?? 0,
          })

          await step('thread.switchHistory', {}, async () => {
            await switchThread(createdSession.id, fixture.historyThread.id)
            vi.runOnlyPendingTimers()
          })

          queryClient.clear()
          const switchedSession = await chatStore.getSession(createdSession.id)
          expect(switchedSession?.messages.map((message) => message.id)).toEqual(fixture.historyMessageIds)
          expect(switchedSession?.threads?.[0].messages.map((message) => message.id)).toEqual(
            fixture.currentMessageIds
          )

          await step('session.exportAllFormats', {}, async () => {
            await exportSessionChat(createdSession.id, 'all_threads', 'Markdown')
            await exportSessionChat(createdSession.id, 'all_threads', 'TXT')
            await exportSessionChat(createdSession.id, 'all_threads', 'HTML')
          })

          const markdown = testPlatform.exporter.getExport('ChatBridge Story Session.md') as string
          const text = testPlatform.exporter.getExport('ChatBridge Story Session.txt') as string
          const html = testPlatform.exporter.getExport('ChatBridge Story Session.html') as string

          expect(markdown).toContain('Tool Call: chatbridge_app_state (state: result)')
          expect(text).toContain('story-builder-state.json')
          expect(html).toContain('chatbridge_app_state')

          const partialSession = await step('session.createPartialLifecycleFixture', {}, async () =>
            chatStore.createSession(buildPartialLifecycleSessionFixture())
          )

          queryClient.clear()
          const partialReload = await chatStore.getSession(partialSession.id)
          const partialAppPart = getAppPart(partialReload!.messages[1])
          const partialToolCall = getToolCall(partialReload!.messages[1])
          expect(partialAppPart).toMatchObject({
            lifecycle: 'stale',
          })
          expect(partialToolCall.result).toBeUndefined()

          record('session.partialLifecycleVerified', {
            lifecycle: partialAppPart.lifecycle,
          })

          return {
            activeLifecycle: currentAppPart.lifecycle,
            staleLifecycle: partialAppPart.lifecycle,
            exportedFormatCount: 3,
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      expect(evalRun.localLogPath).toContain('test/output/chatbridge-edd')
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )

  ls.test(
    'recompletes CB-201 with a traced reviewed-app registry acceptance and rejection path',
    {
      inputs: {
        storyIds: ['CB-201'],
        scenarioId: 'chatbridge-reviewed-app-registry',
      },
      referenceOutputs: {
        acceptedCatalogCount: 2,
        unsupportedProtocolRejected: true,
      },
    },
    async ({ referenceOutputs }) => {
      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-reviewed-app-registry',
        storyIds: ['CB-201'],
        outputs: (result) => result,
        run: async ({ record, step }) => {
          const baseFixture = createReviewedAppCatalogEntryFixture()
          const mathLab = createReviewedAppCatalogEntryFixture({
            manifest: {
              ...baseFixture.manifest,
              appId: 'math-lab',
              name: 'Math Lab',
              uiEntry: 'https://apps.example.com/math-lab',
              toolSchemas: [
                {
                  name: 'math_lab_start',
                  description: 'Launch a reviewed math activity.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      lessonId: { type: 'string' },
                    },
                    required: ['lessonId'],
                  },
                },
              ],
            },
          })

          const catalog = await step('registry.defineReviewedApps', { appIds: ['story-builder', 'math-lab'] }, async () =>
            defineReviewedApps([baseFixture, mathLab])
          )

          expect(catalog.map((entry) => entry.manifest.appId)).toEqual(['story-builder', 'math-lab'])
          expect(getReviewedApp('story-builder')).toMatchObject({
            manifest: {
              authMode: 'oauth',
            },
          })
          expect(getReviewedAppCatalog()).toHaveLength(2)

          record('registry.acceptedCatalog', {
            catalogSize: catalog.length,
          })

          let unsupportedProtocolRejected = false

          await step('registry.rejectUnsupportedProtocolVersion', { protocolVersion: 2 }, async () => {
            const unsupportedEntry = createReviewedAppCatalogEntryFixture({
              manifest: {
                ...baseFixture.manifest,
                appId: 'broken-story-builder',
                protocolVersion: 2,
              },
            })

            expect(() => defineReviewedApps([baseFixture, unsupportedEntry])).toThrowError(
              /Unsupported ChatBridge protocol version/
            )
            unsupportedProtocolRejected = true
          })

          expect(getReviewedAppCatalog()).toHaveLength(2)

          return {
            acceptedCatalogCount: catalog.length,
            unsupportedProtocolRejected,
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )

  ls.test(
    'recompletes CB-202 with a traced host-owned lifecycle record stream that survives hydration',
    {
      inputs: {
        storyIds: ['CB-202'],
        scenarioId: 'chatbridge-app-instance-domain-model',
      },
      referenceOutputs: {
        finalStatus: 'complete',
        finalEventKind: 'completion.recorded',
      },
    },
    async ({ referenceOutputs }) => {
      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-app-instance-domain-model',
        storyIds: ['CB-202'],
        outputs: (result) => result,
        run: async ({ record, step }) => {
          let currentTime = 10_000
          const nextTime = () => {
            currentTime += 100
            return currentTime
          }

          const recordStore = createChatBridgeAppRecordStore({
            now: () => currentTime,
            createId: createDeterministicIds([
              'event-created',
              'event-ready',
              'event-render',
              'event-state',
              'event-complete',
            ]),
          })

          const instance = recordStore.createInstance({
            id: 'app-instance-1',
            appId: 'artifact-preview',
            appVersion: '1.0.0',
            owner: {
              authority: 'host',
              conversationSessionId: 'session-bridge-1',
              initiatedBy: 'assistant',
            },
            resumability: {
              mode: 'restartable',
              reason: 'The preview can be regenerated from chat context.',
            },
            createdAt: currentTime,
          })

          const controller = createBridgeHostController({
            appId: 'artifact-preview',
            appInstanceId: instance.id,
            expectedOrigin: 'https://artifact-preview.chatboxai.app',
            capabilities: ['render-html-preview'],
            createMessageChannel,
            createId: createDeterministicIds([
              'bridge-session-1',
              'bridge-token-1',
              'bridge-nonce-1',
              'render-1',
            ]),
            now: () => currentTime,
            onAcceptedAppEvent: (event) => {
              currentTime = nextTime()
              const result = recordStore.recordBridgeEvent(event, currentTime)
              expect(result.accepted).toBe(true)
            },
          })

          let appPort: MockMessagePort | null = null
          controller.attach({
            postMessage(_message, _targetOrigin, transfer) {
              appPort = transfer?.[0] as MockMessagePort
            },
          })

          const readyEvent = {
            kind: 'app.ready',
            bridgeSessionId: 'bridge-session-1',
            appInstanceId: 'app-instance-1',
            bridgeToken: 'bridge-token-1',
            ackNonce: 'bridge-nonce-1',
            sequence: 1,
          } as const

          await step('app.readyEventAccepted', {}, async () => {
            appPort?.postMessage(readyEvent)
            await controller.waitForReady()
            currentTime = nextTime()
            const readyResult = recordStore.recordBridgeEvent(readyEvent, currentTime)
            expect(readyResult.accepted).toBe(true)
          })

          await step('host.renderAndLifecycleProgression', {}, async () => {
            currentTime = nextTime()
            const renderResult = recordStore.recordHostEvent({
              appInstanceId: 'app-instance-1',
              kind: 'render.requested',
              nextStatus: 'ready',
              bridgeSessionId: controller.getSession().envelope.bridgeSessionId,
              createdAt: currentTime,
              payload: {
                renderId: 'render-1',
              },
            })
            expect(renderResult.accepted).toBe(true)
            controller.renderHtml('<html><body><h1>Hello bridge</h1></body></html>')
          })

          await step('app.stateAndCompletionRecorded', {}, async () => {
            appPort?.postMessage({
              kind: 'app.state',
              bridgeSessionId: 'bridge-session-1',
              appInstanceId: 'app-instance-1',
              bridgeToken: 'bridge-token-1',
              sequence: 2,
              idempotencyKey: 'state-2',
              snapshot: {
                route: '/preview',
                rendered: true,
              },
            })

            appPort?.postMessage({
              kind: 'app.complete',
              bridgeSessionId: 'bridge-session-1',
              appInstanceId: 'app-instance-1',
              bridgeToken: 'bridge-token-1',
              sequence: 3,
              idempotencyKey: 'complete-3',
              result: {
                status: 'complete',
                artifactId: 'artifact-1',
              },
            })
          })

          const snapshot = recordStore.snapshot()
          const hydrated = hydrateChatBridgeAppRecordState(snapshot)
          const latestEvent = selectLatestChatBridgeAppEvent(hydrated, 'app-instance-1')
          const storedInstance = recordStore.getInstance('app-instance-1')

          expect(storedInstance).toMatchObject({
            status: 'complete',
          })
          expect(latestEvent).toMatchObject({
            kind: 'completion.recorded',
          })

          record('app-records.hydrated', {
            eventCount: snapshot.events.length,
            finalStatus: storedInstance?.status ?? 'missing',
          })

          return {
            finalStatus: storedInstance?.status ?? 'missing',
            finalEventKind: latestEvent?.kind ?? 'missing',
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )

  ls.test(
    'recompletes CB-203 with a traced bridge handshake and replay rejection path',
    {
      inputs: {
        storyIds: ['CB-203'],
        scenarioId: 'chatbridge-bridge-handshake',
      },
      referenceOutputs: {
        readyTraceSeen: true,
        rejectionCount: 2,
      },
    },
    async ({ referenceOutputs }) => {
      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-bridge-handshake',
        storyIds: ['CB-203'],
        outputs: (result) => result,
        run: async ({ record, step }) => {
          const traces: string[] = []
          const rejectedReasons: string[] = []

          const controller = createBridgeHostController({
            appId: 'artifact-preview',
            appInstanceId: 'app-instance-1',
            expectedOrigin: 'https://artifact-preview.chatboxai.app',
            capabilities: ['render-html-preview'],
            createMessageChannel,
            createId: createDeterministicIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1', 'render-1']),
            now: () => 10_000,
            onTrace: (trace) => traces.push(trace.type),
            onRejectedAppEvent: (_event, reason) => rejectedReasons.push(reason),
          })

          let bootstrapMessage: unknown
          let transferredPort: MockMessagePort | null = null
          controller.attach({
            postMessage(message, _targetOrigin, transfer) {
              bootstrapMessage = message
              transferredPort = transfer?.[0] as MockMessagePort
            },
          })

          expect(bootstrapMessage).toBeTruthy()
          expect(transferredPort).toBeTruthy()

          await step('bridge.acceptReadyAndRender', {}, async () => {
            transferredPort?.postMessage({
              kind: 'app.ready',
              bridgeSessionId: 'bridge-session-1',
              appInstanceId: 'app-instance-1',
              bridgeToken: 'bridge-token-1',
              ackNonce: 'bridge-nonce-1',
              sequence: 1,
            })

            await controller.waitForReady()
            controller.renderHtml('<html><body><h1>Hello bridge</h1></body></html>')
          })

          await step('bridge.rejectReplayAndDuplicateIdempotency', {}, async () => {
            transferredPort?.postMessage({
              kind: 'app.state',
              bridgeSessionId: 'bridge-session-1',
              appInstanceId: 'app-instance-1',
              bridgeToken: 'bridge-token-1',
              sequence: 2,
              idempotencyKey: 'state-2',
              snapshot: { route: '/preview' },
            })
            transferredPort?.postMessage({
              kind: 'app.state',
              bridgeSessionId: 'bridge-session-1',
              appInstanceId: 'app-instance-1',
              bridgeToken: 'bridge-token-1',
              sequence: 2,
              idempotencyKey: 'state-3',
              snapshot: { route: '/preview' },
            })
            transferredPort?.postMessage({
              kind: 'app.complete',
              bridgeSessionId: 'bridge-session-1',
              appInstanceId: 'app-instance-1',
              bridgeToken: 'bridge-token-1',
              sequence: 3,
              idempotencyKey: 'state-2',
              result: { status: 'complete' },
            })
          })

          record('bridge.traceSummary', {
            traces,
            rejectedReasons,
          })

          expect(traces).toContain('session.ready')
          expect(rejectedReasons).toEqual(['replayed-sequence', 'duplicate-idempotency-key'])

          return {
            readyTraceSeen: traces.includes('session.ready'),
            rejectionCount: rejectedReasons.length,
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )

  ls.test(
    'recompletes CB-204 with a traced host-coordinated tool record flowing through stream-text preparation',
    {
      inputs: {
        storyIds: ['CB-204'],
        scenarioId: 'chatbridge-host-tool-contract',
      },
      referenceOutputs: {
        hostManagedRecordKind: 'chatbridge.host.tool.record.v1',
        genericToolUntouched: true,
      },
    },
    async ({ referenceOutputs }) => {
      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-host-tool-contract',
        storyIds: ['CB-204'],
        outputs: (result) => result,
        run: async ({ record, step }) => {
          const genericExecute = vi.fn(async (input: { query: string }) => ({
            echoed: input.query,
          }))

          const preparedTools = await step('toolset.prepareExecution', {}, async () =>
            prepareToolsForExecution(
              {
                save_story: createChatBridgeHostTool({
                  description: 'Persist story state.',
                  appId: 'story-builder',
                  schemaVersion: CHATBRIDGE_HOST_TOOL_SCHEMA_VERSION,
                  effect: 'side-effect',
                  retryClassification: 'unsafe',
                  inputSchema: z.object({
                    title: z.string(),
                    idempotencyKey: z.string(),
                  }),
                  execute: async (input: { title: string; idempotencyKey: string }) => ({
                    saved: true,
                    title: input.title,
                  }),
                }),
                generic_search: {
                  description: 'A normal non-ChatBridge tool.',
                  execute: genericExecute,
                },
              },
              'session-3'
            )
          )

          const hostManagedResult = await step('toolset.executeHostManagedTool', {}, async () =>
            preparedTools.save_story.execute?.(
              {
                title: 'Checkpoint 1',
                idempotencyKey: 'idem-save-1',
              },
              getExecutionOptions('tool-save-story-host')
            )
          )

          const genericResult = await preparedTools.generic_search.execute?.(
            { query: 'chatbridge' },
            getExecutionOptions('tool-generic-search')
          )

          const hostManagedPartUpdate = getChatBridgeHostToolPartUpdate(hostManagedResult)

          expect(hostManagedResult).toMatchObject({
            kind: 'chatbridge.host.tool.record.v1',
            executionAuthority: 'host',
          })
          expect(hostManagedPartUpdate).not.toBeNull()
          expect(hostManagedPartUpdate?.result).toMatchObject({
            kind: 'chatbridge.host.tool.record.v1',
            executionAuthority: 'host',
            outcome: {
              status: 'success',
              result: {
                saved: true,
                title: 'Checkpoint 1',
              },
            },
          })
          expect(genericExecute).toHaveBeenCalledOnce()
          expect(genericResult).toEqual({
            echoed: 'chatbridge',
          })

          record('toolset.executionObserved', {
            hostManagedKind: (hostManagedResult as { kind?: string } | undefined)?.kind ?? null,
          })

          return {
            hostManagedRecordKind: (hostManagedResult as { kind?: string } | undefined)?.kind ?? 'missing',
            genericToolUntouched: genericExecute.mock.calls.length === 1,
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )

  ls.test(
    'recompletes CB-300 with traced single-app discovery, match, and ambiguity refusal behavior',
    {
      inputs: {
        storyIds: ['CB-300'],
        scenarioId: 'chatbridge-single-app-discovery',
      },
      referenceOutputs: {
        matchedAppId: 'chess',
        ambiguousStatus: 'ambiguous',
      },
    },
    async ({ referenceOutputs }) => {
      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-single-app-discovery',
        storyIds: ['CB-300'],
        outputs: (result) => result,
        run: async ({ record, step }) => {
          const { selection, tools } = await step('routing.resolveReviewedSingleApp', {}, async () =>
            createReviewedSingleAppToolSet({
              messages: [createMessage('user', 'Please open Chess and analyze this FEN for me.')],
            })
          )

          expect(selection).toMatchObject({
            status: 'matched',
            appId: 'chess',
          })

          const preparedTools = prepareToolsForExecution(tools, 'session-cb-300-integration')
          const matchedResult = await preparedTools.chess_prepare_session.execute?.(
            {
              request: 'Open Chess and analyze this position.',
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
            },
            getExecutionOptions('tool-chess-integration')
          )

          const ambiguous = createReviewedSingleAppToolSet({
            messages: [createMessage('user', 'Set up a board game and tell me the next move.')],
          })

          expect(matchedResult).toMatchObject({
            kind: 'chatbridge.host.tool.record.v1',
            appId: 'chess',
          })
          expect(ambiguous.selection).toMatchObject({
            status: 'ambiguous',
          })

          record('routing.selectionObserved', {
            matchedStatus: selection.status,
            ambiguousStatus: ambiguous.selection.status,
          })

          return {
            matchedAppId: selection.status === 'matched' ? selection.appId : 'missing',
            ambiguousStatus: ambiguous.selection.status,
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )

  ls.test(
    'recompletes CB-303 with traced live and stale Chess board-context injection before model execution',
    {
      inputs: {
        storyIds: ['CB-303'],
        scenarioId: 'chatbridge-mid-game-board-context',
      },
      referenceOutputs: {
        liveContextState: 'live',
        staleContextState: 'stale',
      },
    },
    async ({ referenceOutputs }) => {
      const evalRun = await runChatBridgeEvalScenario({
        scenarioId: 'chatbridge-mid-game-board-context',
        storyIds: ['CB-303'],
        outputs: (result) => result,
        run: async ({ record, step }) => {
          const fixture = buildChatBridgeChessMidGameSessionFixture()
          const { chat, model } = createModelStub()

          const liveResult = await step('reasoning.injectLiveBoardContext', {}, async () =>
            streamText(model, {
              sessionId: 'session-chess-live',
              messages: fixture.messages,
              onResultChangeWithCancel: vi.fn(),
            })
          )

          expect(chat).toHaveBeenCalledOnce()
          const livePrompt = getInjectedSystemPrompt(liveResult.coreMessages)
          expect(livePrompt).toContain('Context state: live')
          expect(livePrompt).toContain('Board FEN:')

          const staleMessages: Message[] = [
            createTextMessage(
              'msg-chess-stale-system',
              'system',
              'Keep Chess reasoning grounded in host-owned context even when the session is stale.',
              1
            ),
            createTextMessage('msg-chess-stale-user', 'user', 'Resume the last chess position if you can.', 2),
            createAppLifecycleMessage(
              'msg-chess-stale-assistant',
              'assistant',
              'The last known Chess board is available, but the host marked it stale.',
              {
                appId: 'chess',
                appName: 'Chess',
                toolCallId: 'tool-chess-stale',
                lifecycle: 'stale',
                summary: 'The last known board is available, but it may be outdated.',
                snapshot: {
                  route: '/apps/chess',
                  status: 'stale',
                  boardContext: {
                    schemaVersion: 1,
                    fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6',
                    sideToMove: 'white',
                    fullmoveNumber: 6,
                    legalMovesCount: 33,
                    positionStatus: 'in_progress',
                    lastMove: {
                      san: '...e5',
                      uci: 'e7e5',
                    },
                    summary: 'White to move in an Italian Game structure after ...e5.',
                  },
                },
                timestamp: 3,
              }
            ),
            createTextMessage('msg-chess-stale-follow-up', 'user', 'Should White still aim for c3 and d4?', 4),
          ]

          const staleResult = await step('reasoning.injectStaleBoardContext', {}, async () =>
            streamText(model, {
              sessionId: 'session-chess-stale',
              messages: staleMessages,
              onResultChangeWithCancel: vi.fn(),
            })
          )

          expect(chat).toHaveBeenCalledTimes(2)
          const stalePrompt = getInjectedSystemPrompt(staleResult.coreMessages)
          expect(stalePrompt).toContain('Context state: stale')
          expect(stalePrompt).toContain('ask the user to refresh or resume the board')

          record('reasoning.contextObserved', {
            livePromptContainsFen: livePrompt.includes('Board FEN:'),
            stalePromptMarked: stalePrompt.includes('Context state: stale'),
          })

          return {
            liveContextState: livePrompt.includes('Context state: live') ? 'live' : 'missing',
            staleContextState: stalePrompt.includes('Context state: stale') ? 'stale' : 'missing',
          }
        },
      })

      expect(evalRun.result).toMatchObject(referenceOutputs!)
      return {
        ...evalRun.result,
        localLogPath: evalRun.localLogPath,
      }
    }
  )
})

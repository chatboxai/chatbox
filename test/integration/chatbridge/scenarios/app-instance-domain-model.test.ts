import '../setup'

import { describe, expect, it } from 'vitest'
import { CHATBRIDGE_COMPLETION_SCHEMA_VERSION } from '@shared/chatbridge/completion'
import { createBridgeHostController } from '@/packages/chatbridge/bridge/host-controller'
import {
  createChatBridgeAppRecordStore,
  hydrateChatBridgeAppRecordState,
  selectLatestChatBridgeAppEvent,
} from '@/packages/chatbridge/app-records'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

type MockPortMessageEvent = {
  data: unknown
}

class MockMessagePort {
  onmessage: ((event: MockPortMessageEvent) => void) | null = null

  peer: MockMessagePort | null = null

  sentMessages: unknown[] = []

  receivedMessages: unknown[] = []

  postMessage(message: unknown) {
    this.sentMessages.push(message)
    if (this.peer) {
      this.peer.receivedMessages.push(message)
    }
    this.peer?.onmessage?.({ data: message })
  }

  start() {}

  close() {}
}

function createMessageChannel() {
  const port1 = new MockMessagePort()
  const port2 = new MockMessagePort()
  port1.peer = port2
  port2.peer = port1
  return {
    port1,
    port2,
  }
}

function createDeterministicIds(values: string[]) {
  const remaining = [...values]
  return () => {
    const next = remaining.shift()
    if (!next) {
      throw new Error('No deterministic IDs remaining for test')
    }
    return next
  }
}

function traceScenario<T>(testCase: string, execute: () => Promise<T> | T) {
  return runChatBridgeScenarioTrace(
    {
      slug: 'chatbridge-app-instance-domain-model',
      primaryFamily: 'reviewed-app-launch',
      evidenceFamilies: ['persistence', 'bridge'],
    },
    testCase,
    execute
  )
}

describe('ChatBridge app instance and event domain model', () => {
  it('records a host-owned lifecycle stream that survives hydration after the bridge runtime completes', () =>
    traceScenario(
      'records a host-owned lifecycle stream that survives hydration after the bridge runtime completes',
      async () => {
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
          createId: createDeterministicIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1', 'render-1']),
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

        appPort?.postMessage(readyEvent)

        await controller.waitForReady()

        currentTime = nextTime()
        const readyResult = recordStore.recordBridgeEvent(readyEvent, currentTime)
        expect(readyResult.accepted).toBe(true)

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
          completion: {
            schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
            status: 'success',
            outcomeData: {
              artifactId: 'artifact-1',
            },
            suggestedSummary: {
              text: 'The preview artifact is ready.',
            },
          },
        })

        const storedInstance = recordStore.getInstance('app-instance-1')
        expect(storedInstance).toMatchObject({
          status: 'complete',
          bridgeSessionId: 'bridge-session-1',
          lastSnapshot: {
            route: '/preview',
            rendered: true,
          },
          completion: {
            status: 'pending',
            payload: {
              schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
              status: 'success',
              outcomeData: {
                artifactId: 'artifact-1',
              },
              suggestedSummary: {
                text: 'The preview artifact is ready.',
              },
            },
            suggestedSummary: 'The preview artifact is ready.',
          },
          lastEventSequence: 5,
        })

        const snapshot = recordStore.snapshot()
        const hydrated = hydrateChatBridgeAppRecordState(snapshot)

        expect(selectLatestChatBridgeAppEvent(hydrated, 'app-instance-1')).toMatchObject({
          kind: 'completion.recorded',
          sequence: 5,
          nextStatus: 'complete',
        })
        expect(hydrated.instances['app-instance-1']).toMatchObject({
          status: 'complete',
          bridgeSessionId: 'bridge-session-1',
          completion: {
            status: 'pending',
            suggestedSummary: 'The preview artifact is ready.',
          },
        })
      }
    ))
})

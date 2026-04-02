import '../setup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHATBRIDGE_COMPLETION_SCHEMA_VERSION } from '@shared/chatbridge/completion'
import { createBridgeHostController } from '@/packages/chatbridge/bridge/host-controller'
import { runChatBridgeScenarioTrace } from './scenario-tracing'

type MockPortMessageEvent = {
  data: unknown
}

class MockMessagePort {
  onmessage: ((event: MockPortMessageEvent) => void) | null = null

  peer: MockMessagePort | null = null

  sentMessages: unknown[] = []

  receivedMessages: unknown[] = []

  closed = false

  postMessage(message: unknown) {
    this.sentMessages.push(message)
    if (this.peer) {
      this.peer.receivedMessages.push(message)
    }
    this.peer?.onmessage?.({ data: message })
  }

  start() {}

  close() {
    this.closed = true
  }
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
      slug: 'chatbridge-bridge-handshake',
      primaryFamily: 'recovery',
      evidenceFamilies: ['bridge'],
    },
    testCase,
    execute
  )
}

describe('ChatBridge launch-scoped bridge handshake', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('bootstraps a dedicated channel and sends host render updates only after a valid ack', () =>
    traceScenario('bootstraps a dedicated channel and sends host render updates only after a valid ack', async () => {
      let bootstrapMessage: unknown
      let bootstrapTargetOrigin = ''
      let transferredPort: MockMessagePort | null = null

      const traces: string[] = []
      const controller = createBridgeHostController({
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-1',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
        createMessageChannel,
        createId: createDeterministicIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1', 'render-1']),
        now: () => 10_000,
        onTrace: (trace) => traces.push(trace.type),
      })

      controller.attach({
        postMessage(message, targetOrigin, transfer) {
          bootstrapMessage = message
          bootstrapTargetOrigin = targetOrigin
          transferredPort = transfer?.[0] as MockMessagePort
        },
      })

      expect(bootstrapTargetOrigin).toBe('https://artifact-preview.chatboxai.app')
      expect(transferredPort).toBeTruthy()

      const readyPromise = controller.waitForReady()
      transferredPort?.postMessage({
        kind: 'app.ready',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        ackNonce: 'bridge-nonce-1',
        sequence: 1,
      })

      await readyPromise
      controller.renderHtml('<html><body><h1>Hello bridge</h1></body></html>')

      const hostMessages = transferredPort?.receivedMessages ?? []
      expect(bootstrapMessage).toBeTruthy()
      expect(hostMessages).toContainEqual({
        kind: 'host.render',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        renderId: 'render-1',
        html: '<html><body><h1>Hello bridge</h1></body></html>',
      })
      expect(traces).toEqual(['session.attached', 'session.ready', 'host.render.sent'])
    }))

  it('rejects replayed app-state events after the bridge is active', () =>
    traceScenario('rejects replayed app-state events after the bridge is active', async () => {
      const acceptedEvents: string[] = []
      const rejectedReasons: string[] = []
      const recoveryClasses: string[] = []
      const recoveryAudits: string[] = []

      const controller = createBridgeHostController({
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-1',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
        createMessageChannel,
        createId: createDeterministicIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1']),
        now: () => 10_000,
        onAcceptedAppEvent: (event) => acceptedEvents.push(event.kind),
        onRejectedAppEvent: (_event, reason) => rejectedReasons.push(reason),
        onRecoveryDecision: (decision) => recoveryClasses.push(decision.failureClass),
        onRecoveryAudit: (event) => recoveryAudits.push(event.category),
      })

      let appPort: MockMessagePort | null = null
      controller.attach({
        postMessage(_message, _targetOrigin, transfer) {
          appPort = transfer?.[0] as MockMessagePort
        },
      })

      appPort?.postMessage({
        kind: 'app.ready',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        ackNonce: 'bridge-nonce-1',
        sequence: 1,
      })
      await controller.waitForReady()

      appPort?.postMessage({
        kind: 'app.state',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        sequence: 2,
        idempotencyKey: 'state-2',
        snapshot: {
          route: '/preview',
        },
      })

      appPort?.postMessage({
        kind: 'app.state',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        sequence: 2,
        idempotencyKey: 'state-3',
        snapshot: {
          route: '/preview',
        },
      })

      appPort?.postMessage({
        kind: 'app.complete',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        sequence: 3,
        idempotencyKey: 'state-2',
        completion: {
          schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
          status: 'success',
          outcomeData: {
            artifactId: 'preview-1',
          },
        },
      })

      expect(acceptedEvents).toEqual(['app.state'])
      expect(rejectedReasons).toEqual(['replayed-sequence', 'duplicate-idempotency-key'])
      expect(recoveryClasses).toEqual(['bridge-protocol-rejection', 'bridge-protocol-rejection'])
      expect(recoveryAudits).toEqual(['lifecycle.recovery', 'lifecycle.recovery'])
    }))

  it('fails closed on malformed bridge traffic and launch timeouts with explicit recovery signals', () =>
    traceScenario(
      'fails closed on malformed bridge traffic and launch timeouts with explicit recovery signals',
      async () => {
        const recoveryClasses: string[] = []
        const traces: string[] = []

        const controller = createBridgeHostController({
          appId: 'artifact-preview',
          appInstanceId: 'app-instance-timeout',
          expectedOrigin: 'https://artifact-preview.chatboxai.app',
          capabilities: ['render-html-preview'],
          createMessageChannel,
          createId: createDeterministicIds(['bridge-session-timeout', 'bridge-token-timeout', 'bridge-nonce-timeout']),
          now: () => 5_000,
          ttlMs: 500,
          onRecoveryDecision: (decision) => recoveryClasses.push(decision.failureClass),
          onTrace: (trace) => traces.push(trace.type),
        })

        let appPort: MockMessagePort | null = null
        controller.attach({
          postMessage(_message, _targetOrigin, transfer) {
            appPort = transfer?.[0] as MockMessagePort
          },
        })

        appPort?.postMessage({
          kind: 'app.state',
          bridgeSessionId: 'bridge-session-timeout',
          appInstanceId: 'app-instance-timeout',
          bridgeToken: 'bridge-token-timeout',
          sequence: 1,
          snapshot: {
            route: '/preview',
          },
        })

        const readyExpectation = expect(controller.waitForReady()).rejects.toThrow(/timed out/i)
        await vi.advanceTimersByTimeAsync(500)
        await readyExpectation
        expect(recoveryClasses).toEqual(['malformed-bridge-event', 'timeout'])
        expect(traces).toEqual(['session.attached', 'recovery.required', 'app.event.invalid', 'recovery.required'])
      }
    ))

  it('emits an explicit runtime-crash recovery when the app reports app.error', () =>
    traceScenario('emits an explicit runtime-crash recovery when the app reports app.error', async () => {
      const recoveryClasses: string[] = []

      const controller = createBridgeHostController({
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-crash',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
        createMessageChannel,
        createId: createDeterministicIds(['bridge-session-crash', 'bridge-token-crash', 'bridge-nonce-crash']),
        now: () => 20_000,
        onRecoveryDecision: (decision) => recoveryClasses.push(decision.failureClass),
      })

      let appPort: MockMessagePort | null = null
      controller.attach({
        postMessage(_message, _targetOrigin, transfer) {
          appPort = transfer?.[0] as MockMessagePort
        },
      })

      appPort?.postMessage({
        kind: 'app.ready',
        bridgeSessionId: 'bridge-session-crash',
        appInstanceId: 'app-instance-crash',
        bridgeToken: 'bridge-token-crash',
        ackNonce: 'bridge-nonce-crash',
        sequence: 1,
      })
      await controller.waitForReady()

      appPort?.postMessage({
        kind: 'app.error',
        bridgeSessionId: 'bridge-session-crash',
        appInstanceId: 'app-instance-crash',
        bridgeToken: 'bridge-token-crash',
        sequence: 2,
        idempotencyKey: 'error-2',
        error: 'Worker process exited unexpectedly.',
      })

      expect(recoveryClasses).toEqual(['runtime-crash'])
    }))
})

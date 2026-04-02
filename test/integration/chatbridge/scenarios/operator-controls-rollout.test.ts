import '../setup'

import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyChatBridgeAppKillSwitch,
  clearChatBridgeObservabilityState,
  evaluateReviewedAppActiveSessionDisposition,
  listChatBridgeObservabilityEvents,
} from '@shared/chatbridge/observability'
import { clearReviewedAppRegistry, defineReviewedApps } from '@shared/chatbridge/registry'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'
import { getReviewedAppRouteDecision } from '@/packages/chatbridge/router'
import { createBridgeHostController } from '@/packages/chatbridge/bridge/host-controller'

type MockPortMessageEvent = {
  data: unknown
}

class MockMessagePort {
  onmessage: ((event: MockPortMessageEvent) => void) | null = null

  peer: MockMessagePort | null = null

  receivedMessages: unknown[] = []

  postMessage(message: unknown) {
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

describe('ChatBridge operator controls and observability rollout', () => {
  beforeEach(() => {
    clearReviewedAppRegistry()
    clearChatBridgeObservabilityState()
  })

  it('records host lifecycle and recovery events as first-class observability records', async () => {
    let appPort: MockMessagePort | null = null
    const traceEvents: string[] = []

    const controller = createBridgeHostController({
      appId: 'story-builder',
      appName: 'Story Builder',
      appVersion: '1.2.3',
      appInstanceId: 'app-instance-1',
      expectedOrigin: 'https://apps.example.com',
      capabilities: ['render-html-preview'],
      createMessageChannel,
      createId: createDeterministicIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1']),
      now: () => 100,
      traceAdapter: {
        enabled: true,
        startRun: async () => ({
          runId: 'unused',
          end: async () => {},
        }),
        recordEvent: async (event) => {
          traceEvents.push(event.name)
        },
      },
    })

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
      kind: 'app.error',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'error-2',
      error: 'Runtime crashed while loading the draft.',
    })

    expect(listChatBridgeObservabilityEvents({ appId: 'story-builder', version: '1.2.3' }).map((event) => event.kind)).toEqual([
      'session-attached',
      'session-ready',
      'app-event-accepted',
      'recovery-required',
    ])
    expect(listChatBridgeObservabilityEvents({ appId: 'story-builder', version: '1.2.3' }).at(-1)).toMatchObject({
      traceCode: 'recovery.runtime-crash',
      status: 'degraded',
    })
    expect(traceEvents).toEqual([
      'chatbridge.bridge.session_attached',
      'chatbridge.bridge.session_ready',
      'chatbridge.bridge.app_event_accepted',
      'chatbridge.bridge.recovery_required',
    ])
  })

  it('blocks new launches for disabled versions while leaving active-session posture explicit', () => {
    defineReviewedApps([
      createReviewedAppCatalogEntryFixture({
        manifest: {
          appId: 'story-builder',
          name: 'Story Builder',
          tenantAvailability: {
            default: 'enabled',
            allow: [],
            deny: [],
          },
          safetyMetadata: {
            reviewed: true,
            sandbox: 'hosted-iframe',
            handlesStudentData: true,
            requiresTeacherApproval: false,
          },
        },
      }),
    ])

    applyChatBridgeAppKillSwitch({
      controlId: 'control-story-builder',
      appId: 'story-builder',
      version: '1.2.3',
      reason: 'Rollback after partner regression.',
      disabledAt: 150,
      disabledBy: 'ops-oncall',
      activeSessionBehavior: 'allow-to-complete',
    })

    const route = getReviewedAppRouteDecision({
      promptInput: 'Open Story Builder and continue my outline.',
      contextInput: {
        tenantId: 'k12-demo',
        teacherApproved: true,
        grantedPermissions: ['drive.read'],
      },
    })
    const activeSession = evaluateReviewedAppActiveSessionDisposition({
      appId: 'story-builder',
      version: '1.2.3',
      appName: 'Story Builder',
    })

    expect(route.catalog.candidates).toEqual([])
    expect(route.catalog.excluded[0]?.reasons.map((reason) => reason.code)).toContain('app-version-disabled')
    expect(route.decision).toMatchObject({
      kind: 'refuse',
      reasonCode: 'no-eligible-apps',
    })
    expect(activeSession).toMatchObject({
      action: 'continue',
    })
    expect(listChatBridgeObservabilityEvents({ appId: 'story-builder', version: '1.2.3' }).map((event) => event.kind)).toEqual([
      'kill-switch-applied',
    ])
  })
})

import '../setup'

import { describe, expect, it } from 'vitest'
import {
  CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
  validateChatBridgePartnerManifest,
} from '@shared/chatbridge'
import { createReviewedAppCatalogEntryFixture } from '../fixtures/reviewed-app-manifests'
import { createChatBridgePartnerHarness } from '../mocks/partner-harness'

describe('ChatBridge partner validator and local harness', () => {
  it('validates a reviewed partner manifest and runs a sample runtime through the host harness', async () => {
    const entry = createReviewedAppCatalogEntryFixture()
    const report = validateChatBridgePartnerManifest(entry)

    expect(report.valid).toBe(true)
    expect(report.guidance?.authBoundary).toMatchObject({
      appGrantRequired: true,
      requiresHostMediatedAccess: true,
    })

    const harness = createChatBridgePartnerHarness({
      appId: entry.manifest.appId,
      appName: entry.manifest.name,
      appVersion: entry.manifest.version,
      appInstanceId: 'partner-instance-1',
      expectedOrigin: entry.manifest.origin,
      capabilities: ['render-html-preview'],
      createIds: ['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1', 'render-1'],
      now: () => 1_000,
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
    harness.renderHtml('<html><body><h1>Story Builder</h1></body></html>')
    harness.sendAppEvent({
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'state-2',
      snapshot: {
        route: '/drafts/draft-42',
        checkpointId: 'draft-42',
      },
    })
    harness.sendAppEvent({
      kind: 'app.complete',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 3,
      idempotencyKey: 'complete-3',
      completion: {
        schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
        status: 'success',
        outcomeData: {
          draftId: 'draft-42',
        },
        suggestedSummary: {
          text: 'Story Builder safely resumed the approved draft and handed the checkpoint back to chat.',
        },
      },
    })

    expect(harness.getBootstrapMessage()).toMatchObject({
      kind: 'host.bootstrap',
      envelope: {
        appId: entry.manifest.appId,
        appInstanceId: 'partner-instance-1',
        expectedOrigin: entry.manifest.origin,
      },
    })
    expect(harness.getBootstrapTargetOrigin()).toBe(entry.manifest.origin)
    expect(harness.getHostRenderMessages()).toContainEqual({
      kind: 'host.render',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'partner-instance-1',
      renderId: 'render-1',
      html: '<html><body><h1>Story Builder</h1></body></html>',
    })
    expect(harness.acceptedAppEvents.map((event) => event.kind)).toEqual(['app.state', 'app.complete'])
    expect(harness.observabilityEvents.map((event) => event.kind)).toEqual([
      'session-attached',
      'session-ready',
      'host-render-sent',
      'app-event-accepted',
      'app-event-accepted',
    ])
  })

  it('fails closed on replayed partner traffic and keeps debugging signals explicit', async () => {
    const harness = createChatBridgePartnerHarness({
      appId: 'story-builder',
      appName: 'Story Builder',
      appVersion: '1.2.3',
      appInstanceId: 'partner-instance-2',
      expectedOrigin: 'https://apps.example.com',
      capabilities: ['render-html-preview'],
      createIds: ['bridge-session-2', 'bridge-token-2', 'bridge-nonce-2'],
      now: () => 2_000,
    })

    const readyPromise = harness.waitForReady()
    harness.sendAppEvent({
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-2',
      appInstanceId: 'partner-instance-2',
      bridgeToken: 'bridge-token-2',
      ackNonce: 'bridge-nonce-2',
      sequence: 1,
    })
    await readyPromise

    harness.sendAppEvent({
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-2',
      appInstanceId: 'partner-instance-2',
      bridgeToken: 'bridge-token-2',
      sequence: 2,
      idempotencyKey: 'state-2',
      snapshot: {
        route: '/drafts/draft-42',
      },
    })
    harness.sendAppEvent({
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-2',
      appInstanceId: 'partner-instance-2',
      bridgeToken: 'bridge-token-2',
      sequence: 2,
      idempotencyKey: 'state-3',
      snapshot: {
        route: '/drafts/draft-42',
      },
    })
    harness.sendAppEvent({
      kind: 'app.complete',
      bridgeSessionId: 'bridge-session-2',
      appInstanceId: 'partner-instance-2',
      bridgeToken: 'bridge-token-2',
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

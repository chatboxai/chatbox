import { describe, expect, it } from 'vitest'
import {
  BridgeAppEventSchema,
  BridgeBootstrapEnvelopeSchema,
  acknowledgeBridgeSession,
  acceptBridgeAppEvent,
  createBridgeSession,
} from './bridge-session'

function createFixedIds(values: string[]) {
  const remaining = [...values]
  return () => {
    const next = remaining.shift()
    if (!next) {
      throw new Error('No deterministic IDs remaining for test')
    }
    return next
  }
}

describe('bridge-session contract', () => {
  it('creates a launch-scoped bridge session envelope with origin, expiry, and capabilities', () => {
    const { envelope } = createBridgeSession(
      {
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-1',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
      },
      {
        now: () => 1_000,
        ttlMs: 60_000,
        createId: createFixedIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1']),
      }
    )

    expect(BridgeBootstrapEnvelopeSchema.parse(envelope)).toMatchObject({
      bridgeSessionId: 'bridge-session-1',
      appId: 'artifact-preview',
      appInstanceId: 'app-instance-1',
      expectedOrigin: 'https://artifact-preview.chatboxai.app',
      capabilities: ['render-html-preview'],
      expiresAt: 61_000,
    })
  })

  it('requires an idempotency key for state-changing app events', () => {
    expect(() =>
      BridgeAppEventSchema.parse({
        kind: 'app.state',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        sequence: 2,
      })
    ).toThrow(/idempotency/i)
  })

  it('requires structured completion payloads for app.complete events', () => {
    expect(() =>
      BridgeAppEventSchema.parse({
        kind: 'app.complete',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'app-instance-1',
        bridgeToken: 'bridge-token-1',
        sequence: 3,
        idempotencyKey: 'complete-3',
        result: {
          status: 'success',
        },
      })
    ).toThrow(/schemaVersion/i)
  })
})

describe('bridge-session validation', () => {
  it('acknowledges the ready event and then accepts monotonic state updates', () => {
    const { session } = createBridgeSession(
      {
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-1',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
      },
      {
        now: () => 10_000,
        ttlMs: 60_000,
        createId: createFixedIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1']),
      }
    )

    const ack = acknowledgeBridgeSession(session, {
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      ackNonce: 'bridge-nonce-1',
      sequence: 1,
    }, {
      now: () => 10_000,
    })

    expect(ack.accepted).toBe(true)
    expect(ack.session.acknowledgedAt).toBe(10_000)

    const stateUpdate = acceptBridgeAppEvent(ack.session, {
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'state-2',
      snapshot: {
        route: '/preview',
        status: 'ready',
      },
    }, {
      now: () => 10_000,
    })

    expect(stateUpdate.accepted).toBe(true)
    expect(stateUpdate.session.lastAcceptedSequence).toBe(2)
    expect(stateUpdate.session.acceptedIdempotencyKeys.has('state-2')).toBe(true)
  })

  it('rejects ready acknowledgements with the wrong bootstrap nonce', () => {
    const { session } = createBridgeSession(
      {
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-1',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
      },
      {
        now: () => 10_000,
        ttlMs: 60_000,
        createId: createFixedIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1']),
      }
    )

    const ack = acknowledgeBridgeSession(session, {
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      ackNonce: 'wrong-nonce',
      sequence: 1,
    }, {
      now: () => 10_000,
    })

    expect(ack.accepted).toBe(false)
    if (!ack.accepted) {
      expect(ack.reason).toBe('invalid-bootstrap-nonce')
    }
  })

  it('rejects replayed or duplicated state-changing events after the session is active', () => {
    const { session } = createBridgeSession(
      {
        appId: 'artifact-preview',
        appInstanceId: 'app-instance-1',
        expectedOrigin: 'https://artifact-preview.chatboxai.app',
        capabilities: ['render-html-preview'],
      },
      {
        now: () => 10_000,
        ttlMs: 60_000,
        createId: createFixedIds(['bridge-session-1', 'bridge-token-1', 'bridge-nonce-1']),
      }
    )

    const ack = acknowledgeBridgeSession(session, {
      kind: 'app.ready',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      ackNonce: 'bridge-nonce-1',
      sequence: 1,
    }, {
      now: () => 10_000,
    })

    const acceptedState = acceptBridgeAppEvent(ack.session, {
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'state-2',
      snapshot: {
        route: '/preview',
        status: 'ready',
      },
    }, {
      now: () => 10_000,
    })
    expect(acceptedState.accepted).toBe(true)

    const replayedSequence = acceptBridgeAppEvent(acceptedState.session, {
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 2,
      idempotencyKey: 'state-3',
      snapshot: {
        route: '/preview',
        status: 'ready',
      },
    }, {
      now: () => 10_000,
    })
    expect(replayedSequence.accepted).toBe(false)
    if (!replayedSequence.accepted) {
      expect(replayedSequence.reason).toBe('replayed-sequence')
    }

    const duplicateIdempotency = acceptBridgeAppEvent(acceptedState.session, {
      kind: 'app.complete',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'app-instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 3,
      idempotencyKey: 'state-2',
      result: {
        schemaVersion: 1,
        status: 'success',
        outcomeData: {
          status: 'complete',
        },
      },
    }, {
      now: () => 10_000,
    })
    expect(duplicateIdempotency.accepted).toBe(false)
    if (!duplicateIdempotency.accepted) {
      expect(duplicateIdempotency.reason).toBe('duplicate-idempotency-key')
    }
  })
})

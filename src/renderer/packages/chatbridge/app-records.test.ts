import { describe, expect, it } from 'vitest'
import { CHATBRIDGE_COMPLETION_SCHEMA_VERSION } from '@shared/chatbridge/completion'
import {
  appendChatBridgeAppEvent,
  createChatBridgeAppRecordStore,
  hydrateChatBridgeAppRecordState,
  selectActiveChatBridgeAppInstance,
  selectLatestChatBridgeAppEvent,
  selectResumableChatBridgeAppInstances,
} from './app-records'

describe('ChatBridge app record store', () => {
  it('creates instances, records lifecycle events, and hydrates durable snapshots', () => {
    const ids = ['event-created', 'event-ready', 'event-state', 'event-complete']
    const store = createChatBridgeAppRecordStore({
      createId: () => ids.shift() ?? crypto.randomUUID(),
      now: () => 1_000,
    })

    store.createInstance({
      id: 'instance-1',
      appId: 'story-builder',
      appVersion: '1.0.0',
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
      },
    })

    const ready = store.recordBridgeEvent(
      {
        kind: 'app.ready',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'instance-1',
        bridgeToken: 'bridge-token-1',
        ackNonce: 'bridge-nonce-1',
        sequence: 1,
      },
      1_100
    )
    expect(ready.accepted).toBe(true)

    const active = store.recordBridgeEvent(
      {
        kind: 'app.state',
        bridgeSessionId: 'bridge-session-1',
        appInstanceId: 'instance-1',
        bridgeToken: 'bridge-token-1',
        sequence: 2,
        idempotencyKey: 'state-2',
        snapshot: {
          route: '/draft',
        },
      },
      1_200
    )
    expect(active.accepted).toBe(true)

    const completed = store.recordBridgeEvent(
      {
        kind: 'app.complete',
        bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'instance-1',
      bridgeToken: 'bridge-token-1',
      sequence: 3,
      idempotencyKey: 'complete-3',
      completion: {
        schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
        status: 'success',
        outcome: {
          code: 'draft_completed',
          data: {
            draftId: 'draft-1',
          },
        },
        suggestedSummary: 'The draft is ready for follow-up.',
      },
    },
      1_300
    )
    expect(completed.accepted).toBe(true)

    const snapshot = store.snapshot()
    const hydrated = hydrateChatBridgeAppRecordState(snapshot)

    expect(selectActiveChatBridgeAppInstance(hydrated)).toBeNull()
    expect(selectLatestChatBridgeAppEvent(hydrated, 'instance-1')).toMatchObject({
      kind: 'completion.recorded',
      sequence: 4,
    })
    expect(hydrated.instances['instance-1']).toMatchObject({
      status: 'complete',
      lastEventSequence: 4,
      completion: {
        status: 'pending',
        payload: {
          schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
          status: 'success',
          outcome: {
            code: 'draft_completed',
            data: {
              draftId: 'draft-1',
            },
          },
          suggestedSummary: 'The draft is ready for follow-up.',
        },
        suggestedSummary: 'The draft is ready for follow-up.',
      },
    })
  })

  it('tracks resumable error and stale instances through selectors', () => {
    const store = createChatBridgeAppRecordStore({
      now: () => 2_000,
    })

    store.createInstance({
      id: 'instance-2',
      appId: 'story-builder',
      appVersion: '1.0.0',
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
      },
    })

    store.recordBridgeEvent(
      {
        kind: 'app.ready',
        bridgeSessionId: 'bridge-session-2',
        appInstanceId: 'instance-2',
        bridgeToken: 'bridge-token-2',
        ackNonce: 'bridge-nonce-2',
        sequence: 1,
      },
      2_100
    )

    store.recordHostEvent({
      appInstanceId: 'instance-2',
      kind: 'error.recorded',
      nextStatus: 'error',
      createdAt: 2_200,
      error: {
        code: 'partner_timeout',
        message: 'The embedded runtime stopped responding.',
        occurredAt: 2_200,
      },
    })

    const resumable = selectResumableChatBridgeAppInstances(store.getState())

    expect(resumable).toHaveLength(1)
    expect(resumable[0]).toMatchObject({
      id: 'instance-2',
      status: 'error',
    })
  })

  it('rejects malformed event appends after hydration', () => {
    const store = createChatBridgeAppRecordStore({
      now: () => 3_000,
    })

    const instance = store.createInstance({
      id: 'instance-3',
      appId: 'story-builder',
      appVersion: '1.0.0',
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
      },
    })

    const result = appendChatBridgeAppEvent(store.getState(), {
      schemaVersion: 1,
      id: 'event-illegal',
      appInstanceId: 'instance-3',
      kind: 'completion.recorded',
      actor: 'app',
      sequence: instance.lastEventSequence + 1,
      createdAt: 3_100,
      nextStatus: 'complete',
      completion: {
        schemaVersion: CHATBRIDGE_COMPLETION_SCHEMA_VERSION,
        status: 'success',
        outcome: {
          code: 'draft_completed',
        },
      },
    })

    expect(result.accepted).toBe(false)
    if (!result.accepted) {
      expect(result.reason).toBe('illegal-transition')
    }
  })
})

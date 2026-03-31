import { describe, expect, it } from 'vitest'
import type { BridgeAppEvent } from './bridge-session'
import {
  applyChatBridgeAppEvent,
  createChatBridgeAppEvent,
  normalizeBridgeAppEventToChatBridgeAppEvent,
} from './events'
import { createChatBridgeAppInstance } from './instance'

describe('ChatBridge app event domain model', () => {
  it('applies ready, state, and completion events while preserving pending completion data', () => {
    const instance = createChatBridgeAppInstance({
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
      createdAt: 1_000,
    })

    const readyEvent = createChatBridgeAppEvent({
      id: 'event-ready',
      appInstanceId: 'instance-1',
      kind: 'bridge.ready',
      actor: 'app',
      sequence: 1,
      createdAt: 1_100,
      nextStatus: 'ready',
    })
    const ready = applyChatBridgeAppEvent(instance, readyEvent)
    expect(ready.accepted).toBe(true)
    if (!ready.accepted) {
      return
    }

    const stateEvent = createChatBridgeAppEvent({
      id: 'event-state',
      appInstanceId: 'instance-1',
      kind: 'state.updated',
      actor: 'app',
      sequence: 2,
      createdAt: 1_200,
      nextStatus: 'active',
      snapshot: {
        route: '/draft',
        sceneCount: 3,
      },
    })
    const active = applyChatBridgeAppEvent(ready.instance, stateEvent)
    expect(active.accepted).toBe(true)
    if (!active.accepted) {
      return
    }

    const completionEvent = createChatBridgeAppEvent({
      id: 'event-complete',
      appInstanceId: 'instance-1',
      kind: 'completion.recorded',
      actor: 'app',
      sequence: 3,
      createdAt: 1_300,
      nextStatus: 'complete',
      payload: {
        draftId: 'draft-1',
        sceneCount: 3,
      },
    })
    const completed = applyChatBridgeAppEvent(active.instance, completionEvent)

    expect(completed.accepted).toBe(true)
    if (!completed.accepted) {
      return
    }

    expect(completed.instance).toMatchObject({
      status: 'complete',
      lastSnapshot: {
        route: '/draft',
        sceneCount: 3,
      },
      completion: {
        status: 'pending',
        payload: {
          draftId: 'draft-1',
          sceneCount: 3,
        },
      },
      lastEventSequence: 3,
    })
  })

  it('rejects resume transitions for instances that are not resumable', () => {
    const instance = createChatBridgeAppInstance({
      id: 'instance-2',
      appId: 'story-builder',
      appVersion: '1.0.0',
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'not-resumable',
        reason: 'No durable checkpoint exists.',
      },
      createdAt: 2_000,
    })

    const stale = applyChatBridgeAppEvent(
      instance,
      createChatBridgeAppEvent({
        id: 'event-stale',
        appInstanceId: 'instance-2',
        kind: 'instance.marked-stale',
        actor: 'host',
        sequence: 1,
        createdAt: 2_100,
        nextStatus: 'stale',
      })
    )

    expect(stale.accepted).toBe(true)
    if (!stale.accepted) {
      return
    }

    const resume = applyChatBridgeAppEvent(
      stale.instance,
      createChatBridgeAppEvent({
        id: 'event-resume',
        appInstanceId: 'instance-2',
        kind: 'resume.requested',
        actor: 'host',
        sequence: 2,
        createdAt: 2_200,
        nextStatus: 'active',
      })
    )

    expect(resume.accepted).toBe(false)
    if (!resume.accepted) {
      expect(resume.reason).toBe('instance-not-resumable')
    }
  })

  it('maps bridge-session lifecycle events into the host event stream vocabulary', () => {
    const bridgeEvent: BridgeAppEvent = {
      kind: 'app.state',
      bridgeSessionId: 'bridge-session-1',
      appInstanceId: 'instance-3',
      bridgeToken: 'bridge-token-1',
      sequence: 7,
      idempotencyKey: 'state-7',
      snapshot: {
        route: '/draft',
      },
    }

    const normalized = normalizeBridgeAppEventToChatBridgeAppEvent(bridgeEvent, {
      id: 'event-state-7',
      sequence: 3,
      createdAt: 3_000,
    })

    expect(normalized).toMatchObject({
      id: 'event-state-7',
      kind: 'state.updated',
      appInstanceId: 'instance-3',
      actor: 'app',
      sequence: 3,
      nextStatus: 'active',
      idempotencyKey: 'state-7',
      snapshot: {
        route: '/draft',
      },
      payload: {
        bridgeSequence: 7,
      },
    })
  })
})

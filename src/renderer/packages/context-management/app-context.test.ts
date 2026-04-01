import { describe, expect, it } from 'vitest'
import type { ChatBridgeAppInstanceStatus } from '@shared/chatbridge/instance'
import { createChatBridgeAppRecordStore } from '../chatbridge/app-records'
import { buildChatBridgeAppContextPrompt, resolveChatBridgeAppContext } from './app-context'

type AppRecordFixture = {
  id: string
  appId?: string
  status: ChatBridgeAppInstanceStatus
  summaryForModel?: string
  updatedAt: number
}

function createAppRecordSnapshot(fixtures: AppRecordFixture[]) {
  const store = createChatBridgeAppRecordStore({
    now: () => 1_000,
  })

  for (const fixture of fixtures) {
    store.createInstance({
      id: fixture.id,
      appId: fixture.appId ?? 'story-builder',
      appVersion: '1.0.0',
      bridgeSessionId: `bridge-${fixture.id}`,
      owner: {
        authority: 'host',
        conversationSessionId: 'session-1',
        initiatedBy: 'assistant',
      },
      resumability: {
        mode: 'resumable',
        resumeKey: fixture.id,
      },
      createdAt: fixture.updatedAt - 100,
    })

    if (fixture.status !== 'launching') {
      const ready = store.recordHostEvent({
        appInstanceId: fixture.id,
        kind: 'bridge.ready',
        nextStatus: 'ready',
        bridgeSessionId: `bridge-${fixture.id}`,
        createdAt: fixture.updatedAt - 50,
        payload: {
          source: 'unit-test',
        },
      })

      if (!ready.accepted) {
        throw new Error(`Failed to seed ready state for ${fixture.id}: ${ready.reason}`)
      }
    }

    if (fixture.status === 'active') {
      const active = store.recordHostEvent({
        appInstanceId: fixture.id,
        kind: 'state.updated',
        nextStatus: 'active',
        bridgeSessionId: `bridge-${fixture.id}`,
        createdAt: fixture.updatedAt,
        payload: {
          source: 'unit-test',
        },
        summaryForModel: fixture.summaryForModel,
      })

      if (!active.accepted) {
        throw new Error(`Failed to seed active state for ${fixture.id}: ${active.reason}`)
      }
    }

    if (fixture.status === 'complete') {
      const complete = store.recordHostEvent({
        appInstanceId: fixture.id,
        kind: 'completion.recorded',
        nextStatus: 'complete',
        bridgeSessionId: `bridge-${fixture.id}`,
        createdAt: fixture.updatedAt,
        payload: {
          source: 'unit-test',
        },
        summaryForModel: fixture.summaryForModel,
      })

      if (!complete.accepted) {
        throw new Error(`Failed to seed complete state for ${fixture.id}: ${complete.reason}`)
      }
    }

    if (fixture.status === 'stale') {
      const stale = store.recordHostEvent({
        appInstanceId: fixture.id,
        kind: 'instance.marked-stale',
        nextStatus: 'stale',
        bridgeSessionId: `bridge-${fixture.id}`,
        createdAt: fixture.updatedAt,
      })

      if (!stale.accepted) {
        throw new Error(`Failed to seed stale state for ${fixture.id}: ${stale.reason}`)
      }
    }
  }

  return store.snapshot()
}

describe('ChatBridge later-turn app context selection', () => {
  it('prefers the latest active app summary over older completed summaries', () => {
    const snapshot = createAppRecordSnapshot([
      {
        id: 'story-builder-complete',
        status: 'complete',
        summaryForModel: 'Saved the previous story outline for later follow-up.',
        updatedAt: 2_000,
      },
      {
        id: 'story-builder-active',
        status: 'active',
        summaryForModel: 'Restored the active story draft and preserved the exportable checkpoint.',
        updatedAt: 3_000,
      },
    ])

    expect(resolveChatBridgeAppContext(snapshot)).toMatchObject({
      state: 'active',
      appId: 'story-builder',
      appInstanceId: 'story-builder-active',
      lifecycle: 'active',
      summaryForModel: 'Restored the active story draft and preserved the exportable checkpoint.',
    })
  })

  it('falls back to the latest completed summary when no active app remains', () => {
    const snapshot = createAppRecordSnapshot([
      {
        id: 'story-builder-complete',
        status: 'complete',
        summaryForModel: 'Saved the previous draft summary for later follow-up questions.',
        updatedAt: 2_500,
      },
    ])

    expect(resolveChatBridgeAppContext(snapshot)).toMatchObject({
      state: 'recent',
      appInstanceId: 'story-builder-complete',
      lifecycle: 'complete',
      summaryForModel: 'Saved the previous draft summary for later follow-up questions.',
    })

    expect(buildChatBridgeAppContextPrompt(snapshot)).toContain('ChatBridge recent app context')
  })

  it('fails closed when the latest app state is stale or missing a normalized summary', () => {
    const snapshot = createAppRecordSnapshot([
      {
        id: 'story-builder-complete',
        status: 'complete',
        summaryForModel: 'Saved the previous draft summary for later follow-up questions.',
        updatedAt: 2_000,
      },
      {
        id: 'story-builder-stale',
        status: 'stale',
        updatedAt: 3_000,
      },
    ])

    expect(resolveChatBridgeAppContext(snapshot)).toMatchObject({
      state: 'unavailable',
      appInstanceId: 'story-builder-stale',
      lifecycle: 'stale',
      reason: 'stale',
    })

    const prompt = buildChatBridgeAppContextPrompt(snapshot)
    expect(prompt).toContain('ChatBridge latest app context is unavailable')
    expect(prompt).toContain('Do not pretend you can see exact current app state')
    expect(prompt).not.toContain('Saved the previous draft summary for later follow-up questions.')
  })

  it('treats an active app without a normalized summary as unavailable instead of leaking older context', () => {
    const snapshot = createAppRecordSnapshot([
      {
        id: 'story-builder-complete',
        status: 'complete',
        summaryForModel: 'Saved the previous draft summary for later follow-up questions.',
        updatedAt: 2_000,
      },
      {
        id: 'story-builder-active',
        status: 'active',
        updatedAt: 3_500,
      },
    ])

    expect(resolveChatBridgeAppContext(snapshot)).toMatchObject({
      state: 'unavailable',
      appInstanceId: 'story-builder-active',
      lifecycle: 'active',
      reason: 'missing-summary',
    })
  })
})

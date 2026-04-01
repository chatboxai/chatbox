import { describe, expect, it } from 'vitest'
import type { Message, MessageAppPart } from '../types/session'
import { selectChatBridgeAppContext, selectChatBridgeAppContexts } from './app-memory'

function createAppPart(overrides: Partial<MessageAppPart> = {}): MessageAppPart {
  return {
    type: 'app',
    appId: overrides.appId ?? 'story-builder',
    appName: overrides.appName ?? 'Story Builder',
    appInstanceId: overrides.appInstanceId ?? 'story-builder-instance-1',
    lifecycle: overrides.lifecycle ?? 'complete',
    summary: overrides.summary ?? 'Raw app summary.',
    summaryForModel: overrides.summaryForModel ?? 'Host-approved app summary.',
    values: overrides.values,
  }
}

function createAppMessage(id: string, part: MessageAppPart): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [part],
  }
}

describe('selectChatBridgeAppContexts', () => {
  it('prefers the most recent active instance and keeps one recent completed context alongside it', () => {
    const contexts = selectChatBridgeAppContexts([
      createAppMessage(
        'debate-complete',
        createAppPart({
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-complete-instance',
          lifecycle: 'complete',
          summaryForModel: 'Debate Arena kept the completed round outcome.',
        })
      ),
      createAppMessage(
        'story-active',
        createAppPart({
          appInstanceId: 'story-active-instance',
          lifecycle: 'active',
          summaryForModel: 'Story Builder has the active draft open.',
        })
      ),
    ])

    expect(contexts).toHaveLength(2)
    expect(contexts[0]).toMatchObject({
      messageId: 'story-active',
      lifecycle: 'active',
      appInstanceId: 'story-active-instance',
    })
    expect(contexts[1]).toMatchObject({
      messageId: 'debate-complete',
      lifecycle: 'complete',
      appInstanceId: 'debate-complete-instance',
    })
  })

  it('keeps up to two recent completed contexts when no app remains active', () => {
    const contexts = selectChatBridgeAppContexts([
      createAppMessage(
        'story-complete',
        createAppPart({
          appInstanceId: 'story-complete-instance',
          lifecycle: 'complete',
          summaryForModel: 'Story Builder kept the saved draft summary.',
        })
      ),
      createAppMessage(
        'debate-complete',
        createAppPart({
          appId: 'debate-arena',
          appName: 'Debate Arena',
          appInstanceId: 'debate-complete-instance',
          lifecycle: 'complete',
          summaryForModel: 'Debate Arena kept the completed round outcome.',
        })
      ),
      createAppMessage(
        'chess-complete',
        createAppPart({
          appId: 'chess',
          appName: 'Chess',
          appInstanceId: 'chess-complete-instance',
          lifecycle: 'complete',
          summaryForModel: 'Chess kept the final board summary.',
        })
      ),
    ])

    expect(contexts).toHaveLength(2)
    expect(contexts.map((context) => context.messageId)).toEqual(['chess-complete', 'debate-complete'])
  })

  it('fails closed per instance instead of blocking every session for the same app id', () => {
    const contexts = selectChatBridgeAppContexts([
      createAppMessage(
        'story-old-active',
        createAppPart({
          appInstanceId: 'story-instance-1',
          lifecycle: 'active',
          summaryForModel: 'This older Story Builder draft should be ignored.',
        })
      ),
      createAppMessage(
        'story-old-stale',
        createAppPart({
          appInstanceId: 'story-instance-1',
          lifecycle: 'stale',
          summaryForModel: undefined,
        })
      ),
      createAppMessage(
        'story-new-active',
        createAppPart({
          appInstanceId: 'story-instance-2',
          lifecycle: 'active',
          summaryForModel: 'The new Story Builder draft should still be selectable.',
        })
      ),
    ])

    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      messageId: 'story-new-active',
      appInstanceId: 'story-instance-2',
    })
    expect(selectChatBridgeAppContext([
      createAppMessage(
        'story-new-active',
        createAppPart({
          appInstanceId: 'story-instance-2',
          lifecycle: 'active',
          summaryForModel: 'The new Story Builder draft should still be selectable.',
        })
      ),
    ])).toMatchObject({
      messageId: 'story-new-active',
      appInstanceId: 'story-instance-2',
    })
  })
})

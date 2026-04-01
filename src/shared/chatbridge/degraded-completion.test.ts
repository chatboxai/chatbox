import type { MessageAppPart } from '../types'
import {
  applyChatBridgeRecoveryAction,
  parseChatBridgeDegradedCompletion,
  readChatBridgeDegradedCompletion,
  writeChatBridgeDegradedCompletionValues,
} from './degraded-completion'
import { describe, expect, it } from 'vitest'

function createBasePart(overrides: Partial<MessageAppPart> = {}): MessageAppPart {
  return {
    type: 'app',
    appId: 'story-builder',
    appName: 'Story Builder',
    appInstanceId: 'story-builder-1',
    lifecycle: 'error',
    summary: 'Story Builder ended in a degraded state.',
    ...overrides,
  }
}

describe('degraded completion helpers', () => {
  it('parses explicit degraded completion metadata from app values', () => {
    const values = writeChatBridgeDegradedCompletionValues(undefined, {
      schemaVersion: 1,
      kind: 'partial-completion',
      statusLabel: 'Partial completion',
      title: 'Completion stopped after a partial draft',
      description: 'The host kept the validated fragment inline.',
      actions: [{ id: 'retry-completion', label: 'Retry completion', variant: 'primary' }],
    })

    const parsed = parseChatBridgeDegradedCompletion(values.chatbridgeDegradedCompletion)

    expect(parsed).toMatchObject({
      kind: 'partial-completion',
      statusLabel: 'Partial completion',
      title: 'Completion stopped after a partial draft',
    })
  })

  it('derives a stale degraded checkpoint when explicit metadata is absent', () => {
    const degraded = readChatBridgeDegradedCompletion(
      createBasePart({
        lifecycle: 'stale',
        fallbackText: 'The cached checkpoint expired before resume completed.',
        statusText: 'Stale checkpoint',
      })
    )

    expect(degraded).toMatchObject({
      kind: 'stale-checkpoint',
      statusLabel: 'Stale checkpoint',
      actions: [{ id: 'resume-from-checkpoint' }, { id: 'ask-for-explanation' }],
    })
  })

  it('derives a runtime error degraded state when explicit metadata is absent', () => {
    const degraded = readChatBridgeDegradedCompletion(
      createBasePart({
        lifecycle: 'error',
        error: 'Bridge session expired before resume completed.',
      })
    )

    expect(degraded).toMatchObject({
      kind: 'runtime-error',
      statusLabel: 'Runtime error',
      actions: [{ id: 'continue-in-chat' }, { id: 'dismiss-runtime' }],
    })
  })

  it('records an acknowledgement when the user chooses a recovery action', () => {
    const part = createBasePart({
      statusText: 'Missing completion',
      values: writeChatBridgeDegradedCompletionValues(undefined, {
        schemaVersion: 1,
        kind: 'missing-completion',
        statusLabel: 'Missing completion',
        title: 'Completion payload never arrived',
        description: 'The runtime ended without a valid completion payload.',
        actions: [{ id: 'continue-in-chat', label: 'Continue safely', variant: 'primary' }],
      }),
    })

    const nextPart = applyChatBridgeRecoveryAction(part, 'continue-in-chat')

    expect(nextPart.statusText).toBe('Continue safely')
    expect(nextPart.values).toMatchObject({
      chatbridgeDegradedCompletion: {
        acknowledgement: {
          requestedActionId: 'continue-in-chat',
          statusLabel: 'Continue safely',
        },
      },
    })
  })
})

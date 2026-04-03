import { createChatBridgeRouteMessagePart } from '@shared/chatbridge'
import type { Message, MessageAppPart } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { resolveChatBridgeFloatingRuntimeTarget } from './floating-runtime'

function createPart(overrides: Partial<MessageAppPart> = {}): MessageAppPart {
  return {
    type: 'app',
    appId: 'chess',
    appName: 'Chess',
    appInstanceId: 'app-1',
    lifecycle: 'active',
    title: 'Chess runtime',
    description: 'Host-owned runtime',
    ...overrides,
  }
}

function createMessage(id: string, parts: MessageAppPart[]): Message {
  return {
    id,
    role: 'assistant',
    timestamp: Date.now(),
    contentParts: parts,
  }
}

function createClarifyRoutePart(): MessageAppPart {
  return createChatBridgeRouteMessagePart({
    schemaVersion: 2,
    hostRuntime: 'desktop-electron',
    kind: 'clarify',
    reasonCode: 'ambiguous-match',
    prompt: 'Move the black queen.',
    summary: 'This request may fit Chess, but the host wants confirmation before launching a reviewed app.',
    selectedAppId: 'chess',
    matches: [
      {
        appId: 'chess',
        appName: 'Chess',
        matchedContexts: [],
        matchedTerms: ['move', 'queen'],
        score: 6,
        exactAppMatch: false,
        exactToolMatch: false,
      },
    ],
  })
}

describe('resolveChatBridgeFloatingRuntimeTarget', () => {
  it('returns the latest eligible app instance in thread order', () => {
    const messages = [
      createMessage('msg-1', [createPart({ appInstanceId: 'app-1', lifecycle: 'active' })]),
      createMessage('msg-2', [createPart({ appId: 'weather', appName: 'Weather', appInstanceId: 'app-2', lifecycle: 'ready' })]),
    ]

    const result = resolveChatBridgeFloatingRuntimeTarget(messages)

    expect(result?.messageId).toBe('msg-2')
    expect(result?.part.appInstanceId).toBe('app-2')
  })

  it('fails closed when the latest record for an instance is no longer floatable', () => {
    const messages = [
      createMessage('msg-1', [createPart({ appInstanceId: 'app-1', lifecycle: 'active' })]),
      createMessage('msg-2', [createPart({ appInstanceId: 'app-1', lifecycle: 'stale' })]),
    ]

    const result = resolveChatBridgeFloatingRuntimeTarget(messages)

    expect(result).toBeNull()
  })

  it('keeps the active runtime pinned when a later clarify artifact is added to the thread', () => {
    const messages = [
      createMessage('msg-1', [createPart({ appInstanceId: 'app-1', lifecycle: 'active' })]),
      createMessage('msg-2', [createClarifyRoutePart()]),
    ]

    const result = resolveChatBridgeFloatingRuntimeTarget(messages)

    expect(result?.messageId).toBe('msg-1')
    expect(result?.part.appInstanceId).toBe('app-1')
  })
})

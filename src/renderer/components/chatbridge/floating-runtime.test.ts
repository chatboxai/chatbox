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
})

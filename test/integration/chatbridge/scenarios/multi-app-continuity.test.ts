import '../setup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX } from '@/packages/chatbridge/context'
import { buildContextForSession } from '@/packages/context-management/context-builder'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import {
  buildMultiAppContinuitySessionFixture,
  buildSupersededInstanceContinuityFixture,
} from '../fixtures/app-aware-session'

describe('ChatBridge multi-app continuity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    queryClient.clear()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    queryClient.clear()
  })

  it('injects one active app context plus one recent completed app context after compaction', async () => {
    const createdSession = await chatStore.createSession(buildMultiAppContinuitySessionFixture())

    queryClient.clear()
    const reloadedSession = await chatStore.getSession(createdSession.id)

    expect(reloadedSession).not.toBeNull()

    const context = buildContextForSession(reloadedSession!)
    const injectedMessages = context.filter((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))

    expect(injectedMessages).toHaveLength(2)
    expect((injectedMessages[0].contentParts[0] as { text: string }).text).toContain('Priority: Primary active app context')
    expect((injectedMessages[0].contentParts[0] as { text: string }).text).toContain('Debate Arena')
    expect((injectedMessages[1].contentParts[0] as { text: string }).text).toContain(
      'Priority: Recent completed app context'
    )
    expect((injectedMessages[1].contentParts[0] as { text: string }).text).toContain('Story Builder')
  })

  it('suppresses a superseded stale instance without dropping continuity for a different recent app', async () => {
    const createdSession = await chatStore.createSession(buildSupersededInstanceContinuityFixture())

    queryClient.clear()
    const reloadedSession = await chatStore.getSession(createdSession.id)

    expect(reloadedSession).not.toBeNull()

    const context = buildContextForSession(reloadedSession!)
    const injectedMessages = context.filter((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))

    expect(injectedMessages).toHaveLength(1)
    expect((injectedMessages[0].contentParts[0] as { text: string }).text).toContain('Debate Arena')
    expect((injectedMessages[0].contentParts[0] as { text: string }).text).not.toContain(
      'older Story Builder draft'
    )
  })
})

import '../setup'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX } from '@/packages/chatbridge/context'
import { buildContextForSession } from '@/packages/context-management/context-builder'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import {
  buildDebateArenaContextInjectionFixture,
  buildMalformedDebateArenaContextFixture,
} from '../fixtures/app-aware-session'

describe('ChatBridge Debate Arena lifecycle proof', () => {
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

  it('injects host-approved Debate Arena continuity into later turns after compaction', async () => {
    const createdSession = await chatStore.createSession(buildDebateArenaContextInjectionFixture())

    queryClient.clear()
    const reloadedSession = await chatStore.getSession(createdSession.id)

    expect(reloadedSession).not.toBeNull()

    const context = buildContextForSession(reloadedSession!)
    const injectedMessage = context.find((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))

    expect(injectedMessage).toBeDefined()
    expect(injectedMessage?.contentParts[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Debate Arena completed the rubric pass and preserved the winning side'),
    })
    expect((injectedMessage?.contentParts[0] as { text: string }).text).toContain('Team Cedar')
    expect(context.map((message) => message.id)).toContain('msg-debate-follow-up')
  })

  it('fails closed when Debate Arena state is malformed and does not inject synthetic continuity', async () => {
    const createdSession = await chatStore.createSession(buildMalformedDebateArenaContextFixture())

    queryClient.clear()
    const reloadedSession = await chatStore.getSession(createdSession.id)

    expect(reloadedSession).not.toBeNull()

    const context = buildContextForSession(reloadedSession!)

    expect(context.some((message) => message.id.startsWith(CHATBRIDGE_APP_CONTEXT_MESSAGE_PREFIX))).toBe(false)
    expect(context.map((message) => message.id)).toContain('msg-malformed-debate-follow-up')
  })
})

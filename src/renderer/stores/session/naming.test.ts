import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncAutoTitle: vi.fn(),
  clearSessionState: vi.fn(),
}))

vi.mock('@chatbox/core/application/session', () => ({
  SessionNamingService: class {
    syncAutoTitle = mocks.syncAutoTitle
    clearSessionState = mocks.clearSessionState
    modifyNameAndThreadName = vi.fn()
    modifyThreadName = vi.fn()
  },
}))

vi.mock('@/adapters/CurrentModelFactory', () => ({ currentModelFactory: {} }))
vi.mock('@/packages/model-calls/message-utils', () => ({ convertToModelMessages: vi.fn() }))
vi.mock('@/settings-runtime', () => ({ settingsService: {} }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSession: vi.fn(), updateSessionWithMessages: vi.fn() },
    sessionQueryBridge: { getSession: vi.fn() },
  },
}))

import { clearSessionNameGenerationState, syncSessionAutoTitle } from './naming'

describe('Session naming Renderer adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards the current session to syncAutoTitle', () => {
    const session = {
      id: 'session-1',
      name: 'Untitled',
      type: 'chat' as const,
      messages: [{ id: 'user', role: 'user' as const, contentParts: [{ type: 'text' as const, text: 'hello' }] }],
    }

    syncSessionAutoTitle(session)

    expect(mocks.syncAutoTitle).toHaveBeenCalledWith(session, { messages: session.messages })
  })

  it('delegates deletion cleanup to the shared naming service', () => {
    clearSessionNameGenerationState('session-1')

    expect(mocks.clearSessionState).toHaveBeenCalledWith('session-1')
  })
})

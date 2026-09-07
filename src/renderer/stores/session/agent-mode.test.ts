import type { Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, updateSessionMock, updateSessionCacheMock, uiStoreState } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  updateSessionMock: vi.fn(),
  updateSessionCacheMock: vi.fn(),
  uiStoreState: {
    sessionAgentModeMap: {} as Record<string, unknown>,
    agentModeSmartSwitchingDefault: false,
    agentModeLastSelected: 'off',
    clearSessionAgentMode: vi.fn(),
  },
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessionQueryBridge: { getSession: getSessionMock, updateSessionCache: updateSessionCacheMock },
    sessions: { updateSession: updateSessionMock },
  },
}))
vi.mock('../uiStore', () => ({
  uiStore: { getState: () => uiStoreState, setState: vi.fn() },
  useUIStore: vi.fn(),
}))

import { setSessionAgentMode } from './agent-mode'

function session(overrides: Partial<Session>): Session {
  return { id: 'session-1', name: 'S', messages: [], ...overrides } as Session
}

const userMsg = { id: 'u1', role: 'user', contentParts: [] } as unknown as Session['messages'][number]

describe('setSessionAgentMode cross-mode freeze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateSessionMock.mockImplementation(async (_id: string, updater: (s: Session) => Session) =>
      updater(getSessionMock.mock.results[0]?.value ? await getSessionMock.mock.results[0].value : session({}))
    )
  })

  it('refuses a manual chat→work switch once the conversation has started', async () => {
    getSessionMock.mockResolvedValue(
      session({ messages: [userMsg], settings: { agentMode: { value: 'off', locked: false, lockReason: null } } })
    )

    const entry = await setSessionAgentMode('session-1', 'on')

    expect(entry.value).toBe('off')
    expect(updateSessionMock).not.toHaveBeenCalled()
    expect(updateSessionCacheMock).not.toHaveBeenCalled()
  })

  it('still allows manual cross-mode switching before the first user message', async () => {
    getSessionMock.mockResolvedValue(
      session({ messages: [], settings: { agentMode: { value: 'off', locked: false, lockReason: null } } })
    )

    await setSessionAgentMode('session-1', 'on')

    expect(updateSessionMock).toHaveBeenCalled()
  })

  it('lets system-source resolution cross modes mid-conversation (suggestion decline)', async () => {
    getSessionMock.mockResolvedValue(
      session({ messages: [userMsg], settings: { agentMode: { value: 'auto', locked: false, lockReason: null } } })
    )

    await setSessionAgentMode('session-1', 'off', { source: 'system' })

    expect(updateSessionMock).toHaveBeenCalled()
  })

  it('treats auto ↔ off as a chat-internal toggle, not a mode change', async () => {
    getSessionMock.mockResolvedValue(
      session({ messages: [userMsg], settings: { agentMode: { value: 'auto', locked: false, lockReason: null } } })
    )

    await setSessionAgentMode('session-1', 'off')

    expect(updateSessionMock).toHaveBeenCalled()
  })

  it('keeps the locked work session refusal ahead of the freeze rule', async () => {
    getSessionMock.mockResolvedValue(
      session({
        messages: [userMsg],
        settings: { agentMode: { value: 'on', locked: true, lockReason: 'message_sent' } },
      })
    )

    const entry = await setSessionAgentMode('session-1', 'off')

    expect(entry.value).toBe('on')
    expect(updateSessionMock).not.toHaveBeenCalled()
  })
})

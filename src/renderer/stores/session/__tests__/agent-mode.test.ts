import type { Session } from '@shared/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { sessionsById, getSessionMock, updateSessionCacheSyncMock, updateSessionMock } = vi.hoisted(() => {
  const sessions = new Map<string, Session>()
  type SessionUpdater = Partial<Session> | ((session: Session) => Partial<Session>)
  const applyUpdate = (sessionId: string, update: SessionUpdater) => {
    const session = sessions.get(sessionId)
    if (!session) return null
    const patch = typeof update === 'function' ? update(session) : update
    const next = { ...session, ...patch }
    sessions.set(sessionId, next)
    return next
  }
  return {
    sessionsById: sessions,
    getSessionMock: vi.fn(async (sessionId: string) => sessions.get(sessionId) ?? null),
    updateSessionCacheSyncMock: vi.fn(applyUpdate),
    updateSessionMock: vi.fn(applyUpdate),
  }
})

vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
  const windowMock: Record<string, unknown> = {
    electronAPI: undefined,
    localStorage: storage,
  }
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).window = windowMock
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).localStorage = storage
  return {}
})

vi.mock('@/platform', () => ({
  default: { type: 'web' },
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: {
    sessions: { updateSession: updateSessionMock },
    sessionQueryBridge: {
      getSession: getSessionMock,
      updateSessionCache: updateSessionCacheSyncMock,
    },
    sessionHooks: { useSession: () => ({ session: null }) },
  },
}))

import { uiStore } from '../../uiStore'
import {
  createNewChatAgentModeEntry,
  getSessionAgentModeEntry,
  lockSessionAgentMode,
  setSessionAgentMode,
} from '../agent-mode'

const defaultEntry = { value: 'auto', locked: false, lockReason: null } as const

beforeEach(() => {
  sessionsById.clear()
  getSessionMock.mockClear()
  updateSessionCacheSyncMock.mockClear()
  updateSessionMock.mockClear()
  uiStore.setState({ sessionAgentModeMap: {}, agentModeSmartSwitchingDefault: true, agentModeLastSelected: 'off' })
})

describe('setSessionAgentMode', () => {
  test('writes agent mode into session settings', async () => {
    sessionsById.set('session-1', { id: 'session-1', name: 'Test', messages: [], settings: {} })

    await setSessionAgentMode('session-1', 'on')

    expect(updateSessionCacheSyncMock).toHaveBeenCalledTimes(1)
    expect(updateSessionMock).toHaveBeenCalledTimes(1)
    expect(sessionsById.get('session-1')?.settings?.agentMode).toEqual({
      value: 'on',
      locked: false,
      lockReason: null,
    })
  })

  test('stores "auto" as-is for session settings', async () => {
    sessionsById.set('session-1', { id: 'session-1', name: 'Test', messages: [], settings: {} })

    await setSessionAgentMode('session-1', 'auto')

    expect(sessionsById.get('session-1')?.settings?.agentMode).toEqual({
      value: 'auto',
      locked: false,
      lockReason: null,
    })
  })

  test('blocks setting "off" when locked', async () => {
    sessionsById.set('session-locked', {
      id: 'session-locked',
      name: 'Test',
      messages: [],
      settings: { agentMode: { value: 'on', locked: true, lockReason: 'message_sent' } },
    })

    await setSessionAgentMode('session-locked', 'off')

    expect(updateSessionCacheSyncMock).not.toHaveBeenCalled()
    expect(updateSessionMock).not.toHaveBeenCalled()
    expect(sessionsById.get('session-locked')?.settings?.agentMode).toEqual({
      value: 'on',
      locked: true,
      lockReason: 'message_sent',
    })
  })

  test('uses the latest queued session state when checking locks', async () => {
    getSessionMock.mockResolvedValueOnce({
      id: 'session-race',
      name: 'Test',
      messages: [],
      settings: { agentMode: { value: 'on', locked: false, lockReason: null } },
    })
    sessionsById.set('session-race', {
      id: 'session-race',
      name: 'Test',
      messages: [],
      settings: { agentMode: { value: 'on', locked: true, lockReason: 'message_sent' } },
    })

    await setSessionAgentMode('session-race', 'off')

    expect(sessionsById.get('session-race')?.settings?.agentMode).toEqual({
      value: 'on',
      locked: true,
      lockReason: 'message_sent',
    })
  })

  test('keeps the transient map for the new session', async () => {
    await setSessionAgentMode('new', 'off')

    expect(updateSessionCacheSyncMock).not.toHaveBeenCalled()
    expect(updateSessionMock).not.toHaveBeenCalled()
    expect(uiStore.getState().sessionAgentModeMap.new).toEqual({ value: 'off', locked: false, lockReason: null })
  })

  test('preserves sibling session settings through functional updates', async () => {
    sessionsById.set('session-1', {
      id: 'session-1',
      name: 'Test',
      messages: [],
      settings: { provider: 'openai', modelId: 'gpt-4.1' },
    })

    await setSessionAgentMode('session-1', 'on')

    expect(sessionsById.get('session-1')?.settings).toEqual({
      provider: 'openai',
      modelId: 'gpt-4.1',
      agentMode: { value: 'on', locked: false, lockReason: null },
    })
  })
})

describe('lockSessionAgentMode', () => {
  test('sets value="on", locked=true, and lockReason in session settings', async () => {
    sessionsById.set('session-lock', { id: 'session-lock', name: 'Test', messages: [], settings: {} })

    await lockSessionAgentMode('session-lock', 'message_sent')

    expect(sessionsById.get('session-lock')?.settings?.agentMode).toEqual({
      value: 'on',
      locked: true,
      lockReason: 'message_sent',
    })
  })

  test.each(['message_sent', 'file_upload', 'load_skill'] as const)('with reason type: %s', async (reason) => {
    sessionsById.set(`session-${reason}`, { id: `session-${reason}`, name: 'Test', messages: [], settings: {} })

    await lockSessionAgentMode(`session-${reason}`, reason)

    expect(sessionsById.get(`session-${reason}`)?.settings?.agentMode).toEqual({
      value: 'on',
      locked: true,
      lockReason: reason,
    })
  })
})

describe('getSessionAgentModeEntry', () => {
  test('returns default for unknown session', () => {
    const entry = getSessionAgentModeEntry('nonexistent-session')
    expect(entry).toEqual(defaultEntry)
  })

  test('uses smart switching preference for unknown sessions', () => {
    uiStore.getState().setAgentModeSmartSwitchingDefault(false)
    expect(getSessionAgentModeEntry('new')).toEqual({ value: 'off', locked: false, lockReason: null })

    uiStore.getState().setAgentModeSmartSwitchingDefault(true)
    expect(getSessionAgentModeEntry('new')).toEqual(defaultEntry)
  })

  test('prefers session settings over legacy uiStore map', () => {
    uiStore.setState({
      sessionAgentModeMap: {
        'known-session': { value: 'on', locked: true, lockReason: 'file_upload' },
      },
    })
    const entry = getSessionAgentModeEntry('known-session', {
      settings: { agentMode: { value: 'off', locked: false, lockReason: null } },
    })

    expect(entry).toEqual({ value: 'off', locked: false, lockReason: null })
  })

  test('starts a new chat in the last explicitly selected mode', () => {
    uiStore.getState().setAgentModeLastSelected('on')

    expect(getSessionAgentModeEntry('new')).toEqual({ value: 'on', locked: false, lockReason: null })
  })

  test('keeps existing sessions without a stored mode in chat mode even when Work Mode is remembered', () => {
    uiStore.getState().setAgentModeLastSelected('on')

    expect(getSessionAgentModeEntry('legacy-session')).toEqual(defaultEntry)
    expect(getSessionAgentModeEntry('legacy-session', { settings: {} })).toEqual(defaultEntry)
  })

  test('prefers the transient new-session selection over the remembered mode', () => {
    uiStore.getState().setAgentModeLastSelected('on')
    uiStore.setState({
      sessionAgentModeMap: { new: { value: 'off', locked: false, lockReason: null } },
    })

    expect(getSessionAgentModeEntry('new')).toEqual({ value: 'off', locked: false, lockReason: null })
  })
})

describe('createNewChatAgentModeEntry', () => {
  test('returns Work Mode when it was the last explicit selection', () => {
    expect(createNewChatAgentModeEntry('on', true)).toEqual({ value: 'on', locked: false, lockReason: null })
    expect(createNewChatAgentModeEntry('on', false)).toEqual({ value: 'on', locked: false, lockReason: null })
  })

  test('falls back to the smart switching preference for chat mode', () => {
    expect(createNewChatAgentModeEntry('off', true)).toEqual(defaultEntry)
    expect(createNewChatAgentModeEntry('off', false)).toEqual({ value: 'off', locked: false, lockReason: null })
  })
})

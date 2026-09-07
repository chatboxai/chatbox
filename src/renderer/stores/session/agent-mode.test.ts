import type { Session } from '@shared/types'
import { RowBackedSessionRepository, SessionWriteCoordinator } from '@chatbox/core/application/session'
import { InMemorySessionRecordStore, InMemorySessionRepository, InMemorySessionRowStore } from '@chatbox/core/testing'
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

import { lockSessionAgentMode, setSessionAgentMode } from './agent-mode'

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

  it.each(['legacy', 'rows'] as const)(
    'persists the first mode change after reopening a %s session',
    async (format) => {
      const records = new InMemorySessionRecordStore()
      const repository = Object.assign(
        new RowBackedSessionRepository({ records, rows: new InMemorySessionRowStore() }),
        {
          meta: new InMemorySessionRepository().meta,
        }
      )
      await repository.initialize()
      await records.setRecord(
        session({ type: 'chat', settings: { agentMode: { value: 'off', locked: false, lockReason: null } } })
      )
      if (format === 'rows') await repository.migrateSession('session-1')
      let cached = await repository.getSession('session-1')
      const writes = new SessionWriteCoordinator(repository, { readCurrentSession: () => Promise.resolve(cached) })
      getSessionMock.mockImplementation(() => Promise.resolve(cached))
      updateSessionCacheMock.mockImplementation((_id, updater) => {
        cached = updater(cached)
      })
      updateSessionMock.mockImplementation(async (id, updater) => {
        const result = await writes.update(id, updater)
        cached = result.session
        return cached
      })

      await expect(setSessionAgentMode('session-1', 'auto')).resolves.toMatchObject({ value: 'auto' })
      expect((await repository.getSession('session-1'))?.settings?.agentMode?.value).toBe('auto')
      writes.forget('session-1')
      await expect(lockSessionAgentMode('session-1', 'message_sent')).resolves.toMatchObject({ locked: true })
      expect((await repository.getSession('session-1'))?.settings?.agentMode).toMatchObject({
        value: 'on',
        locked: true,
      })
    }
  )

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

import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, readControlMock, toastMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  readControlMock: vi.fn(),
  toastMock: vi.fn(),
}))

vi.mock('../toastActions', () => ({ add: toastMock }))
vi.mock('i18next', () => ({ t: (key: string) => key }))
// The mode-aware guard resolves the session's agent mode, whose module pulls
// uiStore → platform → the real i18n init; stub the store like
// agent-mode.test.ts does to keep this suite off that graph.
vi.mock('../uiStore', () => ({
  uiStore: {
    getState: () => ({ sessionAgentModeMap: {}, agentModeSmartSwitchingDefault: false, agentModeLastSelected: 'off' }),
    setState: vi.fn(),
  },
  useUIStore: vi.fn(),
}))
vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  const { BackupOperationCoordinator } = await import('@chatbox/core/backup')
  const { createRowSessionFixtureReads } = await import('./testing/row-session-fixture')
  const reads = createRowSessionFixtureReads(getSessionMock)
  readControlMock.mockImplementation(reads.readSessionGenerationControl)
  return {
    rendererApplication: {
      backupOperations: new BackupOperationCoordinator(),
      generationRuntime: new GenerationRuntimeStore(),
      sessions: { ...reads, readSessionGenerationControl: readControlMock },
    },
  }
})

import { rendererApplication } from '@/app/renderer-application'
import { setCompactionUIState } from '../atoms/compactionAtoms'
import { getSessionLockStateNow, guardSessionAction } from './action-guard'

const generationRuntimeStore = rendererApplication.generationRuntime

function message(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'message-id',
    role: overrides.role ?? 'assistant',
    contentParts: overrides.contentParts ?? [],
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session',
    messages: [message({ id: 'user', role: 'user' })],
    ...overrides,
  }
}

describe('guardSessionAction', () => {
  it('rejects a new user action during backup and allows it after cleanup', async () => {
    getSessionMock.mockResolvedValue(session())
    await rendererApplication.backupOperations.run('export', async () => {
      expect(await guardSessionAction('session-1', 'submit-message')).toBe(false)
      expect(await guardSessionAction('session-1', 'switch-fork')).toBe(false)
    })
    expect(await guardSessionAction('session-1', 'submit-message')).toBe(true)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue(session())
    readControlMock.mockReset()
    readControlMock.mockImplementation(async (request) => {
      const { createRowSessionFixtureReads } = await import('./testing/row-session-fixture')
      return createRowSessionFixtureReads(getSessionMock).readSessionGenerationControl(request)
    })
    setCompactionUIState('session-1', { status: 'idle' })
    generationRuntimeStore.clear('session-1')
  })

  it('reads lock control without fetching a header used only by the action mode guard', async () => {
    readControlMock.mockResolvedValue({
      generatingReplyCount: 0,
      anyReplyGenerating: false,
      awaitingPauseDecision: false,
    })
    const header = vi.spyOn(rendererApplication.sessions, 'getSessionHeader')
    await expect(getSessionLockStateNow('session-1')).resolves.toMatchObject({ anyReplyGenerating: false })
    expect(readControlMock).toHaveBeenCalledOnce()
    expect(header).not.toHaveBeenCalled()
  })

  it('passes runtime IDs to exact row control and preserves persisted generating gates', async () => {
    readControlMock.mockResolvedValue({
      generatingReplyCount: 0,
      anyReplyGenerating: true,
      awaitingPauseDecision: false,
    })
    expect(await guardSessionAction('session-1', 'submit-message')).toBe(false)
    expect(readControlMock).toHaveBeenCalledWith({ sessionId: 'session-1', activeGenerationMessageIds: [] })
    generationRuntimeStore.start('session-1', 'reply')
    readControlMock.mockResolvedValue({
      generatingReplyCount: 1,
      anyReplyGenerating: true,
      awaitingPauseDecision: false,
    })
    expect(await guardSessionAction('session-1', 'regenerate')).toBe(false)
    expect(readControlMock).toHaveBeenLastCalledWith({ sessionId: 'session-1', activeGenerationMessageIds: ['reply'] })
  })

  it('allows the action and stays silent when the session is unlocked', async () => {
    getSessionMock.mockResolvedValue(session())

    await expect(guardSessionAction('session-1', 'switch-fork')).resolves.toBe(true)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('blocks regenerate-class actions and toasts while a reply streams', async () => {
    generationRuntimeStore.start('session-1', 'reply')
    getSessionMock.mockResolvedValue(
      session({
        messages: [message({ id: 'user', role: 'user' }), message({ id: 'reply', generating: true })],
      })
    )

    await expect(guardSessionAction('session-1', 'regenerate')).resolves.toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Wait for the current replies to finish', 2500)
  })

  it('injects the session mode: chat may switch forks mid-generation, work mode stays locked', async () => {
    generationRuntimeStore.start('session-1', 'reply')
    const streamingMessages = [message({ id: 'user', role: 'user' }), message({ id: 'reply', generating: true })]
    getSessionMock.mockResolvedValue(session({ messages: streamingMessages }))

    await expect(guardSessionAction('session-1', 'switch-fork')).resolves.toBe(true)
    expect(toastMock).not.toHaveBeenCalled()

    getSessionMock.mockResolvedValue(
      session({
        messages: streamingMessages,
        settings: { agentMode: { value: 'on', locked: true, lockReason: 'message_sent' } },
      })
    )

    await expect(guardSessionAction('session-1', 'switch-fork')).resolves.toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Wait for the current replies to finish', 2500)
  })

  it('blocks fork switching while compaction runs for this session', async () => {
    getSessionMock.mockResolvedValue(session())
    setCompactionUIState('session-1', { status: 'running' })

    await expect(guardSessionAction('session-1', 'switch-fork')).resolves.toBe(false)
    expect(toastMock).toHaveBeenCalledWith('Wait for compaction to finish', 2500)
  })

  it('blocks mutations in legacy picture sessions but still allows branch navigation', async () => {
    getSessionMock.mockResolvedValue(session({ type: 'picture' }))

    await expect(guardSessionAction('session-1', 'regenerate')).resolves.toBe(false)
    expect(toastMock).toHaveBeenCalledWith('This session is read-only', 2500)

    toastMock.mockClear()
    await expect(guardSessionAction('session-1', 'switch-fork')).resolves.toBe(true)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('lets the action surface its own handling when the session is missing', async () => {
    getSessionMock.mockResolvedValue(null)

    await expect(guardSessionAction('missing', 'submit-message')).resolves.toBe(true)
    expect(toastMock).not.toHaveBeenCalled()
  })
})

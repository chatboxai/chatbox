import { createMessage, type Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createModelMock,
  getConfigMock,
  getSessionMock,
  getSessionSettingsMock,
  initializeTargetMessageMock,
  persistStreamingMessageMock,
  updateSessionCacheSyncMock,
  updateSessionWithMessagesMock,
} = vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
  ;(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage
  ;(globalThis as unknown as { window: { localStorage: typeof storage } }).window = { localStorage: storage }
  return {
    createModelMock: vi.fn(),
    getConfigMock: vi.fn(),
    getSessionMock: vi.fn(),
    getSessionSettingsMock: vi.fn(),
    initializeTargetMessageMock: vi.fn(),
    persistStreamingMessageMock: vi.fn(),
    updateSessionCacheSyncMock: vi.fn(),
    updateSessionWithMessagesMock: vi.fn(),
  }
})

vi.mock('@/adapters', () => ({
  createModel: createModelMock,
  createModelDependencies: vi.fn(),
}))
vi.mock('@/platform', () => ({
  default: { type: 'web', getConfig: getConfigMock },
}))
vi.mock('@/router', () => ({
  router: { state: { location: { pathname: '/' } } },
}))
vi.mock('../chatStore', () => ({
  getSession: getSessionMock,
  getSessionSettings: getSessionSettingsMock,
  updateSessionCacheSync: updateSessionCacheSyncMock,
  updateSession: vi.fn(),
  updateSessionWithMessages: updateSessionWithMessagesMock,
}))
vi.mock('../scrollActions', () => ({ scrollToBottom: vi.fn() }))
vi.mock('../settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => ({}) }) },
}))
vi.mock('@/hooks/dom', () => ({ focusMessageInput: vi.fn() }))
vi.mock('./crud', () => ({ _copySession: vi.fn(), switchCurrentSession: vi.fn() }))
vi.mock('./messages', () => ({
  modifyMessage: vi.fn(),
  persistStreamingMessage: persistStreamingMessageMock,
  updateStreamingCache: vi.fn(),
}))
vi.mock('./utils', () => ({
  findTargetMessageIndex: vi.fn(),
  getCompactionPointsForTarget: vi.fn(),
  getSessionWebBrowsing: vi.fn(),
  handleGenerationError: vi.fn(),
  initializeTargetMessage: initializeTargetMessageMock,
  trackGenerateEvent: vi.fn(),
}))
vi.mock('uuid', () => ({ v4: () => 'new-thread-id' }))

import { resetSessionActivityStore, sessionActivityStore } from '../sessionActivityStore'
import { generationRuntimeStore, isSessionGenerating, resetSessionGenerationRuntime } from './generation-runtime'
import { orchestrateGeneration } from './orchestration'
import { removeCurrentThread } from './threads'

describe('generation setup cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionGenerationRuntime()
    resetSessionActivityStore()
    getSessionSettingsMock.mockResolvedValue({ provider: 'mock', modelId: 'mock-model' })
    getConfigMock.mockResolvedValue({})
    persistStreamingMessageMock.mockResolvedValue(undefined)
    updateSessionWithMessagesMock.mockResolvedValue(undefined)
    initializeTargetMessageMock.mockImplementation(async (message) => ({
      ...message,
      cancel: undefined,
      generating: true,
    }))
  })

  it('cancels rollback during the first setup await without recording a successful completion', async () => {
    const storedMessage = { ...createMessage('assistant', ''), id: 'assistant-placeholder', generating: true }
    const targetMessage = { ...storedMessage }
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [{ ...createMessage('user', 'Question'), id: 'user-message' }, storedMessage],
    }
    let resumeSessionRead!: (session: Session) => void
    const pausedSessionRead = new Promise<Session>((resolve) => {
      resumeSessionRead = resolve
    })
    getSessionMock.mockReturnValueOnce(pausedSessionRead).mockResolvedValue(session)
    updateSessionCacheSyncMock.mockImplementation((_sessionId, updater) => updater(session))

    const generation = orchestrateGeneration(session.id, targetMessage)

    expect(getSessionMock).toHaveBeenCalledOnce()
    expect(targetMessage).not.toBe(storedMessage)
    expect(targetMessage.cancel).toBeTypeOf('function')
    expect(storedMessage.cancel).toBe(targetMessage.cancel)
    expect(updateSessionCacheSyncMock).toHaveBeenCalledOnce()
    expect(updateSessionCacheSyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      getSessionMock.mock.invocationCallOrder[0]
    )
    expect(isSessionGenerating(generationRuntimeStore.getState(), session.id)).toBe(true)
    const cancel = vi.fn(storedMessage.cancel)
    storedMessage.cancel = cancel

    await removeCurrentThread(session.id)
    expect(getSessionMock).toHaveBeenCalledTimes(2)
    expect(updateSessionWithMessagesMock).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    resumeSessionRead(session)
    await generation

    expect(getSessionSettingsMock).not.toHaveBeenCalled()
    expect(getConfigMock).not.toHaveBeenCalled()
    expect(initializeTargetMessageMock).not.toHaveBeenCalled()
    expect(createModelMock).not.toHaveBeenCalled()
    expect(persistStreamingMessageMock).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        id: targetMessage.id,
        generating: false,
        cancel: undefined,
        finishReason: 'canceled',
      }),
      { refreshCounting: true }
    )
    expect(isSessionGenerating(generationRuntimeStore.getState(), session.id)).toBe(false)
    expect(sessionActivityStore.getState().unreadCompletedSessionIds[session.id]).toBeUndefined()
  })
})

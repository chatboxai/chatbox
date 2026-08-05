import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createModelMock,
  generateWithoutSessionLockMock,
  getSessionMock,
  getSessionSettingsMock,
  insertMessageMock,
  removeMessageMock,
  runCompactionWithUIStateMock,
} = vi.hoisted(() => ({
  createModelMock: vi.fn(),
  generateWithoutSessionLockMock: vi.fn(),
  getSessionMock: vi.fn(),
  getSessionSettingsMock: vi.fn(),
  insertMessageMock: vi.fn(),
  removeMessageMock: vi.fn(),
  runCompactionWithUIStateMock: vi.fn(),
}))

vi.mock('@/adapters', () => ({ createModel: createModelMock }))
vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: runCompactionWithUIStateMock }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: vi.fn().mockReturnValue(1) }))
vi.mock('@/platform', () => ({ default: { type: 'test' } }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('@shared/utils/message', () => ({ countMessageWords: vi.fn().mockReturnValue(1) }))
vi.mock('../chatStore', () => ({
  getSession: getSessionMock,
  getSessionSettings: getSessionSettingsMock,
  insertMessage: insertMessageMock,
  removeMessage: removeMessageMock,
  updateMessage: vi.fn(),
}))
vi.mock('../settingActions', () => ({
  getRemoteConfig: vi.fn().mockResolvedValue({}),
  isPro: vi.fn().mockReturnValue(false),
}))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => ({}) }) } }))
vi.mock('./generation', () => ({ _generateWithoutSessionLock: generateWithoutSessionLockMock }))
vi.mock('./generation-lock', () => ({ withSessionGenerationLock: vi.fn((_sessionId, callback) => callback()) }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn().mockReturnValue(false) }))

import { _submitNewUserMessageWithoutSessionLock } from './messages'

function userMessage(): Message {
  return { id: 'user-1', role: 'user', contentParts: [{ type: 'text', text: 'Hello' }] }
}

describe('unlocked user-message submission outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({ id: 'session-1', type: 'chat', messages: [] })
    getSessionSettingsMock.mockResolvedValue({ provider: 'test', modelId: 'test-model' })
    insertMessageMock.mockResolvedValue(undefined)
    removeMessageMock.mockResolvedValue(undefined)
    runCompactionWithUIStateMock.mockResolvedValue({ success: true })
    createModelMock.mockResolvedValue({})
  })

  it('reports a committed completed generation and notifies after the user message commits', async () => {
    const onUserMessageCommitted = vi.fn()
    generateWithoutSessionLockMock.mockResolvedValueOnce({ status: 'completed' })

    const result = await _submitNewUserMessageWithoutSessionLock('session-1', {
      newUserMsg: userMessage(),
      needGenerating: true,
      onUserMessageCommitted,
    })

    expect(result).toEqual({
      committed: true,
      generation: { status: 'completed' },
    })
    expect(onUserMessageCommitted).toHaveBeenCalledOnce()
  })

  it('leaves the message uncommitted when compaction fails', async () => {
    const onUserMessageCommitted = vi.fn()
    runCompactionWithUIStateMock.mockResolvedValueOnce({ success: false, error: new Error('Compaction failed') })

    await expect(
      _submitNewUserMessageWithoutSessionLock('session-1', {
        newUserMsg: userMessage(),
        needGenerating: true,
        onUserMessageCommitted,
      })
    ).rejects.toThrow('Compaction failed')

    expect(onUserMessageCommitted).not.toHaveBeenCalled()
  })

  it('does not report a commit when the session disappears before inserting the user message', async () => {
    // Catches notifying the queue dispatcher after insertMessage silently skips a deleted session.
    const onUserMessageCommitted = vi.fn()
    getSessionMock
      .mockResolvedValueOnce({ id: 'session-1', type: 'chat', messages: [] })
      .mockResolvedValueOnce(undefined)

    const result = await _submitNewUserMessageWithoutSessionLock('session-1', {
      newUserMsg: userMessage(),
      needGenerating: false,
      onUserMessageCommitted,
    })

    expect(result).toEqual({
      committed: false,
      generation: { status: 'failed', error: 'Session not found before user message commit' },
    })
    expect(onUserMessageCommitted).not.toHaveBeenCalled()
  })

  it('does not insert or report a commit after its queue dispatch is invalidated', async () => {
    // Catches a cleared or replaced session committing a stale queued submission.
    const onUserMessageCommitted = vi.fn()

    const result = await _submitNewUserMessageWithoutSessionLock('session-1', {
      newUserMsg: userMessage(),
      needGenerating: false,
      onUserMessageCommitted,
      shouldCommit: () => false,
    })

    expect(result).toEqual({
      committed: false,
      generation: { status: 'failed', error: 'Queued submission was discarded before commit' },
    })
    expect(onUserMessageCommitted).not.toHaveBeenCalled()
    expect(insertMessageMock).not.toHaveBeenCalled()
  })

  it('removes a user message inserted while its queue dispatch is invalidated', async () => {
    // Catches a clear or thread replacement that lands while insertMessage is awaiting storage.
    let releaseInsert = () => {}
    let notifyInsertStarted = () => {}
    const insertStarted = new Promise<void>((resolve) => {
      notifyInsertStarted = resolve
    })
    insertMessageMock.mockImplementationOnce(
      () =>
        new Promise<void>((insertResolve) => {
          notifyInsertStarted()
          releaseInsert = insertResolve
        })
    )
    let dispatchIsCurrent = true
    const onUserMessageCommitted = vi.fn()

    const resultPromise = _submitNewUserMessageWithoutSessionLock('session-1', {
      newUserMsg: userMessage(),
      needGenerating: false,
      shouldCommit: () => dispatchIsCurrent,
      onUserMessageCommitted,
    })

    await insertStarted
    dispatchIsCurrent = false
    releaseInsert()

    await expect(resultPromise).resolves.toEqual({
      committed: false,
      generation: { status: 'failed', error: 'Queued submission was discarded during user message commit' },
    })
    expect(removeMessageMock).toHaveBeenCalledWith('session-1', 'user-1')
    expect(onUserMessageCommitted).not.toHaveBeenCalled()
  })

  it('reports model-generation failures after committing the user message', async () => {
    generateWithoutSessionLockMock.mockResolvedValueOnce({ status: 'failed', error: 'provider failed' })

    const result = await _submitNewUserMessageWithoutSessionLock('session-1', {
      newUserMsg: userMessage(),
      needGenerating: true,
    })

    expect(result).toEqual({
      committed: true,
      generation: { status: 'failed', error: 'provider failed' },
    })
  })
})

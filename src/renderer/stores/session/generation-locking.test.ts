import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  getSessionSettingsMock,
  createNewForkMock,
  createSaveAndResendForkMock,
  findMessageLocationMock,
  insertMessageAfterMock,
  modifyMessageMock,
  orchestrateGenerationMock,
  guardSessionActionMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionSettingsMock: vi.fn(),
  createNewForkMock: vi.fn(),
  createSaveAndResendForkMock: vi.fn(),
  findMessageLocationMock: vi.fn(),
  insertMessageAfterMock: vi.fn(),
  modifyMessageMock: vi.fn(),
  orchestrateGenerationMock: vi.fn(),
  guardSessionActionMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', () => ({
  rendererApplication: { sessionQueryBridge: { getSession: getSessionMock } },
}))
vi.mock('./session-settings', () => ({
  getSessionSettings: getSessionSettingsMock,
  getSessionTokenModel: () => undefined,
}))
vi.mock('./attachment-resolver', () => ({ createAttachmentResolver: vi.fn() }))
vi.mock('./forks', () => ({
  createNewFork: createNewForkMock,
  createSaveAndResendFork: createSaveAndResendForkMock,
  findMessageLocation: findMessageLocationMock,
}))
vi.mock('./messages', () => ({ insertMessageAfter: insertMessageAfterMock, modifyMessage: modifyMessageMock }))
vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: { orchestrate: orchestrateGenerationMock },
}))
vi.mock('./action-guard', () => ({ guardSessionAction: guardSessionActionMock }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: () => 0 }))

import { resetSessionGenerationLocksForTests } from '@chatbox/core/generation'
import { generate, generateMore, regenerateInNewFork, saveAndResendMessage } from './generation'

function message(id: string): Message {
  return { id, role: 'assistant', contentParts: [], generating: true }
}

function userMessage(id: string): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text: 'edited text' }] }
}

describe('generation entry-point locking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionGenerationLocksForTests()
    getSessionMock.mockResolvedValue({ id: 'session-1', name: 'Session', messages: [] })
    getSessionSettingsMock.mockResolvedValue({})
    guardSessionActionMock.mockResolvedValue(true)
    insertMessageAfterMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetSessionGenerationLocksForTests()
  })

  it('serializes public generation calls for the same session', async () => {
    let finishFirst = () => {}
    const firstGeneration = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    orchestrateGenerationMock.mockReturnValueOnce(firstGeneration).mockResolvedValueOnce(undefined)

    const first = generate('session-1', message('assistant-1'))
    const second = generate('session-1', message('assistant-2'))

    await vi.waitFor(() => expect(orchestrateGenerationMock).toHaveBeenCalledOnce())
    finishFirst()
    await Promise.all([first, second])

    expect(orchestrateGenerationMock.mock.calls.map((call) => call[1].id)).toEqual(['assistant-1', 'assistant-2'])
  })

  it('starts multiple alternative replies for the same message concurrently', async () => {
    let finishFirst = () => {}
    const firstGeneration = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    orchestrateGenerationMock.mockReturnValueOnce(firstGeneration).mockResolvedValueOnce(undefined)

    const first = generateMore('session-1', 'user-1')
    await vi.waitFor(() => expect(orchestrateGenerationMock).toHaveBeenCalledOnce())

    const second = generateMore('session-1', 'user-1')
    await vi.waitFor(() => expect(orchestrateGenerationMock).toHaveBeenCalledTimes(2))

    // Reply Again Below inserts flat into the active path — no fork branches.
    expect(createNewForkMock).not.toHaveBeenCalled()
    expect(insertMessageAfterMock).toHaveBeenCalledTimes(2)
    expect(insertMessageAfterMock.mock.calls.map((call) => call[2])).toEqual(['user-1', 'user-1'])
    expect(
      orchestrateGenerationMock.mock.calls.every(
        (call) => call[2].operationType === 'regenerate' && !call[2].contextMessages
      )
    ).toBe(true)

    finishFirst()
    await Promise.all([first, second])
  })

  it('inserts the new reply directly below the target message', async () => {
    await generateMore('session-1', 'user-1')

    expect(insertMessageAfterMock).toHaveBeenCalledOnce()
    expect(insertMessageAfterMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'assistant', generating: true }),
      'user-1'
    )
    expect(orchestrateGenerationMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'assistant' }),
      { operationType: 'regenerate' }
    )
  })

  it('refuses Reply Again Below in work-mode sessions (mode-policy backstop)', async () => {
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      name: 'Session',
      messages: [],
      settings: { agentMode: { value: 'on', locked: true, lockReason: 'message_sent' } },
    })

    await generateMore('session-1', 'user-1')

    expect(insertMessageAfterMock).not.toHaveBeenCalled()
    expect(orchestrateGenerationMock).not.toHaveBeenCalled()
  })

  it('versions the prompt on Save & Resend and replies below the replacement', async () => {
    const edited = userMessage('user-1')
    findMessageLocationMock.mockReturnValue({ list: [edited], index: 0 })
    createSaveAndResendForkMock.mockResolvedValue(true)

    await saveAndResendMessage('session-1', edited)

    expect(createSaveAndResendForkMock).toHaveBeenCalledOnce()
    const [, targetId, replacement] = createSaveAndResendForkMock.mock.calls[0]
    expect(targetId).toBe('user-1')
    expect(replacement.id).not.toBe('user-1')
    expect(replacement.contentParts).toEqual(edited.contentParts)
    // The original is never overwritten in place on this path.
    expect(modifyMessageMock).not.toHaveBeenCalled()
    expect(createNewForkMock).not.toHaveBeenCalled()
    expect(insertMessageAfterMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'assistant', generating: true }),
      replacement.id
    )
    expect(orchestrateGenerationMock).toHaveBeenCalledOnce()
  })

  it('falls back to the legacy overwrite shape when the target has no predecessor', async () => {
    const edited = userMessage('user-1')
    findMessageLocationMock.mockReturnValue({ list: [edited], index: 0 })
    createSaveAndResendForkMock.mockResolvedValue(false)

    await saveAndResendMessage('session-1', edited)

    expect(modifyMessageMock).toHaveBeenCalledWith('session-1', edited, true)
    expect(createNewForkMock).toHaveBeenCalledWith('session-1', 'user-1')
    expect(insertMessageAfterMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'assistant', generating: true }),
      'user-1'
    )
  })

  it('saves the edit in place when the store-side guard blocks the resend', async () => {
    const edited = userMessage('user-1')
    findMessageLocationMock.mockReturnValue({ list: [edited], index: 0 })
    guardSessionActionMock.mockResolvedValue(false)

    await saveAndResendMessage('session-1', edited)

    expect(modifyMessageMock).toHaveBeenCalledWith('session-1', edited, true)
    expect(createSaveAndResendForkMock).not.toHaveBeenCalled()
    expect(orchestrateGenerationMock).not.toHaveBeenCalled()
  })

  it('still saves the edit when the guarded session read fails', async () => {
    const edited = userMessage('user-1')
    getSessionMock.mockRejectedValueOnce(new Error('storage read failed'))

    await saveAndResendMessage('session-1', edited)

    expect(modifyMessageMock).toHaveBeenCalledWith('session-1', edited, true)
    expect(createSaveAndResendForkMock).not.toHaveBeenCalled()
    expect(orchestrateGenerationMock).not.toHaveBeenCalled()
  })

  it('swallows a follow-up save failure after a failed session read', async () => {
    const edited = userMessage('user-1')
    getSessionMock.mockRejectedValueOnce(new Error('storage read failed'))
    modifyMessageMock.mockRejectedValueOnce(new Error('write failed'))

    await expect(saveAndResendMessage('session-1', edited)).resolves.toBeUndefined()
  })

  it('still saves the edit when the atomic fork write fails', async () => {
    const edited = userMessage('user-1')
    findMessageLocationMock.mockReturnValue({ list: [edited], index: 0 })
    createSaveAndResendForkMock.mockRejectedValueOnce(new Error('storage write failed'))

    await saveAndResendMessage('session-1', edited)

    expect(modifyMessageMock).toHaveBeenCalledWith('session-1', edited, true)
    expect(createNewForkMock).not.toHaveBeenCalled()
    expect(insertMessageAfterMock).not.toHaveBeenCalled()
    expect(orchestrateGenerationMock).not.toHaveBeenCalled()
  })

  it('swallows a follow-up save failure after a failed fork write', async () => {
    const edited = userMessage('user-1')
    findMessageLocationMock.mockReturnValue({ list: [edited], index: 0 })
    createSaveAndResendForkMock.mockRejectedValueOnce(new Error('storage write failed'))
    modifyMessageMock.mockRejectedValueOnce(new Error('write failed'))

    await expect(saveAndResendMessage('session-1', edited)).resolves.toBeUndefined()
  })

  it('keeps legacy picture sessions read-only across generation entry points', async () => {
    const pictureSession: Session = {
      id: 'session-1',
      name: 'Picture Session',
      type: 'picture',
      messages: [],
    }
    getSessionMock.mockResolvedValue(pictureSession)

    await Promise.all([
      generate('session-1', message('assistant-1')),
      generateMore('session-1', 'user-1'),
      saveAndResendMessage('session-1', userMessage('user-1')),
      regenerateInNewFork('session-1', message('assistant-1')),
    ])

    expect(orchestrateGenerationMock).not.toHaveBeenCalled()
    expect(createNewForkMock).not.toHaveBeenCalled()
    expect(createSaveAndResendForkMock).not.toHaveBeenCalled()
    expect(modifyMessageMock).not.toHaveBeenCalled()
    expect(findMessageLocationMock).not.toHaveBeenCalled()
    expect(insertMessageAfterMock).not.toHaveBeenCalled()
  })
})

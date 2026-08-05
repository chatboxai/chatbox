import type { Message } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, getSessionSettingsMock, orchestrateGenerationMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionSettingsMock: vi.fn(),
  orchestrateGenerationMock: vi.fn(),
}))

vi.mock('../chatStore', () => ({
  getSession: getSessionMock,
  getSessionSettings: getSessionSettingsMock,
}))
vi.mock('./attachment-resolver', () => ({ createAttachmentResolver: vi.fn() }))
vi.mock('./forks', () => ({ createNewFork: vi.fn(), findMessageLocation: vi.fn() }))
vi.mock('./messages', () => ({ insertMessageAfter: vi.fn() }))
vi.mock('./orchestration', () => ({ orchestrateGeneration: orchestrateGenerationMock }))
vi.mock('./pictures', () => ({ orchestratePictureGeneration: vi.fn() }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn() }))

import { generate } from './generation'
import { resetSessionGenerationLocksForTests } from './generation-lock'

function message(id: string): Message {
  return { id, role: 'assistant', contentParts: [], generating: true }
}

describe('generation entry-point locking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionGenerationLocksForTests()
    getSessionMock.mockResolvedValue({ id: 'session-1', name: 'Session', messages: [] })
    getSessionSettingsMock.mockResolvedValue({})
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

  it('returns the outcome produced by chat orchestration', async () => {
    const completed = { status: 'completed' } as const
    orchestrateGenerationMock.mockResolvedValueOnce(completed)

    await expect(generate('session-1', message('assistant-1'))).resolves.toEqual(completed)
  })
})

import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, insertMessageMock, orchestrateGenerationMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  insertMessageMock: vi.fn(),
  orchestrateGenerationMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessionQueryBridge: { getSession: getSessionMock },
    },
  }
})
vi.mock('./session-settings', () => ({ getSessionSettings: vi.fn(), getSessionTokenModel: () => undefined }))
vi.mock('./attachment-resolver', () => ({ createAttachmentResolver: vi.fn() }))
vi.mock('./forks', () => ({ createNewFork: vi.fn(), createSaveAndResendFork: vi.fn(), findMessageLocation: vi.fn() }))
vi.mock('./messages', () => ({
  insertMessage: insertMessageMock,
  insertMessageAfter: vi.fn(),
  modifyMessage: vi.fn(),
}))
vi.mock('@/adapters/CurrentGenerationService', () => ({
  currentGenerationService: { orchestrate: orchestrateGenerationMock },
}))
vi.mock('./action-guard', () => ({ guardSessionAction: vi.fn() }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: () => 0 }))

import { resetSessionGenerationLocksForTests } from '@chatbox/core/generation'
import { rendererApplication } from '@/app/renderer-application'
import {
  AUTO_DIALOGUE_CONFIRM_TIMEOUT_MS,
  autoDialogueConfirmStore,
  resolveAutoDialogueConfirm,
  startAutoDialogue,
} from './generation'

function textMessage(id: string, role: Message['role'], text: string): Message {
  return { id, role, contentParts: [{ type: 'text', text }] }
}

describe('startAutoDialogue', () => {
  let session: Session
  let stopAutoConfirm: () => void

  function finishMessage(id: string, patch: Partial<Message>) {
    Object.assign(session.messages.find((m) => m.id === id) as Message, { generating: false, ...patch })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionGenerationLocksForTests()
    rendererApplication.generationRuntime.dispose()
    session = {
      id: 'session-1',
      name: 'Session',
      messages: [
        textMessage('system', 'system', 'You are Alice.'),
        textMessage('u1', 'user', 'Hi, who are you?'),
        textMessage('a1', 'assistant', 'I am Alice. And you?'),
      ],
    } as Session
    getSessionMock.mockImplementation(() => Promise.resolve(session))
    insertMessageMock.mockImplementation((_sessionId: string, msg: Message) => {
      session.messages.push(msg)
      return Promise.resolve()
    })
    orchestrateGenerationMock.mockImplementation((_sessionId: string, msg: Message) => {
      finishMessage(msg.id, { finishReason: 'stop' })
      return Promise.resolve()
    })
    // Confirm every turn unless a test opts out.
    stopAutoConfirm = autoDialogueConfirmStore.subscribe((state) => {
      if (state['session-1']) resolveAutoDialogueConfirm('session-1', true)
    })
  })

  afterEach(() => {
    stopAutoConfirm()
    resolveAutoDialogueConfirm('session-1', false)
    vi.useRealTimers()
    resetSessionGenerationLocksForTests()
    rendererApplication.generationRuntime.dispose()
  })

  it('alternates turns and swaps roles for the user side', async () => {
    let calls = 0
    orchestrateGenerationMock.mockImplementation((_sessionId: string, msg: Message) => {
      calls += 1
      finishMessage(msg.id, { finishReason: calls < 2 ? 'stop' : 'canceled' })
      return Promise.resolve()
    })

    await startAutoDialogue('session-1', 'You are Bob.')

    expect(orchestrateGenerationMock).toHaveBeenCalledTimes(2)
    const [, userSideTarget, userSideOptions] = orchestrateGenerationMock.mock.calls[0]
    expect(userSideTarget.role).toBe('user')
    const context = userSideOptions.contextMessages as Message[]
    expect(context.map((m) => m.role)).toEqual(['system', 'assistant', 'user', 'user'])
    expect(context[0].contentParts).toEqual([{ type: 'text', text: 'You are Bob.' }])
    expect(context.some((m) => m.id === 'system')).toBe(false)
    expect(context[context.length - 1].id).toBe(userSideTarget.id)

    const [, assistantTarget, assistantOptions] = orchestrateGenerationMock.mock.calls[1]
    expect(assistantTarget.role).toBe('assistant')
    expect(assistantOptions).toBeUndefined()
  })

  it('keeps the session system prompt when no user-side prompt is given', async () => {
    orchestrateGenerationMock.mockImplementationOnce((_sessionId: string, msg: Message) => {
      finishMessage(msg.id, { finishReason: 'canceled' })
      return Promise.resolve()
    })

    await startAutoDialogue('session-1')

    const context = orchestrateGenerationMock.mock.calls[0][2].contextMessages as Message[]
    expect(context[0].id).toBe('system')
    expect(context.map((m) => m.role)).toEqual(['system', 'assistant', 'user', 'user'])
  })

  it('starts with the assistant when the last message is from the user', async () => {
    session.messages.push(textMessage('u2', 'user', 'Tell me more.'))
    orchestrateGenerationMock.mockImplementationOnce((_sessionId: string, msg: Message) => {
      finishMessage(msg.id, { error: 'boom' })
      return Promise.resolve()
    })

    await startAutoDialogue('session-1')

    expect(orchestrateGenerationMock).toHaveBeenCalledTimes(1)
    expect(orchestrateGenerationMock.mock.calls[0][1].role).toBe('assistant')
  })

  it('stops after the turn cap', async () => {
    await startAutoDialogue('session-1')

    expect(orchestrateGenerationMock).toHaveBeenCalledTimes(20)
  })

  it('waits for confirmation before each later turn and stops when declined', async () => {
    stopAutoConfirm()
    const run = startAutoDialogue('session-1')

    await vi.waitFor(() => expect(autoDialogueConfirmStore.getState()['session-1']).toBeDefined())
    expect(orchestrateGenerationMock).toHaveBeenCalledTimes(1)

    resolveAutoDialogueConfirm('session-1', true)
    await vi.waitFor(() => expect(orchestrateGenerationMock).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(autoDialogueConfirmStore.getState()['session-1']).toBeDefined())

    resolveAutoDialogueConfirm('session-1', false)
    await run

    expect(orchestrateGenerationMock).toHaveBeenCalledTimes(2)
    expect(orchestrateGenerationMock.mock.calls.map(([, msg]) => msg.role)).toEqual(['user', 'assistant'])
    expect(autoDialogueConfirmStore.getState()['session-1']).toBeUndefined()
  })

  it('stops when the next turn is not confirmed within 10 minutes', async () => {
    stopAutoConfirm()
    vi.useFakeTimers()
    const run = startAutoDialogue('session-1')

    await vi.waitFor(() => expect(autoDialogueConfirmStore.getState()['session-1']).toBeDefined())
    await vi.advanceTimersByTimeAsync(AUTO_DIALOGUE_CONFIRM_TIMEOUT_MS)
    await run

    expect(orchestrateGenerationMock).toHaveBeenCalledTimes(1)
    expect(autoDialogueConfirmStore.getState()['session-1']).toBeUndefined()
  })
})

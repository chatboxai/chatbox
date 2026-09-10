import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, removeMessageMock, updateMessageMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  removeMessageMock: vi.fn(),
  updateMessageMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessions: { removeMessage: removeMessageMock, updateMessage: updateMessageMock },
      sessionQueryBridge: { getSession: getSessionMock },
    },
  }
})
vi.mock('@/platform', () => ({ default: { isDesktopLike: false, type: 'desktop' } }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/adapters', () => ({ createModel: vi.fn() }))
vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: vi.fn() }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: vi.fn() }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('./action-guard', () => ({ guardSessionAction: vi.fn().mockResolvedValue(true) }))
vi.mock('./session-settings', () => ({ getSessionSettings: vi.fn() }))
vi.mock('../sessionAttachmentRagIndexing', () => ({ ensureMessageFileSessionAttachment: vi.fn() }))
vi.mock('../settingActions', () => ({}))
vi.mock('../settingsStore', () => ({ settingsStore: {} }))
vi.mock('./utils', () => ({ getSessionWebBrowsing: vi.fn() }))

import { rendererApplication } from '@/app/renderer-application'
import {
  getGenerationStopStatus,
  messageStopOperationKey,
  startGenerationStop,
} from '@/stores/generationStopOperations'
import { type GenerationCancellationDependencies, stopMessageGeneration } from './generation-cancellation'
import { persistStreamingMessage, removeMessage } from './messages'

const generationRuntimeStore = rendererApplication.generationRuntime

function message(id: string): Message {
  return { id, role: 'assistant', contentParts: [], generating: false }
}

describe('removeMessage runtime cleanup', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    removeMessageMock.mockReset()
    removeMessageMock.mockImplementation((_sessionId: string, _messageId: string, onPersisted?: () => void) => {
      onPersisted?.()
      return Promise.resolve()
    })
    updateMessageMock.mockReset()
    updateMessageMock.mockResolvedValue(undefined)
    generationRuntimeStore.clear('session-1')
  })

  it('discards a paused generation runtime after removing its message', async () => {
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('reply-1')],
    }
    getSessionMock.mockResolvedValue(session)

    const runtime = generationRuntimeStore.start('session-1', 'reply-1')
    generationRuntimeStore.setPhase('session-1', 'reply-1', 'paused', runtime)

    await removeMessage('session-1', 'reply-1')

    expect(removeMessageMock).toHaveBeenCalledWith('session-1', 'reply-1', expect.any(Function))
    expect(generationRuntimeStore.get('session-1', 'reply-1')).toBeUndefined()
  })

  it('removes a message without a runtime without leaving a tombstone', async () => {
    const session: Session = {
      id: 'session-1',
      name: 'Session',
      messages: [message('reply-1')],
    }
    getSessionMock.mockResolvedValue(session)

    await removeMessage('session-1', 'reply-1')

    expect(removeMessageMock).toHaveBeenCalledWith('session-1', 'reply-1', expect.any(Function))
    expect(generationRuntimeStore.get('session-1', 'reply-1')).toBeUndefined()
  })

  it('retains failed Stop ownership until a competing terminal write durably releases it', async () => {
    const sessionId = 'session-1'
    const messageId = 'reply-1'
    const operationKey = messageStopOperationKey(sessionId, messageId)
    let currentSession: Session = {
      id: sessionId,
      name: 'Session',
      messages: [
        {
          ...message(messageId),
          generating: true,
          contentParts: [{ type: 'text', text: 'partial reply' }],
        },
      ],
    }
    const persistStoppedMessage = vi
      .fn<GenerationCancellationDependencies['persistMessage']>()
      .mockRejectedValue(new Error('storage unavailable'))
    const dependencies: GenerationCancellationDependencies = {
      runtime: generationRuntimeStore,
      getSession: () => Promise.resolve(currentSession),
      removeMessage: vi.fn().mockResolvedValue(undefined),
      persistMessage: persistStoppedMessage,
    }
    generationRuntimeStore.start(sessionId, messageId)

    await expect(
      startGenerationStop(operationKey, () => stopMessageGeneration(sessionId, messageId, dependencies, 20_000))
    ).rejects.toThrow('Failed to persist one or more stopped generations')
    expect(generationRuntimeStore.get(sessionId, messageId)?.phase).toBe('stopping')
    expect(getGenerationStopStatus(operationKey)).toBe('failed')

    const terminalMessage: Message = {
      ...currentSession.messages[0],
      generating: false,
      finishReason: 'canceled',
    }
    currentSession = { ...currentSession, messages: [terminalMessage] }
    await persistStreamingMessage(sessionId, terminalMessage)

    expect(persistStoppedMessage).toHaveBeenCalledOnce()
    expect(generationRuntimeStore.get(sessionId, messageId)).toBeUndefined()
    expect(getGenerationStopStatus(operationKey)).toBe('idle')
  })
})

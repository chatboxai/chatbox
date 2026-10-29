import { SessionActionBlockedError } from '@chatbox/core/session/action-gates'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'
import { SessionEventBus } from '@chatbox/core/application/session'
import type { Message, Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateMessageMock } = vi.hoisted(() => ({
  updateMessageMock: vi.fn(),
}))

vi.mock('@/app/renderer-application', async () => {
  const { GenerationRuntimeStore } = await import('@chatbox/core/generation')
  return {
    rendererApplication: {
      generationRuntime: new GenerationRuntimeStore(),
      sessions: {
        executeStructureCommand: vi.fn().mockResolvedValue(null),
        updateMessage: updateMessageMock,
      },
    },
  }
})
vi.mock('@/platform', () => ({ default: { isDesktopLike: false, type: 'desktop' } }))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/adapters', () => ({ createModel: vi.fn() }))
vi.mock('@/packages/context-management', () => ({ runCompactionWithUIState: vi.fn() }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: vi.fn() }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: vi.fn() }))
vi.mock('@/utils/session-lock-copy', () => ({ notifySessionLockBlocked: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/utils/sentry', () => ({ reportError: vi.fn() }))
vi.mock('./action-guard', () => ({ guardSessionAction: vi.fn().mockResolvedValue(true) }))
vi.mock('./session-settings', () => ({ getSessionSettings: vi.fn() }))
vi.mock('../sessionActivityStore', () => ({ markSessionReplyFailed: vi.fn() }))
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
    vi.mocked(rendererApplication.sessions.executeStructureCommand)
      .mockReset()
      .mockImplementation(async (_sessionId, operation, onCommitted) => {
        const result = {
          applied: true,
          cancelMessageIds: operation.action === 'message-remove' ? [operation.messageId] : [],
        }
        onCommitted?.(result)
        return result
      })
    updateMessageMock.mockReset()
    updateMessageMock.mockResolvedValue(undefined)
    generationRuntimeStore.clear('session-1')
  })

  it('discards a paused generation runtime after removing its message', async () => {
    const runtime = generationRuntimeStore.start('session-1', 'reply-1')
    generationRuntimeStore.setPhase('session-1', 'reply-1', 'paused', runtime)

    await removeMessage('session-1', 'reply-1')

    expect(rendererApplication.sessions.executeStructureCommand).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ action: 'message-remove', messageId: 'reply-1' }),
      expect.any(Function)
    )
    expect(generationRuntimeStore.get('session-1', 'reply-1')).toBeUndefined()
  })

  it('removes a message without a runtime without leaving a tombstone', async () => {
    await removeMessage('session-1', 'reply-1')

    expect(rendererApplication.sessions.executeStructureCommand).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ action: 'message-remove', messageId: 'reply-1' }),
      expect.any(Function)
    )
    expect(generationRuntimeStore.get('session-1', 'reply-1')).toBeUndefined()
  })

  it('reports blocked summary deletion and leaves the message and runtime intact', async () => {
    vi.mocked(rendererApplication.sessions.executeStructureCommand).mockRejectedValueOnce(
      new SessionActionBlockedError('delete-summary', 'generating')
    )
    await expect(removeMessage('session-1', 'summary')).resolves.toBeUndefined()
    expect(notifySessionLockBlocked).toHaveBeenCalledWith('generating', expect.any(Function))
  })

  it('discards a paused runtime only after the structure content commit', async () => {
    const runtime = generationRuntimeStore.start('session-1', 'paused-structure')
    generationRuntimeStore.setPhase('session-1', 'paused-structure', 'paused', runtime)
    vi.mocked(rendererApplication.sessions.executeStructureCommand).mockImplementationOnce(
      async (_id, _operation, committed) => {
        expect(runtime.abortController.signal.aborted).toBe(false)
        const result = { applied: true, cancelMessageIds: ['paused-structure'] }
        committed?.(result)
        return result
      }
    )
    await expect(removeMessage('session-1', 'paused-structure')).resolves.toBeUndefined()
    expect(runtime.abortController.signal.aborted).toBe(true)
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
      sessionEvents: new SessionEventBus(),
      runtime: generationRuntimeStore,
      readState: async () => ({
        messages: currentSession.messages,
        generatingMessageIds: currentSession.messages
          .filter((message) => message.generating)
          .map((message) => message.id),
        currentConversationGeneratingCount: currentSession.messages.filter((message) => message.generating).length,
      }),
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

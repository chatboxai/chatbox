import type { Message } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

const traceEndMock = vi.fn(async () => undefined)
const traceStartRunMock = vi.fn(async () => ({
  runId: 'generate-text-run-1',
  end: traceEndMock,
}))

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: traceStartRunMock,
  },
}))

vi.mock('./message-utils', () => ({
  convertToModelMessages: vi.fn(async (messages: Message[]) =>
    messages.map((message) => ({
      role: message.role,
      content: message.contentParts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n'),
    }))
  ),
}))

vi.mock('./stream-text', () => ({
  streamText: vi.fn(),
}))

vi.mock('./generate-image', () => ({
  generateImage: vi.fn(),
}))

describe('generateText tracing', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    })
  })

  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor)
      return
    }

    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  it('passes parent correlation and metadata through the chain trace and child model call', async () => {
    const { generateText } = await import('./index')

    const chatMock = vi.fn(async () => ({
      contentParts: [{ type: 'text' as const, text: 'done' }],
    }))

    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentParts: [{ type: 'text', text: 'hello there' }],
      },
    ]

    await generateText(
      {
        name: 'Tracing Model',
        modelId: 'model-1',
        isSupportVision: () => true,
        isSupportToolUse: () => false,
        isSupportSystemMessage: () => true,
        chat: chatMock,
        chatStream: async function* () {},
        paint: vi.fn(async () => []),
      },
      messages,
      {
        name: 'chatbox.session.generate.search_planner',
        parentRunId: 'session-run-1',
        sessionId: 'session-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        metadata: {
          operation: 'searchByPromptEngineering',
        },
        tags: ['chat', 'search-planner'],
      }
    )

    expect(traceStartRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbox.session.generate.search_planner',
        parentRunId: 'session-run-1',
        metadata: expect.objectContaining({
          operation: 'searchByPromptEngineering',
          sessionId: 'session-1',
          session_id: 'session-1',
          threadId: 'thread-1',
          thread_id: 'thread-1',
          conversation_id: 'thread-1',
          messageId: 'message-1',
          message_id: 'message-1',
        }),
      })
    )
    expect(chatMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        traceContext: expect.objectContaining({
          parentRunId: 'generate-text-run-1',
          metadata: expect.objectContaining({
            operation: 'searchByPromptEngineering',
            sessionId: 'session-1',
            session_id: 'session-1',
            threadId: 'thread-1',
            thread_id: 'thread-1',
            conversation_id: 'thread-1',
            messageId: 'message-1',
            message_id: 'message-1',
          }),
        }),
      })
    )
  }, 20000)
})

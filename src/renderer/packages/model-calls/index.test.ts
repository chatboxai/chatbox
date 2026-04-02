import type { Message } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'

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

describe('generateText tracing', () => {
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
        metadata: {
          session_id: 'session-1',
          thread_id: 'thread-1',
          message_id: 'message-1',
        },
        tags: ['chat', 'search-planner'],
      }
    )

    expect(traceStartRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbox.session.generate.search_planner',
        parentRunId: 'session-run-1',
        metadata: expect.objectContaining({
          session_id: 'session-1',
          thread_id: 'thread-1',
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
            session_id: 'session-1',
            thread_id: 'thread-1',
            message_id: 'message-1',
          }),
        }),
      })
    )
  })
})

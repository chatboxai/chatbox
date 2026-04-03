import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Message, StreamTextResult } from '@shared/types'

const traceEndMock = vi.fn(async () => undefined)
const traceStartRunMock = vi.fn(async () => ({
  runId: 'session-trace-run-1',
  end: traceEndMock,
}))
const traceRecordEventMock = vi.fn(async () => undefined)

vi.mock('@/adapters/langsmith', () => ({
  langsmith: {
    startRun: traceStartRunMock,
    recordEvent: traceRecordEventMock,
  },
}))

vi.mock('../mcp/controller', () => ({
  mcpController: {
    getAvailableTools: vi.fn(() => ({})),
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
  injectModelSystemPrompt: vi.fn((_modelId: string, messages: Message[]) => messages),
}))

vi.mock('./toolsets/knowledge-base', () => ({
  getToolSet: vi.fn(async () => null),
}))

vi.mock('./toolsets/file', () => ({
  default: {
    description: '',
    tools: {},
  },
}))

vi.mock('./toolsets/web-search', () => ({
  default: {
    description: '',
    tools: {},
  },
  parseLinkTool: {},
  webSearchTool: {},
}))

vi.mock('../chatbridge/single-app-tools', () => ({
  createReviewedSingleAppToolSet: vi.fn(() => ({
    routeDecision: {
      prompt: '',
      kind: 'skip',
      reasonCode: 'no-match',
      selectedAppId: null,
    },
    selection: {
      status: 'not-selected',
    },
    selectionSource: 'none',
    tools: {},
  })),
}))

vi.mock('../chatbridge/reviewed-app-launch', () => ({
  upsertReviewedAppLaunchParts: vi.fn((parts: unknown[]) => parts),
}))

vi.mock('@/stores/settingActions', () => ({
  isPro: vi.fn(() => false),
}))

function createModelStub() {
  const chat = vi.fn(
    async (_messages: ModelMessage[], _options: CallChatCompletionOptions): Promise<StreamTextResult> => ({
      contentParts: [{ type: 'text', text: 'traced reply' }],
    })
  )

  const model: ModelInterface = {
    name: 'Tracing Model',
    modelId: 'tracing-model',
    isSupportVision: () => true,
    isSupportToolUse: () => false,
    isSupportSystemMessage: () => true,
    chat,
    chatStream: async function* () {},
    paint: vi.fn(async () => []),
  }

  return {
    chat,
    model,
  }
}

describe('streamText tracing metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds LangSmith thread metadata to the chat turn and propagates it to the child llm run', async () => {
    const { streamText } = await import('./stream-text')
    const { chat, model } = createModelStub()

    const result = await streamText(model, {
      sessionId: 'session-1',
      threadId: 'thread-7',
      targetMessageId: 'message-9',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          timestamp: 1,
          contentParts: [{ type: 'text', text: 'hello world' }],
        },
      ],
      onResultChangeWithCancel: vi.fn(),
    })

    expect(result.result.contentParts).toEqual([{ type: 'text', text: 'traced reply' }])
    expect(traceStartRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbox.session.generate',
        metadata: expect.objectContaining({
          session_id: 'session-1',
          thread_id: 'thread-7',
          conversation_id: 'thread-7',
          message_id: 'message-9',
        }),
      })
    )
    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        traceContext: expect.objectContaining({
          parentRunId: 'session-trace-run-1',
          metadata: expect.objectContaining({
            session_id: 'session-1',
            thread_id: 'thread-7',
            conversation_id: 'thread-7',
            message_id: 'message-9',
          }),
        }),
      })
    )
  }, 20000)
})

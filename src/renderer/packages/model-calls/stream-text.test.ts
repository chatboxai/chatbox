import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBridgeRouteDecision } from '@shared/chatbridge'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import type { Message, StreamTextResult } from '@shared/types'
import { createReviewedSingleAppToolSet } from '../chatbridge/single-app-tools'

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
      schemaVersion: 2,
      hostRuntime: 'desktop-electron',
      prompt: '',
      kind: 'refuse',
      reasonCode: 'no-confident-match',
      summary: 'No reviewed app is a confident fit.',
      matches: [],
    },
    selection: {
      status: 'chat-only',
      promptText: '',
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

function createToolUseModelStub() {
  const { chat, model } = createModelStub()

  return {
    chat,
    model: {
      ...model,
      isSupportToolUse: () => true,
    } satisfies ModelInterface,
  }
}

function createRouteDecision(
  kind: 'clarify' | 'refuse',
  overrides: Partial<ChatBridgeRouteDecision> = {}
): ChatBridgeRouteDecision {
  return {
    schemaVersion: 2,
    hostRuntime: 'desktop-electron',
    kind,
    reasonCode: kind === 'clarify' ? 'ambiguous-match' : 'no-confident-match',
    prompt: 'Help me with this',
    summary:
      kind === 'clarify'
        ? 'This request could fit Drawing Kit or Weather Dashboard, so the host is asking before launching anything.'
        : 'No reviewed app is a confident fit, so the host will keep helping in chat instead.',
    selectedAppId: kind === 'clarify' ? 'drawing-kit' : undefined,
    matches:
      kind === 'clarify'
        ? [
            {
              appId: 'drawing-kit',
              appName: 'Drawing Kit',
              matchedContexts: [],
              matchedTerms: ['draw'],
              score: 6,
              exactAppMatch: false,
              exactToolMatch: false,
            },
            {
              appId: 'weather-dashboard',
              appName: 'Weather Dashboard',
              matchedContexts: [],
              matchedTerms: ['show'],
              score: 4,
              exactAppMatch: false,
              exactToolMatch: false,
            },
          ]
        : [],
    ...overrides,
  } as ChatBridgeRouteDecision
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

  it('injects a live clarify route artifact when the reviewed router needs confirmation', async () => {
    vi.mocked(createReviewedSingleAppToolSet).mockReturnValue({
      routeDecision: createRouteDecision('clarify'),
      selection: {
        status: 'chat-only',
        promptText: 'Help me with this',
      },
      selectionSource: 'none',
      tools: {},
    })
    const { streamText } = await import('./stream-text')
    const { model } = createToolUseModelStub()

    const result = await streamText(model, {
      sessionId: 'session-route-clarify',
      messages: [
        {
          id: 'user-clarify-1',
          role: 'user',
          timestamp: 1,
          contentParts: [{ type: 'text', text: 'Help me with this' }],
        },
      ],
      onResultChangeWithCancel: vi.fn(),
    })

    expect(result.result.contentParts[0]).toMatchObject({
      type: 'app',
      title: 'Choose the next step',
      values: {
        chatbridgeRouteDecision: {
          kind: 'clarify',
        },
        chatbridgeRouteArtifactState: {
          status: 'pending',
        },
      },
    })
    expect(traceRecordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbridge.routing.reviewed-app-decision',
        outputs: expect.objectContaining({
          decisionKind: 'clarify',
          artifactInserted: true,
          artifactKind: 'clarify',
        }),
      })
    )
  })

  it('injects a live refusal route artifact when the reviewed router keeps the request in chat', async () => {
    vi.mocked(createReviewedSingleAppToolSet).mockReturnValue({
      routeDecision: createRouteDecision('refuse', {
        prompt: 'What should I cook for dinner tonight?',
      }),
      selection: {
        status: 'chat-only',
        promptText: 'What should I cook for dinner tonight?',
      },
      selectionSource: 'none',
      tools: {},
    })
    const { streamText } = await import('./stream-text')
    const { model } = createToolUseModelStub()

    const result = await streamText(model, {
      sessionId: 'session-route-refuse',
      messages: [
        {
          id: 'user-refuse-1',
          role: 'user',
          timestamp: 1,
          contentParts: [{ type: 'text', text: 'What should I cook for dinner tonight?' }],
        },
      ],
      onResultChangeWithCancel: vi.fn(),
    })

    expect(result.result.contentParts[0]).toMatchObject({
      type: 'app',
      title: 'Keep this in chat',
      values: {
        chatbridgeRouteDecision: {
          kind: 'refuse',
        },
        chatbridgeRouteArtifactState: {
          status: 'pending',
        },
      },
    })
    expect(traceRecordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'chatbridge.routing.reviewed-app-decision',
        outputs: expect.objectContaining({
          decisionKind: 'refuse',
          artifactInserted: true,
          artifactKind: 'refuse',
        }),
      })
    )
  })
})

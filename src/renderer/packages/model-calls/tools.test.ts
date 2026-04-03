import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.fn()
const webSearchExecutorMock = vi.fn()

vi.mock('.', () => ({
  generateText: generateTextMock,
}))

vi.mock('@/packages/prompts', () => ({
  contructSearchAction: vi.fn(() => 'planner prompt'),
  constructKnowledgeBaseSearchAction: vi.fn(() => 'kb planner prompt'),
  constructCombinedSearchAction: vi.fn(() => 'combined planner prompt'),
  answerWithSearchResults: vi.fn(() => 'search answer prompt'),
  answerWithKnowledgeBaseResults: vi.fn(() => 'kb answer prompt'),
}))

vi.mock('@/stores/settingActions', () => ({
  getLanguage: vi.fn(() => 'en'),
}))

vi.mock('../web-search', () => ({
  webSearchExecutor: webSearchExecutorMock,
}))

describe('searchByPromptEngineering tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the planner run parented under the active chat turn and preserves thread metadata', async () => {
    const { searchByPromptEngineering } = await import('./tools')

    generateTextMock.mockResolvedValue({
      contentParts: [
        {
          type: 'text',
          text: '{"action":"search","query":"latest weather in chicago"}',
        },
      ],
    })
    webSearchExecutorMock.mockResolvedValue({
      searchResults: [{ title: 'Weather', snippet: 'Sunny', link: 'https://example.com', rawContent: null }],
    })

    const messages: Message[] = [
      {
        id: 'msg-1',
        role: 'user',
        contentParts: [{ type: 'text', text: 'what is the weather?' }],
      },
    ]

    await searchByPromptEngineering(
      {
        name: 'Planner Model',
        modelId: 'planner-model',
        isSupportVision: () => true,
        isSupportToolUse: () => false,
        isSupportSystemMessage: () => true,
        chat: vi.fn(),
        chatStream: async function* () {},
        paint: vi.fn(async () => []),
      },
      messages,
      undefined,
      {
        parentRunId: 'session-run-1',
        metadata: {
          session_id: 'session-1',
          thread_id: 'thread-1',
          message_id: 'message-1',
        },
        tags: ['chatbox', 'renderer', 'chat'],
      }
    )

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({
        name: 'chatbox.session.generate.web_search_planner',
        parentRunId: 'session-run-1',
        metadata: expect.objectContaining({
          session_id: 'session-1',
          thread_id: 'thread-1',
          message_id: 'message-1',
          operation: 'searchByPromptEngineering',
        }),
      })
    )
  })
})

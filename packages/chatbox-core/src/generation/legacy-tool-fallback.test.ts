import type { ModelInterface } from '@shared/models/types'
import type { Message, ToolUseScope } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import {
  applyLegacyToolFallback,
  type LegacyKnowledgeBaseSearchResult,
  type LegacyToolFallbackDependencies,
  type LegacyWebSearchResult,
} from './legacy-tool-fallback'

function createMessage(text: string): Message {
  return {
    id: `message-${text}`,
    role: 'user',
    contentParts: [{ type: 'text', text }],
  }
}

function createModel(supportedScopes: ToolUseScope[]): ModelInterface {
  return {
    isSupportToolUse: (scope?: ToolUseScope) => (scope ? supportedScopes.includes(scope) : true),
  } as unknown as ModelInterface
}

function createDependencies(): LegacyToolFallbackDependencies {
  return {
    combinedSearchByPromptEngineering: vi.fn(async () => ({
      query: '',
      searchResults: [] as [],
      type: 'none' as const,
    })),
    knowledgeBaseSearchByPromptEngineering: vi.fn(async () => ({
      query: '',
      searchResults: [],
    })),
    searchByPromptEngineering: vi.fn(async () => ({
      query: '',
      searchResults: [],
    })),
    constructMessagesWithKnowledgeBaseResults: vi.fn((messages) => messages),
    constructMessagesWithSearchResults: vi.fn((messages) => messages),
    createUniqueId: vi.fn(() => '1'),
  }
}

function createOptions(model: ModelInterface, promptMsgs: Message[]) {
  return {
    model,
    promptMsgs,
    knowledgeBase: { id: 7 },
    webBrowsing: true,
    signal: new AbortController().signal,
  }
}

describe('applyLegacyToolFallback', () => {
  it('returns the original prompt without calling adapters when native tools are supported', async () => {
    const promptMsgs = [createMessage('hello')]
    const dependencies = createDependencies()

    const result = await applyLegacyToolFallback(
      createOptions(createModel(['knowledge-base', 'web-browsing']), promptMsgs),
      dependencies
    )

    expect(result).toEqual({ promptMsgs, fallbackToolCallPart: undefined })
    expect(dependencies.combinedSearchByPromptEngineering).not.toHaveBeenCalled()
    expect(dependencies.knowledgeBaseSearchByPromptEngineering).not.toHaveBeenCalled()
    expect(dependencies.searchByPromptEngineering).not.toHaveBeenCalled()
  })

  it('uses the combined knowledge-base fallback and records the synthetic tool result', async () => {
    const promptMsgs = [createMessage('find the document')]
    const transformed = [createMessage('knowledge result')]
    const knowledgeResult: LegacyKnowledgeBaseSearchResult = {
      id: 1,
      score: 0.9,
      text: 'matched text',
      fileId: 2,
      filename: 'guide.md',
      mimeType: 'text/markdown',
      chunkIndex: 0,
    }
    const dependencies = createDependencies()
    dependencies.combinedSearchByPromptEngineering = vi.fn(async () => ({
      query: 'document',
      searchResults: [knowledgeResult],
      type: 'knowledge_base' as const,
    }))
    dependencies.constructMessagesWithKnowledgeBaseResults = vi.fn(() => transformed)

    const result = await applyLegacyToolFallback(createOptions(createModel([]), promptMsgs), dependencies)

    expect(result.promptMsgs).toBe(transformed)
    expect(result.fallbackToolCallPart).toMatchObject({
      type: 'tool-call',
      state: 'result',
      toolCallId: 'query_knowledge_base_1',
      toolName: 'query_knowledge_base',
      args: { query: 'document' },
    })
    expect(dependencies.constructMessagesWithKnowledgeBaseResults).toHaveBeenCalledWith(promptMsgs, [knowledgeResult])
  })

  it('uses the knowledge-base-only fallback when web browsing is disabled', async () => {
    const promptMsgs = [createMessage('find local context')]
    const transformed = [createMessage('local result')]
    const dependencies = createDependencies()
    dependencies.knowledgeBaseSearchByPromptEngineering = vi.fn(async () => ({
      query: 'local',
      searchResults: [
        {
          id: 1,
          score: 1,
          text: 'local',
          fileId: 2,
          filename: 'local.md',
          mimeType: 'text/markdown',
          chunkIndex: 0,
        },
      ],
    }))
    dependencies.constructMessagesWithKnowledgeBaseResults = vi.fn(() => transformed)

    const result = await applyLegacyToolFallback(
      {
        ...createOptions(createModel(['web-browsing']), promptMsgs),
        webBrowsing: false,
      },
      dependencies
    )

    expect(result.promptMsgs).toBe(transformed)
    expect(result.fallbackToolCallPart?.toolName).toBe('query_knowledge_base')
    expect(dependencies.knowledgeBaseSearchByPromptEngineering).toHaveBeenCalledOnce()
  })

  it('uses the web-only fallback when knowledge-base access is not requested', async () => {
    const promptMsgs = [createMessage('latest result')]
    const transformed = [createMessage('web result')]
    const webResult: LegacyWebSearchResult = {
      title: 'Result',
      snippet: 'Summary',
      link: 'https://example.com',
    }
    const dependencies = createDependencies()
    dependencies.searchByPromptEngineering = vi.fn(async () => ({
      query: 'latest',
      searchResults: [webResult],
    }))
    dependencies.constructMessagesWithSearchResults = vi.fn(() => transformed)

    const result = await applyLegacyToolFallback(
      {
        ...createOptions(createModel(['knowledge-base']), promptMsgs),
        knowledgeBase: undefined,
      },
      dependencies
    )

    expect(result.promptMsgs).toBe(transformed)
    expect(result.fallbackToolCallPart).toMatchObject({
      toolCallId: 'web_search_1',
      toolName: 'web_search',
      args: { query: 'latest' },
    })
    expect(dependencies.constructMessagesWithSearchResults).toHaveBeenCalledWith(promptMsgs, [webResult])
  })
})

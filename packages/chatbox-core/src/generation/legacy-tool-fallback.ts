import type { ModelInterface } from '@shared/models/types'
import type { Message, MessageContentToolCallPart } from '@shared/types'

export interface LegacyWebSearchResult {
  title: string
  snippet: string
  link: string
}

export interface LegacyKnowledgeBaseSearchResult {
  id: number
  score: number
  text: string
  fileId: number
  filename: string
  mimeType: string
  chunkIndex: number
}

export type LegacyCombinedSearchResult =
  | {
      query: string
      searchResults: LegacyKnowledgeBaseSearchResult[]
      type: 'knowledge_base'
    }
  | {
      query: string
      searchResults: LegacyWebSearchResult[]
      type: 'web'
    }
  | {
      query: string
      searchResults: never[]
      type: 'none'
    }

export interface LegacyToolFallbackOptions {
  model: ModelInterface
  promptMsgs: Message[]
  knowledgeBase: { id: number } | undefined
  webBrowsing: boolean
  signal: AbortSignal
}

export interface LegacyToolFallbackDependencies {
  combinedSearchByPromptEngineering: (
    model: ModelInterface,
    messages: Message[],
    knowledgeBaseId: number,
    signal: AbortSignal
  ) => Promise<LegacyCombinedSearchResult>
  knowledgeBaseSearchByPromptEngineering: (
    model: ModelInterface,
    messages: Message[],
    knowledgeBaseId: number
  ) => Promise<{
    query: string
    searchResults: LegacyKnowledgeBaseSearchResult[]
  }>
  searchByPromptEngineering: (
    model: ModelInterface,
    messages: Message[],
    signal: AbortSignal
  ) => Promise<{
    query: string
    searchResults: LegacyWebSearchResult[]
  }>
  constructMessagesWithKnowledgeBaseResults: (
    messages: Message[],
    searchResults: LegacyKnowledgeBaseSearchResult[]
  ) => Message[]
  constructMessagesWithSearchResults: (messages: Message[], searchResults: LegacyWebSearchResult[]) => Message[]
  createUniqueId: () => string
}

export interface LegacyToolFallbackResult {
  promptMsgs: Message[]
  fallbackToolCallPart: MessageContentToolCallPart | undefined
}

/**
 * Applies the legacy prompt-engineering fallback without owning any host
 * services. Search, knowledge-base access, prompt construction and identifier
 * generation are supplied by the runtime adapter.
 */
export async function applyLegacyToolFallback(
  options: LegacyToolFallbackOptions,
  dependencies: LegacyToolFallbackDependencies
): Promise<LegacyToolFallbackResult> {
  const { model, signal } = options
  let { promptMsgs } = options
  let fallbackToolCallPart: MessageContentToolCallPart | undefined

  const kbNotSupported = options.knowledgeBase && !model.isSupportToolUse('knowledge-base')
  const webNotSupported = options.webBrowsing && !model.isSupportToolUse('web-browsing')

  if (!kbNotSupported && !webNotSupported) {
    return { promptMsgs, fallbackToolCallPart }
  }

  if (kbNotSupported && webNotSupported && options.knowledgeBase) {
    const callResult = await dependencies.combinedSearchByPromptEngineering(
      model,
      promptMsgs,
      options.knowledgeBase.id,
      signal
    )
    if (callResult.searchResults.length && callResult.type !== 'none') {
      const toolName = callResult.type === 'knowledge_base' ? 'query_knowledge_base' : 'web_search'
      fallbackToolCallPart = {
        type: 'tool-call',
        state: 'result',
        toolCallId: `${toolName}_${dependencies.createUniqueId()}`,
        toolName,
        args: { query: callResult.query },
        result: callResult,
      }
      promptMsgs =
        callResult.type === 'knowledge_base'
          ? dependencies.constructMessagesWithKnowledgeBaseResults(promptMsgs, callResult.searchResults)
          : dependencies.constructMessagesWithSearchResults(promptMsgs, callResult.searchResults)
    }
  } else if (kbNotSupported && options.knowledgeBase) {
    const callResult = await dependencies.knowledgeBaseSearchByPromptEngineering(
      model,
      promptMsgs,
      options.knowledgeBase.id
    )
    if (callResult.searchResults.length) {
      fallbackToolCallPart = {
        type: 'tool-call',
        state: 'result',
        toolCallId: `query_knowledge_base_${dependencies.createUniqueId()}`,
        toolName: 'query_knowledge_base',
        args: { query: callResult.query },
        result: callResult,
      }
      promptMsgs = dependencies.constructMessagesWithKnowledgeBaseResults(promptMsgs, callResult.searchResults)
    }
  } else if (webNotSupported) {
    const callResult = await dependencies.searchByPromptEngineering(model, promptMsgs, signal)
    if (callResult.searchResults.length) {
      fallbackToolCallPart = {
        type: 'tool-call',
        state: 'result',
        toolCallId: `web_search_${dependencies.createUniqueId()}`,
        toolName: 'web_search',
        args: { query: callResult.query },
        result: callResult,
      }
      promptMsgs = dependencies.constructMessagesWithSearchResults(promptMsgs, callResult.searchResults)
    }
  }

  return { promptMsgs, fallbackToolCallPart }
}

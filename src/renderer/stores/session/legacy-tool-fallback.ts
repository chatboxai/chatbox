import { applyLegacyToolFallback as applySharedLegacyToolFallback } from '@chatbox/core/generation'
import { uniqueId } from 'lodash'
import {
  combinedSearchByPromptEngineering,
  constructMessagesWithKnowledgeBaseResults,
  constructMessagesWithSearchResults,
  knowledgeBaseSearchByPromptEngineering,
  searchByPromptEngineering,
} from '@/packages/model-calls/tools'

export type {
  LegacyCombinedSearchResult,
  LegacyKnowledgeBaseSearchResult,
  LegacyToolFallbackDependencies,
  LegacyToolFallbackOptions,
  LegacyToolFallbackResult,
  LegacyWebSearchResult,
} from '@chatbox/core/generation'

export function applyLegacyToolFallback(
  options: Parameters<typeof applySharedLegacyToolFallback>[0]
): ReturnType<typeof applySharedLegacyToolFallback> {
  return applySharedLegacyToolFallback(options, {
    combinedSearchByPromptEngineering,
    constructMessagesWithKnowledgeBaseResults,
    constructMessagesWithSearchResults,
    knowledgeBaseSearchByPromptEngineering,
    searchByPromptEngineering,
    createUniqueId: uniqueId,
  })
}

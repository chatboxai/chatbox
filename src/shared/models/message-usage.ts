import type { LanguageModelUsage } from 'ai'
import type { MessageUsage } from '../types/session'

/** Projects provider token usage onto the fields persisted with a message. */
export function toMessageUsage(usage: LanguageModelUsage): MessageUsage {
  const fields: MessageUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

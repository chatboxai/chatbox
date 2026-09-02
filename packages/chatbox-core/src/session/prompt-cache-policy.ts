import type { Message } from '../types'
import type { SessionMode } from './mode-policy'

/**
 * Visible transcript long enough that a provider prompt-cache prefix is
 * worth protecting. ~1k tokens at the usual 4-chars-per-token heuristic,
 * which is also the floor most hosts use before they cache a prefix.
 */
export const PROMPT_CACHE_CONFIRM_MIN_CHARS = 4000

export type PromptCachePolicyMessage = Pick<
  Message,
  'id' | 'role' | 'generating' | 'isSummary' | 'isForkMarker' | 'contentParts'
>

export type PromptCacheDeleteTarget = 'message' | 'summary'

export interface PromptCacheEvaluationOptions {
  /**
   * A request can already have created a cacheable prefix while its assistant
   * reply is still streaming and therefore absent from the selected context.
   */
  hasStartedAssistantRequest?: boolean
}

export interface PromptCacheDeleteEvaluationOptions extends PromptCacheEvaluationOptions {
  /** Messages selected by the provider-context pipeline for cache evaluation. */
  contextMessages?: readonly PromptCachePolicyMessage[]
  /** Whether removing the target changes that selected provider context. */
  deletionChangesContext?: boolean
}

/**
 * Work-mode conversations with a real cached prefix ask before structural
 * edits that would miss that cache (deleting an earlier message, switching
 * models). Chat mode stays free to edit. Empty or first-turn sessions stay
 * quiet until the transcript actually has cache stake.
 */
export function shouldConfirmPromptCacheBreak(
  mode: SessionMode,
  messages: readonly PromptCachePolicyMessage[],
  options: PromptCacheEvaluationOptions = {}
): boolean {
  if (mode !== 'work') {
    return false
  }

  let chars = 0
  let hasStartedAssistantRequest = options.hasStartedAssistantRequest === true
  let hasToolHistory = false

  for (const message of messages) {
    if (message.isForkMarker) {
      continue
    }
    if (message.isSummary) {
      return true
    }
    if (message.role === 'assistant') {
      hasStartedAssistantRequest = true
    }
    for (const part of message.contentParts ?? []) {
      if (part.type === 'tool-call') {
        hasToolHistory = true
        if (hasStartedAssistantRequest) {
          return true
        }
      }
      // Partial assistant output is not part of the prefix sent for the
      // in-flight request. Count it only once the reply is complete.
      if (message.role !== 'system' && !(message.role === 'assistant' && message.generating)) {
        if (part.type === 'text' || part.type === 'reasoning') {
          chars += part.text.length
        } else if (part.type === 'image') {
          chars += '[image]'.length
        }
      }
    }
    if (hasStartedAssistantRequest && (hasToolHistory || chars >= PROMPT_CACHE_CONFIRM_MIN_CHARS)) {
      return true
    }
  }

  return false
}

/**
 * Delete warnings only apply to messages on the active provider-context path.
 * Ordinary latest-message deletion keeps the existing inline confirmation;
 * summary deletion keeps its dedicated restore-history dialog.
 */
export function shouldConfirmPromptCacheBreakForDelete(
  mode: SessionMode,
  messages: readonly PromptCachePolicyMessage[],
  messageId: string,
  target: PromptCacheDeleteTarget,
  options: PromptCacheDeleteEvaluationOptions = {}
): boolean {
  const message = messages.find((candidate) => candidate.id === messageId)
  if (!message || message.isForkMarker) {
    return false
  }

  if (target === 'message') {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index]
      if (candidate.isForkMarker || candidate.isSummary) {
        continue
      }
      if (candidate.id === messageId) {
        return false
      }
      break
    }
  }

  if (options.deletionChangesContext === false) {
    return false
  }

  return shouldConfirmPromptCacheBreak(mode, options.contextMessages ?? messages, options)
}

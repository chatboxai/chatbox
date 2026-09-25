import { isContextEligibleMessage } from '@shared/context'
import type { CompactionPoint, Message, Session, Settings } from '@shared/types'
import { useMemo, useRef } from 'react'
import { useTokenEstimation } from '@/packages/token-estimation/hooks/useTokenEstimation'
import type { ExactDraftTokens } from '@/packages/token-estimation/types'
import { selectMessagesForSendContext } from './attachment-payload'

/**
 * Options for useContextTokens hook
 */
export interface UseContextTokensOptions {
  sessionId: string | null
  source?: ContextTokenSource | null
  settings: Partial<Settings>
  model?: { provider: string; modelId: string }
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
  constructedMessage?: Message
}

export interface ContextTokenSource {
  /** Loaded-message preview whose count remains incomplete. */
  isPartial?: boolean
  textTokens?: SessionTextTokenRead
  candidateMessages: Message[]
  compactionPoints?: CompactionPoint[]
}

/**
 * Result returned by useContextTokens hook
 */
export interface UseContextTokensResult {
  contextTokens: number
  messageCount: number
  currentInputTokens: number
  totalTokens: number
  isCalculating: boolean
  isDraftCalculating: boolean
  isCurrentInputApproximate: boolean
  isTotalApproximate: boolean
  isContextApproximate: boolean
  isContextCalculating: boolean
  pendingTasks: number
  pendingContextMessages: number
  /** Exact worker count for the current draft, for seeding the outgoing message at submit. */
  exactDraftTokens: ExactDraftTokens | null
}

/**
 * Options for getContextMessagesForTokenEstimation
 */
export interface GetContextMessagesForTokenEstimationOptions {
  settings?: Partial<Settings>
  preserveLastUserMessage?: boolean
}

/** Select the upcoming history window using the same rules as sending. */
export function getContextMessagesForTokenEstimation(
  session: Session,
  options: GetContextMessagesForTokenEstimationOptions = {}
): Message[] {
  return getContextMessagesForTokenSource(
    { candidateMessages: session.messages, compactionPoints: session.compactionPoints },
    options
  )
}

export function getContextMessagesForTokenSource(
  source: ContextTokenSource,
  options: GetContextMessagesForTokenEstimationOptions = {}
): Message[] {
  return selectMessagesForSendContext({
    settings: options.settings ?? {},
    msgs: source.candidateMessages,
    compactionPoints: source.compactionPoints,
    preserveLastUserMessage: options.preserveLastUserMessage ?? false,
  })
}

const EMPTY_MESSAGES: Message[] = []

/**
 * Return the context-eligible subset of `messages`, preserving array identity
 * across renders when the eligible subset did not actually change.
 *
 * During streaming, every chunk replaces `session.messages` (and the
 * generating message object) with new identities while all other message
 * objects keep theirs. The generating message is context-ineligible anyway,
 * so filtering first and reusing the previous array when the elements are
 * reference-equal keeps the downstream O(n) work (context building + token
 * analysis) from re-running on every chunk. Token cache writes DO replace the
 * affected message objects, so those still invalidate as expected.
 */
export function useStableEligibleMessages(messages: Message[] | undefined): Message[] {
  const prevRef = useRef<Message[]>(EMPTY_MESSAGES)
  return useMemo(() => {
    const next = messages ? messages.filter(isContextEligibleMessage) : EMPTY_MESSAGES
    const prev = prevRef.current
    if (next.length === prev.length && next.every((message, i) => message === prev[i])) {
      return prev
    }
    prevRef.current = next
    return next
  }, [messages])
}

/** Stable context selection and live preview state for the composer. */
export function useContextTokens(options: UseContextTokensOptions): UseContextTokensResult {
  const { sessionId, source, settings, model, modelSupportToolUseForFile, sandboxMode, constructedMessage } = options
  const maxContextMessageCount = settings.maxContextMessageCount
  const hasSource = source != null
  const compactionPoints = source?.compactionPoints

  // 1. contextMessages must be stable — keyed off the eligible subset so
  // per-chunk streaming updates (which only touch the generating message)
  // don't re-run context building and analysis.
  const eligibleMessages = useStableEligibleMessages(source?.candidateMessages)
  const contextMessages = useMemo(() => {
    if (!hasSource) return []
    return getContextMessagesForTokenSource(
      { compactionPoints, candidateMessages: eligibleMessages },
      { settings: { maxContextMessageCount } }
    )
  }, [eligibleMessages, compactionPoints, maxContextMessageCount, hasSource])

  // 4. Call useTokenEstimation
  const tokenResult = useTokenEstimation({
    textTokens: source?.textTokens,
    contextSourcePending: source?.isPartial,
    sessionId,
    constructedMessage,
    contextMessages,
    model,
    modelSupportToolUseForFile,
    sandboxMode,
  })

  return {
    contextTokens: tokenResult.contextTokens,
    messageCount: contextMessages.length,
    currentInputTokens: tokenResult.currentInputTokens,
    totalTokens: tokenResult.totalTokens,
    isCalculating: tokenResult.isCalculating,
    isDraftCalculating: tokenResult.isDraftCalculating,
    isCurrentInputApproximate: tokenResult.isCurrentInputApproximate,
    isTotalApproximate: tokenResult.isTotalApproximate,
    isContextApproximate: tokenResult.isContextApproximate,
    isContextCalculating: tokenResult.isContextCalculating,
    pendingTasks: tokenResult.pendingTasks,
    pendingContextMessages: tokenResult.pendingContextMessages,
    exactDraftTokens: tokenResult.exactDraftTokens,
  }
}

import type { SessionTextTokenRead } from '@chatbox/core/ports'

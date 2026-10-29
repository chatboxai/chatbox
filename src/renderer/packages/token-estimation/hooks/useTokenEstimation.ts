import { useRowTokenHistory } from '@chatbox/react/token-estimation'
import type { Message } from '@shared/types/session'
import { useEffect, useMemo, useState } from 'react'
import { rendererApplication } from '@/app/renderer-application'
import { reportError } from '@/utils/sentry'
import { analyzeCurrentInputTokens } from '../analyzer'
import {
  estimateDraftTokensImmediately,
  getDraftTokenizationText,
  shouldTokenizeDraftOffMainThread,
} from '../draft-tokenization'
import { tokenizeDraftOffMainThread } from '../draft-tokenizer-worker-client'
import { getTokenizerType } from '../tokenizer'
import type { ExactDraftTokens, TokenEstimationResult, TokenizerType } from '../types'
import { useDraftAttachmentTokens } from './useDraftAttachmentTokens'

export const LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS = 200

import { rendererTokenEstimation as historicalTokens } from '../row-history-service'

export interface UseTokenEstimationOptions {
  sessionId: string | null
  enabled?: boolean
  maxContextMessageCount?: number
  constructedMessage: Message | undefined
  model?: { provider: string; modelId: string }
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
  /** App language code for the wording the model-facing projection adds to the history. */
  language?: string
}

interface DraftTokenResult {
  text: string
  tokenizerType: TokenizerType
  tokens: number
  isExact: boolean
}

function matchesDraft(
  result: DraftTokenResult | null,
  text: string,
  tokenizerType: TokenizerType
): result is DraftTokenResult {
  return result?.text === text && result.tokenizerType === tokenizerType
}

function useDraftTextTokens(options: { text: string; tokenizerType: TokenizerType; enabled: boolean }): {
  tokens: number
  isCalculating: boolean
  isApproximate: boolean
  exactDraftTokens: ExactDraftTokens | null
} {
  const { text, tokenizerType, enabled } = options
  const [workerResult, setWorkerResult] = useState<DraftTokenResult | null>(null)
  const shouldUseWorker = enabled && shouldTokenizeDraftOffMainThread(text)
  const immediateTokens = useMemo(
    () => (enabled ? estimateDraftTokensImmediately(text, tokenizerType) : 0),
    [enabled, text, tokenizerType]
  )
  const resultMatchesCurrentDraft = enabled && matchesDraft(workerResult, text, tokenizerType)

  // Release the retained (possibly multi-MB) draft string once the draft no
  // longer matches, e.g. after send or clear.
  useEffect(() => {
    setWorkerResult((current) => (matchesDraft(current, text, tokenizerType) ? current : null))
  }, [text, tokenizerType])

  useEffect(() => {
    if (!shouldUseWorker) return

    const controller = new AbortController()
    const debounceTimer = setTimeout(() => {
      void tokenizeDraftOffMainThread(text, tokenizerType, controller.signal)
        .then((tokens) => {
          if (controller.signal.aborted) return
          setWorkerResult({ text, tokenizerType, tokens, isExact: true })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setWorkerResult({ text, tokenizerType, tokens: immediateTokens, isExact: false })
          console.error('Failed to tokenize long draft in worker', error)
          reportError(error, { domain: 'token-estimation', operation: 'draft-tokenizer-worker' })
        })
    }, LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS)

    return () => {
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [immediateTokens, shouldUseWorker, text, tokenizerType])

  const exactDraftTokens = useMemo<ExactDraftTokens | null>(
    () =>
      resultMatchesCurrentDraft && workerResult.isExact
        ? { text: workerResult.text, tokenizerType: workerResult.tokenizerType, tokens: workerResult.tokens }
        : null,
    [resultMatchesCurrentDraft, workerResult]
  )

  return {
    tokens: resultMatchesCurrentDraft ? workerResult.tokens : immediateTokens,
    isCalculating: shouldUseWorker && !resultMatchesCurrentDraft,
    isApproximate: !enabled || (shouldUseWorker && (!resultMatchesCurrentDraft || workerResult?.isExact === false)),
    exactDraftTokens,
  }
}

export function useTokenEstimation(
  options: UseTokenEstimationOptions
): TokenEstimationResult & { contextMessageCount: number } {
  const { sessionId, constructedMessage, model, modelSupportToolUseForFile, sandboxMode } = options
  const hasSession = Boolean(sessionId && sessionId !== 'new')
  const enabled = options.enabled ?? !hasSession
  const tokenizerType = getTokenizerType(model)
  const currentInputText = useMemo(
    () => (enabled && constructedMessage ? getDraftTokenizationText(constructedMessage) : ''),
    [enabled, constructedMessage]
  )
  const draftTextTokens = useDraftTextTokens({ text: currentInputText, tokenizerType, enabled })
  const draftAttachments = useDraftAttachmentTokens(
    constructedMessage,
    tokenizerType,
    modelSupportToolUseForFile,
    sandboxMode,
    enabled
  )
  const input = useMemo(
    () =>
      enabled
        ? analyzeCurrentInputTokens({
            constructedMessage,
            tokenizerType,
            modelSupportToolUseForFile,
            sandboxMode,
            currentInputTextTokens: draftTextTokens.tokens,
          })
        : { breakdown: { text: 0, attachments: 0, toolCalls: 0 }, pendingTasks: [], hasApproximateText: true },
    [enabled, constructedMessage, tokenizerType, modelSupportToolUseForFile, sandboxMode, draftTextTokens.tokens]
  )
  const history = useRowTokenHistory({
    service: historicalTokens,
    events: rendererApplication.sessionEvents,
    enabled: hasSession && enabled,
    request: {
      sessionId,
      model,
      maxContextMessageCount: options.maxContextMessageCount,
      modelSupportToolUseForFile,
      sandboxMode,
      language: options.language,
    },
  })
  const contextTokens = history.result?.contextTokens ?? 0
  const currentInputTokens = input.breakdown.text + draftAttachments.tokens + input.breakdown.toolCalls
  const isDraftCalculating = draftTextTokens.isCalculating || draftAttachments.isCalculating
  const isContextCalculating = history.calculating
  const isCurrentInputApproximate = draftTextTokens.isApproximate || draftAttachments.isApproximate
  const isContextApproximate =
    hasSession && (!history.result || history.result.approximation.context || history.failed || history.calculating)
  return {
    currentInputTokens,
    contextTokens,
    totalTokens: currentInputTokens + contextTokens,
    contextMessageCount: history.result?.contextMessageCount ?? 0,
    isCalculating: isDraftCalculating || isContextCalculating,
    isDraftCalculating,
    isContextCalculating,
    isCurrentInputApproximate,
    isContextApproximate,
    isTotalApproximate: isCurrentInputApproximate || isContextApproximate,
    pendingTasks: (isDraftCalculating ? 1 : 0) + (isContextCalculating ? 1 : 0),
    pendingContextMessages: isContextCalculating ? (history.result?.contextMessageCount ?? 1) : 0,
    exactDraftTokens: draftTextTokens.exactDraftTokens,
    breakdown: {
      currentInput: { ...input.breakdown, attachments: draftAttachments.tokens },
      context: history.result?.breakdown.context ?? { text: 0, attachments: 0, toolCalls: 0 },
    },
  }
}

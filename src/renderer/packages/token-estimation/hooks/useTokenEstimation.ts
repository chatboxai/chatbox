import type { Message } from '@shared/types/session'
import { useEffect, useMemo, useRef, useState } from 'react'
import { reportError } from '@/utils/sentry'
import { analyzeContextTokens, analyzeCurrentInputTokens } from '../analyzer'
import { computationQueue, generateTaskId } from '../computation-queue'
import {
  estimateDraftTokensImmediately,
  getDraftTokenizationText,
  shouldTokenizeDraftOffMainThread,
} from '../draft-tokenization'
import { tokenizeDraftOffMainThread } from '../draft-tokenizer-worker-client'
import { getTokenizerType } from '../tokenizer'
import type { ExactDraftTokens, TokenEstimationResult, TokenizerType } from '../types'

/**
 * During a backfill the queue completes a task every few milliseconds and
 * notifies on every completion; updating React state at that rate re-renders
 * the (large) InputBox per task. Trailing-edge throttle keeps progress visible
 * while bounding the re-render rate.
 */
const QUEUE_STATUS_THROTTLE_MS = 100
export const LONG_DRAFT_TOKENIZATION_DEBOUNCE_MS = 200

export interface UseTokenEstimationOptions {
  sessionId: string | null
  constructedMessage: Message | undefined
  contextMessages: Message[]
  model?: { provider: string; modelId: string }
  modelSupportToolUseForFile: boolean
  sandboxMode?: boolean
}

interface QueueStatus {
  pending: number
  running: number
  unfinishedContextMessageIds: Set<string>
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
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

function useDraftTextTokens(options: { text: string; tokenizerType: TokenizerType }): {
  tokens: number
  isCalculating: boolean
  isApproximate: boolean
  exactDraftTokens: ExactDraftTokens | null
} {
  const { text, tokenizerType } = options
  const [workerResult, setWorkerResult] = useState<DraftTokenResult | null>(null)
  const shouldUseWorker = shouldTokenizeDraftOffMainThread(text)
  const immediateTokens = useMemo(() => estimateDraftTokensImmediately(text, tokenizerType), [text, tokenizerType])
  const resultMatchesCurrentDraft = matchesDraft(workerResult, text, tokenizerType)

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
    isApproximate: shouldUseWorker && (!resultMatchesCurrentDraft || workerResult?.isExact === false),
    exactDraftTokens,
  }
}

export function useTokenEstimation(options: UseTokenEstimationOptions): TokenEstimationResult {
  const { sessionId, constructedMessage, contextMessages, model, modelSupportToolUseForFile, sandboxMode } = options

  const tokenizerType = useMemo(() => getTokenizerType(model), [model])

  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    pending: 0,
    running: 0,
    unfinishedContextMessageIds: new Set(),
  })
  const lastInvalidatedTaskSignature = useRef<string>('')
  const contextMessageIds = useMemo(() => new Set(contextMessages.map((message) => message.id)), [contextMessages])

  const currentInputText = useMemo(
    () => (constructedMessage ? getDraftTokenizationText(constructedMessage) : ''),
    [constructedMessage]
  )
  const draftTextTokens = useDraftTextTokens({ text: currentInputText, tokenizerType })

  useEffect(() => {
    let throttleTimer: ReturnType<typeof setTimeout> | null = null

    const updateStatus = () => {
      const next: QueueStatus = { pending: 0, running: 0, unfinishedContextMessageIds: new Set() }
      if (sessionId && sessionId !== 'new') {
        const status = computationQueue.getStatusForSession(sessionId)
        next.pending = status.pending
        next.running = status.running
        next.unfinishedContextMessageIds = new Set(
          [...computationQueue.getUnfinishedMessageIdsForSession(sessionId)].filter((messageId) =>
            contextMessageIds.has(messageId)
          )
        )
      }
      // Bail out with the previous object when nothing changed so React can
      // skip the re-render entirely.
      setQueueStatus((prev) =>
        prev.pending === next.pending &&
        prev.running === next.running &&
        setsEqual(prev.unfinishedContextMessageIds, next.unfinishedContextMessageIds)
          ? prev
          : next
      )
    }

    const onQueueChange = () => {
      if (throttleTimer) return
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        updateStatus()
      }, QUEUE_STATUS_THROTTLE_MS)
    }

    updateStatus()
    const unsubscribe = computationQueue.subscribe(onQueueChange)
    return () => {
      unsubscribe()
      if (throttleTimer) clearTimeout(throttleTimer)
    }
  }, [sessionId, contextMessageIds])

  // Analyze the draft independently so context churn never restarts its worker.
  const currentInputAnalysis = useMemo(
    () =>
      analyzeCurrentInputTokens({
        constructedMessage,
        tokenizerType,
        modelSupportToolUseForFile,
        sandboxMode,
        currentInputTextTokens: draftTextTokens.tokens,
      }),
    [constructedMessage, tokenizerType, modelSupportToolUseForFile, sandboxMode, draftTextTokens.tokens]
  )

  const contextAnalysis = useMemo(
    () =>
      analyzeContextTokens({
        contextMessages,
        tokenizerType,
        modelSupportToolUseForFile,
        sandboxMode,
      }),
    [contextMessages, tokenizerType, modelSupportToolUseForFile, sandboxMode]
  )

  const pendingAnalysisTasks = useMemo(
    () => [...currentInputAnalysis.pendingTasks, ...contextAnalysis.pendingTasks],
    [currentInputAnalysis.pendingTasks, contextAnalysis.pendingTasks]
  )

  const pendingContextMessages = useMemo(() => {
    const messageIds = new Set(queueStatus.unfinishedContextMessageIds)
    for (const task of contextAnalysis.pendingTasks) messageIds.add(task.messageId)
    return messageIds.size
  }, [contextAnalysis.pendingTasks, queueStatus.unfinishedContextMessageIds])

  const pendingTaskIds = useMemo(() => {
    if (!sessionId || sessionId === 'new') return []
    return pendingAnalysisTasks.map((task) =>
      generateTaskId({
        ...task,
        sessionId,
      })
    )
  }, [pendingAnalysisTasks, sessionId])

  useEffect(() => {
    if (!sessionId || sessionId === 'new') return

    const pendingTaskSignature = pendingTaskIds.join('|')
    if (pendingTaskIds.length > 0 && pendingTaskSignature !== lastInvalidatedTaskSignature.current) {
      computationQueue.invalidateCompletedTasks(pendingTaskIds)
      lastInvalidatedTaskSignature.current = pendingTaskSignature
    }

    if (pendingTaskIds.length === 0) {
      lastInvalidatedTaskSignature.current = ''
    }

    // Cancel tasks for messages no longer in context (e.g., maxContextMessageCount changed)
    computationQueue.retainOnlyMessages(sessionId, contextMessageIds)

    // Cancel tasks with old tokenizerType when model changes
    computationQueue.retainOnlyTokenizerType(sessionId, tokenizerType)

    if (pendingAnalysisTasks.length === 0) return

    computationQueue.enqueueBatch(
      pendingAnalysisTasks.map((task) => ({
        ...task,
        sessionId,
      }))
    )
  }, [sessionId, contextMessageIds, pendingAnalysisTasks, pendingTaskIds, tokenizerType])

  useEffect(() => {
    return () => {
      if (sessionId && sessionId !== 'new') {
        computationQueue.cancelBySession(sessionId)
      }
    }
  }, [sessionId])

  const currentInputTokens =
    currentInputAnalysis.breakdown.text +
    currentInputAnalysis.breakdown.attachments +
    currentInputAnalysis.breakdown.toolCalls
  const contextTokens =
    contextAnalysis.breakdown.text + contextAnalysis.breakdown.attachments + contextAnalysis.breakdown.toolCalls

  const breakdown = useMemo(
    () => ({
      currentInput: currentInputAnalysis.breakdown,
      context: contextAnalysis.breakdown,
    }),
    [currentInputAnalysis.breakdown, contextAnalysis.breakdown]
  )
  const isDraftCalculating = draftTextTokens.isCalculating
  const isContextCalculating = pendingContextMessages > 0
  const isCalculating =
    isDraftCalculating || queueStatus.pending > 0 || queueStatus.running > 0 || pendingAnalysisTasks.length > 0
  const isCurrentInputApproximate = draftTextTokens.isApproximate || currentInputAnalysis.pendingTasks.length > 0
  const isContextApproximate = contextAnalysis.hasApproximateText

  return {
    currentInputTokens,
    contextTokens,
    totalTokens: currentInputTokens + contextTokens,
    isCalculating,
    isDraftCalculating,
    isCurrentInputApproximate,
    isTotalApproximate: isCalculating || isCurrentInputApproximate || isContextApproximate,
    isContextApproximate,
    isContextCalculating,
    pendingTasks: queueStatus.pending + queueStatus.running + (draftTextTokens.isCalculating ? 1 : 0),
    pendingContextMessages,
    exactDraftTokens: draftTextTokens.exactDraftTokens,
    breakdown,
  }
}

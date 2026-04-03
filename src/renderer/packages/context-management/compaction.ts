import type { CompactionPoint, Message, SessionSettings, Settings } from '@shared/types'
import { createMessage } from '@shared/types'
import { getTokenizerType } from '@/packages/token-estimation'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { sumCachedTokensFromMessages } from '../token'
import { checkOverflow } from './compaction-detector'
import { buildContextForAI } from './context-builder'
import {
  type ContextTokensCacheValue,
  getContextMessagesForTokenEstimation,
  getContextTokensCacheKey,
  getLatestCompactionBoundaryId,
} from './context-tokens'
import { generateSummaryWithStream } from './summary-generator'

function getModelContextWindowFromSettings(
  providerId: string | undefined,
  modelId: string | undefined,
  settings: Settings
): number | undefined {
  if (!providerId || !modelId) return undefined
  const providerSettings = settings.providers?.[providerId]
  const model = providerSettings?.models?.find((m) => m.modelId === modelId)
  return model?.contextWindow
}

const ongoingCompactions = new Set<string>()

export interface CompactionOptions {
  force?: boolean
}

export interface CompactionResult {
  success: boolean
  compacted: boolean
  error?: Error
  summaryMessageId?: string
}

export function isAutoCompactionEnabled(sessionSettings?: SessionSettings, globalSettings?: Settings): boolean {
  if (sessionSettings?.autoCompaction !== undefined) {
    return sessionSettings.autoCompaction
  }
  return globalSettings?.autoCompaction ?? true
}

export function isCompactionInProgress(sessionId: string): boolean {
  return ongoingCompactions.has(sessionId)
}

export async function needsCompaction(sessionId: string): Promise<boolean> {
  // ===== Keep existing early returns (do not modify) =====
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    console.log('[DEBUG needsCompaction] session not found')
    return false
  }

  const globalSettings = settingsStore.getState().getSettings()

  if (!isAutoCompactionEnabled(session.settings, globalSettings)) {
    console.log('[DEBUG needsCompaction] auto compaction disabled')
    return false
  }

  const providerId = session.settings?.provider ?? globalSettings.defaultChatModel?.provider
  const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
  if (!modelId) {
    console.log('[DEBUG needsCompaction] no modelId')
    return false
  }

  // ===== NEW: Get merged settings =====
  const mergedSettings = await chatStore.getSessionSettings(sessionId)
  const maxContextMessageCount = mergedSettings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER

  // ===== NEW: Construct cache key =====
  const contextMessages = getContextMessagesForTokenEstimation(session, { settings: mergedSettings })
  const model = providerId && modelId ? { provider: providerId, modelId } : undefined
  const tokenizerType = getTokenizerType(model)

  const cacheKey = getContextTokensCacheKey({
    sessionId,
    maxContextMessageCount,
    latestContextMessageId: contextMessages[contextMessages.length - 1]?.id ?? null,
    latestCompactionBoundaryId: getLatestCompactionBoundaryId(session.compactionPoints),
    tokenizerType,
  })

  // ===== NEW: Read from cache =====
  const cachedResult = queryClient.getQueryData<ContextTokensCacheValue>(cacheKey)
  if (!cachedResult) {
    // L2 cache miss: Use L1 cache aggregation (do NOT trigger calculation tasks)
    const estimatedTokens = sumCachedTokensFromMessages(contextMessages)
    queryClient.setQueryData(cacheKey, {
      contextTokens: estimatedTokens,
      messageCount: contextMessages.length,
      timestamp: Date.now(),
    })
    const contextWindow = getModelContextWindowFromSettings(providerId, modelId, globalSettings)
    return checkOverflow({
      tokens: estimatedTokens,
      modelId,
      settings: { compactionThreshold: globalSettings.compactionThreshold },
      contextWindow,
    }).isOverflow
  }

  // ===== Keep existing: checkOverflow call (only replace tokens source) =====
  const contextWindow = getModelContextWindowFromSettings(providerId, modelId, globalSettings)
  const overflowResult = checkOverflow({
    tokens: cachedResult.contextTokens, // ← Changed: from cache
    modelId,
    settings: { compactionThreshold: globalSettings.compactionThreshold },
    contextWindow,
  })

  return overflowResult.isOverflow
}

export async function runCompactionWithUIState(
  sessionId: string,
  options: CompactionOptions = {}
): Promise<CompactionResult> {
  if (!options.force) {
    const shouldCompact = await needsCompaction(sessionId)
    if (!shouldCompact) {
      return { success: true, compacted: false }
    }
  }

  setCompactionUIState(sessionId, { status: 'running', error: null, streamingText: '' })

  const result = await runCompactionWithStreaming(sessionId)

  if (result.success) {
    setCompactionUIState(sessionId, { status: 'idle', error: null, streamingText: '' })
  } else {
    setCompactionUIState(sessionId, {
      status: 'failed',
      error: result.error?.message ?? 'Compaction failed',
      streamingText: '',
    })
  }

  return result
}

async function runCompactionWithStreaming(sessionId: string): Promise<CompactionResult> {
  if (ongoingCompactions.has(sessionId)) {
    return { success: true, compacted: false }
  }

  ongoingCompactions.add(sessionId)

  try {
    const session = await chatStore.getSession(sessionId)
    if (!session) {
      return { success: false, compacted: false, error: new Error('Session not found') }
    }

    const globalSettings = settingsStore.getState().getSettings()

    const modelId = session.settings?.modelId ?? globalSettings.defaultChatModel?.model
    if (!modelId) {
      return { success: true, compacted: false }
    }

    // Apply maxContextMessageCount to summary input
    const mergedSettings = await chatStore.getSessionSettings(sessionId)
    const maxContextMessageCount = mergedSettings.maxContextMessageCount ?? Number.MAX_SAFE_INTEGER
    const currentContext = getContextMessagesForTokenEstimation(session, { settings: mergedSettings })

    const summaryResult = await generateSummaryWithStream({
      messages: currentContext,
      sessionSettings: session.settings,
      sessionId,
      threadId: sessionId,
      messageId: currentContext.at(-1)?.id,
      onStreamUpdate: (text) => {
        setCompactionUIState(sessionId, { streamingText: text })
      },
    })

    if (!summaryResult.success || !summaryResult.summary) {
      return {
        success: false,
        compacted: false,
        error: summaryResult.error ?? new Error('Failed to generate summary'),
      }
    }

    const summaryMessage = createMessage('assistant', summaryResult.summary)
    summaryMessage.isSummary = true

    const lastNonSummaryMessage = [...session.messages].reverse().find((m) => !m.isSummary)
    if (!lastNonSummaryMessage) {
      return { success: false, compacted: false, error: new Error('No messages to compact') }
    }

    const newCompactionPoint: CompactionPoint = {
      summaryMessageId: summaryMessage.id,
      boundaryMessageId: lastNonSummaryMessage.id,
      createdAt: Date.now(),
    }

    await chatStore.updateSessionWithMessages(sessionId, (currentSession) => {
      if (!currentSession) {
        throw new Error('Session not found during update')
      }

      const updatedMessages: Message[] = [...currentSession.messages, summaryMessage]
      const updatedCompactionPoints: CompactionPoint[] = [
        ...(currentSession.compactionPoints ?? []),
        newCompactionPoint,
      ]

      return {
        ...currentSession,
        messages: updatedMessages,
        compactionPoints: updatedCompactionPoints,
      }
    })

    return {
      success: true,
      compacted: true,
      summaryMessageId: summaryMessage.id,
    }
  } catch (error) {
    return {
      success: false,
      compacted: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  } finally {
    ongoingCompactions.delete(sessionId)
  }
}

import type { CompactionPoint, SessionSettings, Settings, TaskSession } from '@shared/types'
import { createMessage } from '@shared/types'
import { computeContextAfterCompaction } from '@/packages/context-management'
import { checkOverflow } from '@/packages/context-management/compaction-detector'
import { generateSummaryWithStream } from '@/packages/context-management/summary-generator'
import { getProviderModelContextWindowSync } from '@/packages/model-registry'
import { sumCachedTokensFromMessages, type TokenModel } from '@/packages/token'
import { setCompactionUIState } from '@/stores/atoms/compactionAtoms'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { queryClient } from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { TASK_SESSION_QUERY_KEY, updateTaskSession } from '@/stores/taskSessionStore'

const ongoingCompactions = new Set<string>()

export interface CompactionResult {
  success: boolean
  compacted: boolean
  error?: Error
  summaryMessageId?: string
}

function isAutoCompactionEnabled(sessionSettings?: SessionSettings, globalSettings?: Settings): boolean {
  if (sessionSettings?.autoCompaction !== undefined) {
    return sessionSettings.autoCompaction
  }
  return globalSettings?.autoCompaction ?? true
}

function resolveTaskModel(sessionSettings?: SessionSettings): { providerId: string; modelId: string } | null {
  if (sessionSettings?.provider && sessionSettings?.modelId) {
    return { providerId: sessionSettings.provider, modelId: sessionSettings.modelId }
  }

  const lastUsedTask = lastUsedModelStore.getState().task
  if (lastUsedTask?.provider && lastUsedTask?.modelId) {
    return { providerId: lastUsedTask.provider, modelId: lastUsedTask.modelId }
  }

  const settings = settingsStore.getState().getSettings()
  const defaultChat = settings.defaultChatModel
  if (defaultChat?.provider && defaultChat?.model) {
    return { providerId: defaultChat.provider, modelId: defaultChat.model }
  }

  const lastUsedChat = lastUsedModelStore.getState().chat
  if (lastUsedChat?.provider && lastUsedChat?.modelId) {
    return { providerId: lastUsedChat.provider, modelId: lastUsedChat.modelId }
  }

  return null
}

function getModelContextWindowFromSettings(
  providerId: string,
  modelId: string,
  settings: Settings
): number | undefined {
  const providerSettings = settings.providers?.[providerId]
  const model = providerSettings?.models?.find((m) => m.modelId === modelId)
  return model?.contextWindow ?? getProviderModelContextWindowSync(providerId, modelId) ?? undefined
}

export function isTaskCompactionInProgress(taskId: string): boolean {
  return ongoingCompactions.has(taskId)
}

export function needsTaskCompaction(taskId: string): Promise<boolean> {
  const session = queryClient.getQueryData<TaskSession>([TASK_SESSION_QUERY_KEY, taskId])
  if (!session) {
    return Promise.resolve(false)
  }

  const globalSettings = settingsStore.getState().getSettings()
  if (!isAutoCompactionEnabled(session.settings, globalSettings)) {
    return Promise.resolve(false)
  }

  const model = resolveTaskModel(session.settings)
  if (!model) {
    return Promise.resolve(false)
  }

  const tokenModel: TokenModel = { provider: model.providerId, modelId: model.modelId }
  const contextWindow = getModelContextWindowFromSettings(model.providerId, model.modelId, globalSettings)
  const contextMessages = computeContextAfterCompaction(session.messages, session.compactionPoints)
  const tokens = sumCachedTokensFromMessages(contextMessages, tokenModel)
  const overflowResult = checkOverflow({
    tokens,
    modelId: model.modelId,
    settings: { compactionThreshold: globalSettings.compactionThreshold },
    contextWindow,
  })

  return Promise.resolve(overflowResult.isOverflow)
}

export async function runTaskCompaction(
  taskId: string,
  options: {
    force?: boolean
  } = {}
): Promise<CompactionResult> {
  if (!options.force) {
    const shouldCompact = await needsTaskCompaction(taskId)
    if (!shouldCompact) {
      return { success: true, compacted: false }
    }
  }

  if (ongoingCompactions.has(taskId)) {
    return { success: true, compacted: false }
  }

  ongoingCompactions.add(taskId)
  setCompactionUIState(taskId, { status: 'running', error: null, streamingText: '' })

  try {
    const session = queryClient.getQueryData<TaskSession>([TASK_SESSION_QUERY_KEY, taskId])
    if (!session) {
      const error = new Error('Task session not found')
      setCompactionUIState(taskId, { status: 'failed', error: error.message, streamingText: '' })
      return { success: false, compacted: false, error }
    }

    const summaryResult = await generateSummaryWithStream({
      messages: computeContextAfterCompaction(session.messages, session.compactionPoints),
      sessionSettings: session.settings,
      onStreamUpdate: (text) => {
        setCompactionUIState(taskId, { streamingText: text })
      },
    })

    if (!summaryResult.success || !summaryResult.summary) {
      const error = summaryResult.error ?? new Error('Failed to generate summary')
      setCompactionUIState(taskId, { status: 'failed', error: error.message, streamingText: '' })
      return { success: false, compacted: false, error }
    }

    const summaryMessage = createMessage('assistant', summaryResult.summary)
    summaryMessage.isSummary = true

    const lastNonSummaryMessage = [...session.messages].reverse().find((message) => !message.isSummary)
    if (!lastNonSummaryMessage) {
      const error = new Error('No messages to compact')
      setCompactionUIState(taskId, { status: 'failed', error: error.message, streamingText: '' })
      return { success: false, compacted: false, error }
    }

    const newCompactionPoint: CompactionPoint = {
      summaryMessageId: summaryMessage.id,
      boundaryMessageId: lastNonSummaryMessage.id,
      createdAt: Date.now(),
    }

    const nextSession: TaskSession = {
      ...session,
      messages: [...session.messages, summaryMessage],
      compactionPoints: [...(session.compactionPoints ?? []), newCompactionPoint],
    }

    const persisted = await updateTaskSession(taskId, {
      messages: nextSession.messages,
      compactionPoints: nextSession.compactionPoints,
    })

    queryClient.setQueryData([TASK_SESSION_QUERY_KEY, taskId], persisted ?? nextSession)
    setCompactionUIState(taskId, { status: 'idle', error: null, streamingText: '' })

    return {
      success: true,
      compacted: true,
      summaryMessageId: summaryMessage.id,
    }
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    setCompactionUIState(taskId, { status: 'failed', error: normalizedError.message, streamingText: '' })

    return {
      success: false,
      compacted: false,
      error: normalizedError,
    }
  } finally {
    ongoingCompactions.delete(taskId)
  }
}

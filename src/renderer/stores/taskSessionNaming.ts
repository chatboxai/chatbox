import { ApiError, NetworkError } from '@shared/models/errors'
import * as Sentry from '@shared/sentry-shim'
import type { ModelProvider, TaskSession } from '@shared/types'
import { createModel } from '@/adapters'
import { languageNameMap } from '@/i18n/locales'
import { generateText } from '@/packages/model-calls'
import * as promptFormat from '@/packages/prompts'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { queryClient } from '@/stores/queryClient'
import { settingsStore } from '@/stores/settingsStore'
import { TASK_SESSION_LIST_QUERY_KEY, TASK_SESSION_QUERY_KEY, updateTaskSession } from '@/stores/taskSessionStore'

const pendingNameGenerations = new Map<string, ReturnType<typeof setTimeout>>()
const activeNameGenerations = new Set<string>()

async function _generateTaskName(taskId: string) {
  const session = queryClient.getQueryData<TaskSession>([TASK_SESSION_QUERY_KEY, taskId])
  const globalSettings = settingsStore.getState().getSettings()
  if (!session) return

  const sessionModelSettings = getDefaultModelSettings(session.settings)
  const settings = {
    ...globalSettings,
    ...sessionModelSettings,
    ...(globalSettings.threadNamingModel
      ? {
          provider: globalSettings.threadNamingModel.provider as ModelProvider,
          modelId: globalSettings.threadNamingModel.model,
        }
      : {}),
  }

  try {
    const model = await createModel(settings)
    const result = await generateText(
      model,
      promptFormat.nameConversation(
        session.messages.filter((m) => m.role !== 'system').slice(0, 4),
        languageNameMap[settings.language]
      )
    )
    let name =
      result.contentParts
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') || ''
    name = name.replace(/['""\u201C\u201D]/g, '').replace(/<think>.*?<\/think>/g, '')
    const updated = await updateTaskSession(taskId, { name })
    if (updated) {
      queryClient.setQueryData([TASK_SESSION_QUERY_KEY, taskId], updated)
    }
    queryClient.invalidateQueries({ queryKey: [TASK_SESSION_LIST_QUERY_KEY] })
  } catch (e: unknown) {
    if (!(e instanceof ApiError || e instanceof NetworkError)) {
      Sentry.captureException(e)
    }
  }
}

function getDefaultModelSettings(sessionSettings?: { provider?: string; modelId?: string }) {
  // 1. Session-level settings (highest priority)
  if (sessionSettings?.provider && sessionSettings?.modelId) {
    return { provider: sessionSettings.provider, modelId: sessionSettings.modelId }
  }
  // 2. Last used task model
  const lastUsedTask = lastUsedModelStore.getState().task
  if (lastUsedTask?.provider && lastUsedTask?.modelId) {
    return { provider: lastUsedTask.provider, modelId: lastUsedTask.modelId }
  }
  // 3. Default chat model (from global settings)
  const settings = settingsStore.getState().getSettings()
  const defaultChat = settings.defaultChatModel
  if (defaultChat?.provider && defaultChat?.model) {
    return { provider: defaultChat.provider, modelId: defaultChat.model }
  }
  // 4. Last used chat model (lowest priority fallback)
  const lastUsedChat = lastUsedModelStore.getState().chat
  if (lastUsedChat?.provider && lastUsedChat?.modelId) {
    return { provider: lastUsedChat.provider, modelId: lastUsedChat.modelId }
  }
  return {}
}

export function scheduleGenerateTaskName(taskId: string) {
  const key = `name-${taskId}`

  if (activeNameGenerations.has(key)) {
    return
  }

  const existingTimeout = pendingNameGenerations.get(key)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }

  const timeout = setTimeout(async () => {
    pendingNameGenerations.delete(key)
    activeNameGenerations.add(key)

    try {
      await _generateTaskName(taskId)
    } finally {
      activeNameGenerations.delete(key)
    }
  }, 1000)

  pendingNameGenerations.set(key, timeout)
}

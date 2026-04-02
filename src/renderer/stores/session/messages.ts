import * as Sentry from '@sentry/react'
import { getModel } from '@shared/models'
import {
  AIProviderNoImplementedPaintError,
  ApiError,
  BaseError,
  ChatboxAIAPIError,
  NetworkError,
} from '@shared/models/errors'
import { createMessage, type Message, ModelProviderEnum } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import { runCompactionWithUIState } from '@/packages/context-management'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import platform from '@/platform'
import * as chatStore from '../chatStore'
import * as settingActions from '../settingActions'
import { settingsStore } from '../settingsStore'
import { uiStore } from '../uiStore'
import { generate } from './generation'
import { insertMessage, modifyMessage } from './message-crud'

/**
 * Get session-level web browsing setting
 * Returns user's explicit setting if set, otherwise returns default based on provider
 */
function getSessionWebBrowsing(sessionId: string, provider: string | undefined): boolean {
  const sessionValue = uiStore.getState().sessionWebBrowsingMap[sessionId]
  if (sessionValue !== undefined) {
    return sessionValue
  }
  // Default: true for ChatboxAI, false for others
  return provider === ModelProviderEnum.ChatboxAI
}

export { insertMessage, insertMessageAfter, modifyMessage, removeMessage } from './message-crud'

/**
 * 在会话中发送新用户消息，并根据需要生成回复
 * @param params
 */
export async function submitNewUserMessage(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean; onUserMessageReady?: () => void }
) {
  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  if (!session || !settings) {
    return
  }

  // Run compaction check before sending message (blocking)
  // Only for chat sessions with auto-compaction enabled
  if (session.type === 'chat' || session.type === undefined) {
    const compactionResult = await runCompactionWithUIState(sessionId)
    if (!compactionResult.success) {
      throw compactionResult.error ?? new Error('Compaction failed')
    }
  }

  // Invoke callback after compaction succeeds, before user message is inserted
  // This allows caller to clear draft at the right time
  params.onUserMessageReady?.()

  const { newUserMsg, needGenerating } = params
  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  // 先在聊天列表中插入发送的用户消息
  await insertMessage(sessionId, newUserMsg)

  const globalSettings = settingsStore.getState().getSettings()
  const isPro = settingActions.isPro()
  const remoteConfig = settingActions.getRemoteConfig()

  // 根据需要，插入空白的回复消息
  let newAssistantMsg = createMessage('assistant', '')
  if (newUserMsg.files && newUserMsg.files.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'sending_file',
      mode: isPro ? 'advanced' : 'local',
    })
  }
  if (newUserMsg.links && newUserMsg.links.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'loading_webpage',
      mode: isPro ? 'advanced' : 'local',
    })
  }
  if (needGenerating) {
    newAssistantMsg.generating = true
    await insertMessage(sessionId, newAssistantMsg)
  }

  try {
    // 如果本次消息开启了联网问答，需要检查当前模型是否支持
    // 桌面版&手机端总是支持联网问答，不再需要检查模型是否支持
    const dependencies = await createModelDependencies()
    const model = getModel(settings, globalSettings, { uuid: '' }, dependencies)
    if (webBrowsing && platform.type === 'web' && !model.isSupportToolUse()) {
      if (remoteConfig.setting_chatboxai_first) {
        throw ChatboxAIAPIError.fromCodeName('model_not_support_web_browsing', 'model_not_support_web_browsing')
      } else {
        throw ChatboxAIAPIError.fromCodeName('model_not_support_web_browsing_2', 'model_not_support_web_browsing_2')
      }
    }

    // Files and links are now preprocessed in InputBox with storage keys, so no need to process them here
    // Just verify they have storage keys
    if (newUserMsg.files?.length) {
      const missingStorageKeys = newUserMsg.files.filter((f) => !f.storageKey)
      if (missingStorageKeys.length > 0) {
        console.warn('Files without storage keys found:', missingStorageKeys)
      }
    }
    if (newUserMsg.links?.length) {
      const missingStorageKeys = newUserMsg.links.filter((l) => !l.storageKey)
      if (missingStorageKeys.length > 0) {
        console.warn('Links without storage keys found:', missingStorageKeys)
      }
    }
  } catch (err: unknown) {
    // 如果文件上传失败，一定会出现带有错误信息的回复消息
    const error = !(err instanceof Error) ? new Error(`${err}`) : err
    if (
      !(
        error instanceof ApiError ||
        error instanceof NetworkError ||
        error instanceof AIProviderNoImplementedPaintError
      )
    ) {
      Sentry.captureException(error) // unexpected error should be reported
    }
    let errorCode: number | undefined
    if (err instanceof BaseError) {
      errorCode = err.code
    }

    newAssistantMsg = {
      ...newAssistantMsg,
      generating: false,
      cancel: undefined,
      model: await getModelDisplayName(settings, globalSettings, 'chat'),
      contentParts: [{ type: 'text', text: '' }],
      errorCode,
      error: `${error.message}`, // 这么写是为了避免类型问题
      status: [],
    }
    if (needGenerating) {
      await modifyMessage(sessionId, newAssistantMsg)
    } else {
      await insertMessage(sessionId, newAssistantMsg)
    }
    return // 文件上传失败，不再继续生成回复
  }
  // 根据需要，生成这条回复消息
  if (needGenerating) {
    return generate(sessionId, newAssistantMsg, { operationType: 'send_message' })
  }
}

import { isExpectedGenerationError } from '@shared/models/error-classification'
import { BaseError, ChatboxAIAPIError } from '@shared/models/errors'
import { createMessage, type Message } from '@shared/types'
import { countMessageWords } from '@shared/utils/message'
import { createModel } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { runCompactionWithUIState } from '@/packages/context-management'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { estimateTokensFromMessages } from '@/packages/token'
import platform from '@/platform'
import { reportError } from '@/utils/sentry'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../../shared/session-attachment-rag/logging'
import * as chatStore from '../chatStore'
import { ensureMessageFileSessionAttachment } from '../sessionAttachmentRagIndexing'
import * as settingActions from '../settingActions'
import { settingsStore } from '../settingsStore'
import { withSessionGenerationLock } from './generation-lock'
import type { SubmissionOutcome } from './generation-outcome'
import { getSessionWebBrowsing } from './utils'

const log = getLogger('session-messages')

async function attachLargeFileRagMetadata(sessionId: string, message: Message): Promise<Message> {
  if (platform.type !== 'desktop' || !message.files?.length) {
    return message
  }

  let changed = false
  const files = await Promise.all(
    message.files.map(async (file) => {
      if (file.ragMode !== 'session-retrieval' || !file.storageKey) {
        return file
      }

      const nextFile = await ensureMessageFileSessionAttachment({
        sessionId,
        messageId: message.id,
        file,
      })
      changed =
        changed ||
        nextFile.sessionAttachmentId !== file.sessionAttachmentId ||
        nextFile.sessionAttachmentAvailability !== file.sessionAttachmentAvailability ||
        nextFile.sessionAttachmentIndexStatus !== file.sessionAttachmentIndexStatus ||
        nextFile.sessionAttachmentStatus !== file.sessionAttachmentStatus ||
        nextFile.sessionAttachmentChunkCount !== file.sessionAttachmentChunkCount ||
        nextFile.sessionAttachmentTotalChunks !== file.sessionAttachmentTotalChunks ||
        nextFile.sessionAttachmentEmbeddedChunks !== file.sessionAttachmentEmbeddedChunks ||
        nextFile.sessionAttachmentIndexingStage !== file.sessionAttachmentIndexingStage
      return nextFile
    })
  )

  if (!changed) {
    return message
  }

  const updatedMessage = { ...message, files }
  log.debug(
    `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} Attachment metadata attached to message: session=${sessionId}, message=${message.id}`
  )
  await chatStore.updateMessage(sessionId, message.id, updatedMessage)
  return updatedMessage
}

/**
 * 在当前主题的最后插入一条消息。
 * @param sessionId
 * @param msg
 */
export async function insertMessage(sessionId: string, msg: Message) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return false
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])
  await chatStore.insertMessage(session.id, msg)
  return true
}

/**
 * 在某条消息后面插入新消息。如果消息在历史主题中，也能支持插入
 * @param sessionId
 * @param msg
 * @param afterMsgId
 */
export async function insertMessageAfter(sessionId: string, msg: Message, afterMsgId: string) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])

  await chatStore.insertMessage(sessionId, msg, afterMsgId)
}

/**
 * 根据 id 修改消息。如果消息在历史主题中，也能支持修改
 * @param sessionId
 * @param updated
 * @param refreshCounting
 */
export async function modifyMessage(
  sessionId: string,
  updated: Message,
  refreshCounting?: boolean,
  updateOnlyCache?: boolean
) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  if (refreshCounting) {
    updated.wordCount = countMessageWords(updated)
    updated.tokenCount = estimateTokensFromMessages([updated])
    updated.tokenCountMap = undefined
  }

  // 更新消息时间戳
  updated.timestamp = Date.now()
  if (updateOnlyCache) {
    await chatStore.updateMessageCache(sessionId, updated.id, updated)
  } else {
    await chatStore.updateMessage(sessionId, updated.id, updated)
  }
}

/**
 * 流式输出期间的轻量级 UI 更新，仅更新 React Query 缓存触发重渲染。
 * 不涉及 storage 写入，不检查 session 存在性（性能优先）。
 */
export function updateStreamingCache(sessionId: string, message: Message): void {
  message.timestamp = Date.now()
  chatStore.updateMessageCache(sessionId, message.id, message).catch((err) => {
    console.error('Failed to update streaming cache:', err)
  })
}

/**
 * 流式输出期间的持久化写入。用于定时 persist（2s 间隔）和最终 persist。
 * 可选刷新 wordCount/tokenCount。
 */
export async function persistStreamingMessage(
  sessionId: string,
  message: Message,
  options?: { refreshCounting?: boolean }
): Promise<void> {
  if (options?.refreshCounting) {
    message.wordCount = countMessageWords(message)
    message.tokenCount = estimateTokensFromMessages([message])
    message.tokenCountMap = undefined
  }
  message.timestamp = Date.now()
  await chatStore.updateMessage(sessionId, message.id, message)
}

/**
 * 在会话中删除消息。如果消息存在于历史主题中，也能支持删除
 * @param sessionId
 * @param messageId
 */
export async function removeMessage(sessionId: string, messageId: string) {
  if (platform.type === 'desktop') {
    try {
      await platform.getSessionAttachmentRagController().deleteMessageAttachments(messageId)
    } catch (error) {
      console.warn('Failed to cleanup session attachment RAG entries for message deletion:', error)
    }
  }
  await chatStore.removeMessage(sessionId, messageId)
}

/**
 * 在会话中发送新用户消息，并根据需要生成回复
 * @param params
 */
export function submitNewUserMessage(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean; onUserMessageReady?: () => void }
) {
  return withSessionGenerationLock(sessionId, () =>
    _submitNewUserMessageWithoutSessionLock(sessionId, {
      newUserMsg: params.newUserMsg,
      needGenerating: params.needGenerating,
      onUserMessageCommitted: params.onUserMessageReady,
    })
  )
}

export async function _submitNewUserMessageWithoutSessionLock(
  sessionId: string,
  params: {
    newUserMsg: Message
    needGenerating: boolean
    onUserMessageCommitted?: () => void
    shouldCommit?: () => boolean
  }
): Promise<SubmissionOutcome> {
  // Import the unlocked generation helper lazily to avoid a circular dependency and
  // avoid reacquiring the session lock already held by submitNewUserMessage().
  const { _generateWithoutSessionLock } = await import('./generation.js')

  const session = await chatStore.getSession(sessionId)
  const settings = await chatStore.getSessionSettings(sessionId)
  if (!session || !settings) {
    return { committed: false, generation: { status: 'failed', error: 'Session or session settings not found' } }
  }

  // Run compaction check before sending message (blocking)
  // Only for chat sessions with auto-compaction enabled
  if (session.type === 'chat' || session.type === undefined) {
    const compactionResult = await runCompactionWithUIState(sessionId)
    if (!compactionResult.success) {
      throw compactionResult.error ?? new Error('Compaction failed')
    }
  }

  let { newUserMsg } = params
  const { needGenerating } = params
  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  // 先在聊天列表中插入发送的用户消息
  if (params.shouldCommit && !params.shouldCommit()) {
    return {
      committed: false,
      generation: { status: 'failed', error: 'Queued submission was discarded before commit' },
    }
  }
  const inserted = await insertMessage(sessionId, newUserMsg)
  if (!inserted) {
    return { committed: false, generation: { status: 'failed', error: 'Session not found before user message commit' } }
  }
  if (params.shouldCommit && !params.shouldCommit()) {
    // A queue clear or thread replacement can occur while the storage write above is in flight.
    // The write cannot be cancelled, so compensate before exposing the message as committed.
    await removeMessage(sessionId, newUserMsg.id)
    return {
      committed: false,
      generation: { status: 'failed', error: 'Queued submission was discarded during user message commit' },
    }
  }
  params.onUserMessageCommitted?.()
  newUserMsg = await attachLargeFileRagMetadata(sessionId, newUserMsg)

  const globalSettings = settingsStore.getState().getSettings()
  const isPro = settingActions.isPro()
  const remoteConfig = await settingActions.getRemoteConfig()

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
    const model = await createModel(settings)
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
    if (!isExpectedGenerationError(error)) {
      reportError(error, {
        domain: 'session',
        operation: 'submit_message',
        priority: 'high',
      })
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
    return {
      committed: true,
      generation: { status: 'failed', error: error.message },
    }
  }
  // 根据需要，生成这条回复消息
  if (needGenerating) {
    const generation = await _generateWithoutSessionLock(sessionId, newAssistantMsg, { operationType: 'send_message' })
    return { committed: true, generation }
  }
  return { committed: true, generation: { status: 'completed' } }
}

import { AIProviderNoImplementedPaintError, ApiError, BaseError, CodedError, NetworkError } from '@shared/models/errors'
import * as Sentry from '@shared/sentry-shim'
import { createMessage, type Message } from '@shared/types'
import { countMessageWords } from '@shared/utils/message'
import { createModel } from '@/adapters'
import { getLogger } from '@/lib/utils'
import { runCompactionWithUIState } from '@/packages/context-management'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { estimateTokensFromMessages } from '@/packages/token'
import platform from '@/platform'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../../shared/session-attachment-rag/logging'
import * as chatStore from '../chatStore'
import { ensureMessageFileSessionAttachment } from '../sessionAttachmentRagIndexing'
import * as settingActions from '../settingActions'
import { settingsStore } from '../settingsStore'
import { getSessionWebBrowsing } from './utils'

const log = getLogger('session-messages')

async function attachLargeFileRagMetadata(sessionId: string, message: Message): Promise<Message> {
  if (!message.files?.length) {
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
    return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg])
  return await chatStore.insertMessage(session.id, msg)
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
  try {
    await platform.getSessionAttachmentRagController().deleteMessageAttachments(messageId)
  } catch (error) {
    console.warn('Failed to cleanup session attachment RAG entries for message deletion:', error)
  }
  await chatStore.removeMessage(sessionId, messageId)
}

/**
 * 在会话中发送新用户消息，并根据需要生成回复
 * @param params
 */
export async function submitNewUserMessage(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean; onUserMessageReady?: () => void }
) {
  // Import generate lazily to avoid circular dependency
  // generate will be moved to generation.ts in US-006, then this import will change
  const { generate } = await import('../sessionActions.js')

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

  let { newUserMsg } = params
  const { needGenerating } = params
  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  // 先在聊天列表中插入发送的用户消息
  await insertMessage(sessionId, newUserMsg)
  newUserMsg = await attachLargeFileRagMetadata(sessionId, newUserMsg)

  const globalSettings = settingsStore.getState().getSettings()

  // 根据需要，插入空白的回复消息
  let newAssistantMsg = createMessage('assistant', '')
  if (newUserMsg.files && newUserMsg.files.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'sending_file',
      mode: 'local',
    })
  }
  if (newUserMsg.links && newUserMsg.links.length > 0) {
    if (!newAssistantMsg.status) {
      newAssistantMsg.status = []
    }
    newAssistantMsg.status.push({
      type: 'loading_webpage',
      mode: 'local',
    })
  }
  if (needGenerating) {
    newAssistantMsg.generating = true
    await insertMessage(sessionId, newAssistantMsg)
  }

  try {
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

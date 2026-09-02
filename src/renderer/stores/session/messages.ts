import { SessionNotFoundError } from '@chatbox/core'
import { withSessionGenerationLock } from '@chatbox/core/generation'
import { getReachableSessionMessages } from '@chatbox/core/session/generation-state'
import { isExpectedGenerationError } from '@shared/models/error-classification'
import { BaseError, ChatboxAIAPIError } from '@shared/models/errors'
import { extractStreamErrorMessage } from '@shared/models/utils/stream-error-message'
import { supportsSessionGeneration } from '@shared/session/capabilities'
import { findMessageLocation } from '@shared/session/message-forks'
import { planAttachmentOwnershipTransfers } from '@shared/session-attachment-rag/ownership'
import { createMessage, type Message } from '@shared/types'
import { countMessageWords } from '@shared/utils/message'
import { normalizeErrorForSentry } from '@shared/utils/sentry_policy'
import { createModel } from '@/adapters'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { runCompactionWithUIState } from '@/packages/context-management'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { estimateTokensFromMessages } from '@/packages/token'
import platform from '@/platform'
import { reportError } from '@/utils/sentry'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../../shared/session-attachment-rag/logging'
import { ensureMessageFileSessionAttachment } from '../sessionAttachmentRagIndexing'
import * as settingActions from '../settingActions'
import { settingsStore } from '../settingsStore'
import { guardSessionAction } from './action-guard'
import { getSessionSettings, getSessionTokenModel } from './session-settings'
import { getSessionWebBrowsing } from './utils'

const log = getLogger('session-messages')

export async function attachLargeFileRagMetadata(sessionId: string, message: Message): Promise<Message> {
  if (!platform.isDesktopLike || !message.files?.length) {
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
  await rendererApplication.sessions.updateMessage(sessionId, message.id, updatedMessage)
  return updatedMessage
}

/**
 * 在当前主题的最后插入一条消息。
 * @param sessionId
 * @param msg
 */
export async function insertMessage(sessionId: string, msg: Message) {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    return
  }
  msg.wordCount = countMessageWords(msg)
  // The session model addresses both the tokenizer and the draft worker's
  // remembered exact count for a long draft being sent.
  msg.tokenCount = estimateTokensFromMessages([msg], 'output', getSessionTokenModel(session))
  return await rendererApplication.sessions.insertMessage(session.id, msg)
}

/**
 * 在某条消息后面插入新消息。如果消息在历史主题中，也能支持插入
 * @param sessionId
 * @param msg
 * @param afterMsgId
 */
export async function insertMessageAfter(
  sessionId: string,
  msg: Message,
  afterMsgId: string,
  options: { requireAnchor?: boolean } = {}
) {
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    // A caller that requires the anchor cannot treat a missing session as a
    // successful write; let insertMessage raise the same error it always does.
    if (!options.requireAnchor) return
  }
  msg.wordCount = countMessageWords(msg)
  msg.tokenCount = estimateTokensFromMessages([msg], 'output', session ? getSessionTokenModel(session) : undefined)

  await rendererApplication.sessions.insertMessage(sessionId, msg, afterMsgId, options)
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
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  if (!session) {
    return
  }
  if (refreshCounting) {
    updated.wordCount = countMessageWords(updated)
    // Cleared first: the estimate below trusts a carried map entry, and the
    // edited text invalidates whatever the message carried.
    updated.tokenCountMap = undefined
    updated.tokenCountApproximate = undefined
    updated.tokenCount = estimateTokensFromMessages([updated], 'output', getSessionTokenModel(session))
  }

  // 更新消息时间戳
  updated.timestamp = Date.now()
  if (updateOnlyCache) {
    await rendererApplication.sessionQueryBridge.updateMessageCache(sessionId, updated.id, updated)
  } else {
    await rendererApplication.sessions.updateMessage(sessionId, updated.id, updated)
  }
}

/**
 * 流式输出期间的轻量级 UI 更新，仅更新 React Query 缓存触发重渲染。
 * 不涉及 storage 写入，不检查 session 存在性（性能优先）。
 */
export function updateStreamingCache(sessionId: string, message: Message): void {
  message.timestamp = Date.now()
  rendererApplication.sessionQueryBridge.updateMessageCache(sessionId, message.id, message).catch((err) => {
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
    // Cleared first: the estimate below trusts a carried map entry, and the
    // streamed text invalidates whatever the message carried.
    message.tokenCountMap = undefined
    message.tokenCountApproximate = undefined
    message.tokenCount = estimateTokensFromMessages([message])
  }
  message.timestamp = Date.now()
  await rendererApplication.sessions.updateMessage(sessionId, message.id, message)
}

/**
 * 在会话中删除消息。如果消息存在于历史主题中，也能支持删除
 * @param sessionId
 * @param messageId
 */
export async function removeMessage(sessionId: string, messageId: string) {
  // Deleting ordinary messages is always allowed (streaming targets are
  // stopped by the caller first), but removing a compaction summary while
  // replies stream would yank the compacted context out from under them.
  // The fetched session is handed to the guard so the summary case doesn't
  // read it twice.
  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  const location = session ? findMessageLocation(session, messageId) : null
  if (
    location?.list[location.index]?.isSummary &&
    !(await guardSessionAction(sessionId, 'delete-summary', {}, session))
  ) {
    return
  }
  if (platform.isDesktopLike) {
    try {
      const controller = platform.getSessionAttachmentRagController()
      // Save & Resend versioning lets several messages share one indexed
      // attachment row. Rebind shared rows to a surviving reference first so
      // the delete-by-owner below (and later orphan maintenance) only takes
      // down rows nobody references any more.
      const removedMessage = location?.list[location.index]
      if (session && removedMessage) {
        for (const transfer of planAttachmentOwnershipTransfers(
          [removedMessage],
          getReachableSessionMessages(session)
        )) {
          await controller.rebindAttachment({
            attachmentId: transfer.attachmentId,
            sessionId,
            messageId: transfer.messageId,
          })
        }
      }
      await controller.deleteMessageAttachments(messageId)
    } catch (error) {
      console.warn('Failed to cleanup session attachment RAG entries for message deletion:', error)
    }
  }
  await rendererApplication.sessions.removeMessage(sessionId, messageId)
}

/**
 * 在会话中发送新用户消息，并根据需要生成回复
 * @param params
 */
export function submitNewUserMessage(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean; onUserMessageReady?: () => void }
) {
  // The gate runs inside the session lock so it reads the freshest state:
  // lock-free alternative replies can start streaming between a pre-lock
  // check and lock acquisition.
  return withSessionGenerationLock(sessionId, async () => {
    if (!(await guardSessionAction(sessionId, 'submit-message'))) {
      return
    }
    return submitNewUserMessageUnlocked(sessionId, params)
  }).catch((error: unknown) => {
    if (error instanceof SessionNotFoundError) return
    throw error
  })
}

export async function submitNewUserMessageUnlocked(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean; onUserMessageReady?: () => void }
) {
  // Import the unlocked generation helper lazily to avoid a circular dependency and
  // avoid reacquiring the session lock already held by submitNewUserMessage().
  const { _generateWithoutSessionLock } = await import('./generation.js')

  const session = await rendererApplication.sessionQueryBridge.getSession(sessionId)
  const settings = await getSessionSettings(sessionId)
  if (!session || !settings) {
    return
  }
  if (!supportsSessionGeneration(session.type)) {
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
    const error = normalizeErrorForSentry(err)
    const userFacingErrorMessage = extractStreamErrorMessage(err)
    if (!isExpectedGenerationError(err)) {
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
      model: await getModelDisplayName(settings, globalSettings, 'chat'),
      contentParts: [{ type: 'text', text: '' }],
      errorCode,
      error: userFacingErrorMessage,
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
    return _generateWithoutSessionLock(sessionId, newAssistantMsg, { operationType: 'send_message' })
  }
}

import { finishAbortedGeneration } from '@chatbox/core/generation'
import { SessionActionBlockedError } from '@chatbox/core/session/action-gates'
import { t } from 'i18next'
import { notifySessionLockBlocked } from '@/utils/session-lock-copy'
import { getCompactionUIState } from '../atoms/compactionAtoms'
import { compactionFailureError, SessionNotFoundError } from '@chatbox/core'
import {
  createGenerationSegmentSplitWriter,
  type SessionService,
  StreamingWriteCoordinator,
  snapshotStreamingMessage,
} from '@chatbox/core/application/session'
import { withSessionGenerationLock } from '@chatbox/core/generation'
import { isExpectedGenerationError } from '@shared/models/error-classification'
import { BaseError, ChatboxAIAPIError } from '@shared/models/errors'
import { extractStreamErrorMessage } from '@shared/models/utils/stream-error-message'
import { supportsSessionGeneration } from '@shared/session/capabilities'
import { cleanupSessionAttachments } from './attachment-cleanup'
import { createMessage, type Message } from '@shared/types'
import { countMessageWords } from '@shared/utils/message'
import { normalizeErrorForSentry } from '@shared/utils/sentry_policy'
import { createModel } from '@/adapters'
import { guardBackupWrite } from '@/app/backup-operation-guard'
import { rendererApplication, sessionRepository } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import { runCompactionWithUIState } from '@/packages/context-management'
import { getModelDisplayName } from '@/packages/model-setting-utils'
import { estimateTokensFromMessages, type TokenModel } from '@/packages/token'
import platform from '@/platform'
import { clearMessageGenerationStopOperation } from '@/stores/generationStopOperations'
import { reportError } from '@/utils/sentry'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../../shared/session-attachment-rag/logging'
import { markSessionReplyFailed } from '../sessionActivityStore'
import { ensureMessageFileSessionAttachment } from '../sessionAttachmentRagIndexing'
import * as settingActions from '../settingActions'
import { settingsStore } from '../settingsStore'
import { guardSessionAction } from './action-guard'
import { getSessionHeader, getSessionSettings, getSessionTokenModel } from './session-settings'
import { getSessionWebBrowsing } from './utils'

const log = getLogger('session-messages')
const streamingWriteCoordinator = new StreamingWriteCoordinator()

export const splitStreamingMessage = createGenerationSegmentSplitWriter({
  sessions: rendererApplication.sessions,
  streamingWrites: streamingWriteCoordinator,
})

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
 * Refreshes a message's word and token counts. `dropTokenCaches` clears cached
 * token entries first, because the estimate trusts a carried map entry that new
 * text invalidates.
 */
function applyMessageCounts(
  message: Message,
  tokenModel: TokenModel | undefined,
  options: { dropTokenCaches?: boolean } = {}
) {
  message.wordCount = countMessageWords(message)
  if (options.dropTokenCaches) {
    message.tokenCountMap = undefined
    message.tokenCountApproximate = undefined
  }
  message.tokenCount = estimateTokensFromMessages([message], 'output', tokenModel)
}

/**
 * 在当前主题的最后插入一条消息。
 * @param sessionId
 * @param msg
 */
export async function insertMessage(sessionId: string, msg: Message) {
  const session = await getSessionHeader(sessionId)
  if (!session) {
    return
  }
  // The session model addresses both the tokenizer and the draft worker's
  // remembered exact count for a long draft being sent.
  applyMessageCounts(msg, getSessionTokenModel(session))
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
  options: Parameters<SessionService['insertMessage']>[3] = {}
) {
  const session = await getSessionHeader(sessionId)
  if (!session) {
    // A caller that requires the anchor cannot treat a missing session as a
    // successful write; let insertMessage raise the same error it always does.
    if (!options.requireAnchor) return
  }
  applyMessageCounts(msg, session ? getSessionTokenModel(session) : undefined)

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
  const session = await getSessionHeader(sessionId)
  if (!session) {
    return
  }
  if (refreshCounting) {
    applyMessageCounts(updated, getSessionTokenModel(session), { dropTokenCaches: true })
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
  const snapshot = snapshotStreamingMessage(message)
  const key = `${sessionId}\u0000${message.id}`
  streamingWriteCoordinator
    .runCacheUpdate(key, (isCurrent) =>
      rendererApplication.sessionQueryBridge.updateMessageCache(sessionId, snapshot.id, snapshot, {
        shouldApply: isCurrent,
      })
    )
    .catch((err) => {
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
  options?: { checkpoint?: boolean; refreshCounting?: boolean; onlyIfGenerating?: boolean }
): Promise<void> {
  if (options?.refreshCounting) {
    applyMessageCounts(message, undefined, { dropTokenCaches: true })
  }
  message.timestamp = Date.now()
  const snapshot = snapshotStreamingMessage(message)
  const write = () =>
    rendererApplication.sessions.updateMessage(
      sessionId,
      snapshot.id,
      options?.onlyIfGenerating
        ? (current) => {
            if (!current) throw new Error(`Message ${snapshot.id} not found`)
            return current.generating
              ? snapshot.generating === false
                ? finishAbortedGeneration(
                    { ...current, ...snapshot },
                    snapshot.contentParts,
                    snapshot.timestamp ?? Date.now()
                  )
                : snapshot
              : current
          }
        : snapshot
    )
  const key = `${sessionId}\u0000${message.id}`

  if (options?.checkpoint) {
    await streamingWriteCoordinator.scheduleCheckpoint(key, write)
    return
  }
  if (message.generating === false) {
    await streamingWriteCoordinator.persistTerminal(key, write)
    const stoppingRuntime = rendererApplication.generationRuntime.get(sessionId, message.id)
    if (stoppingRuntime?.phase === 'stopping') {
      rendererApplication.generationRuntime.clear(sessionId, message.id, stoppingRuntime)
    }
    clearMessageGenerationStopOperation(sessionId, message.id)
    return
  }
  await write()
}

/**
 * 在会话中删除消息。如果消息存在于历史主题中，也能支持删除
 * @param sessionId
 * @param messageId
 */
export async function removeMessage(sessionId: string, messageId: string) {
  let cleanup: Promise<void> | undefined
  const onCommitted = (result: import('@chatbox/core/ports').SessionStructureResult) => {
    if (!result.applied) return
    if (result.cancelMessageIds.includes(messageId) || rendererApplication.generationRuntime.get(sessionId, messageId))
      rendererApplication.generationRuntime.discard(sessionId, messageId, 'message-deleted')
    clearMessageGenerationStopOperation(sessionId, messageId)
    cleanup = cleanupSessionAttachments(sessionId, messageId)
  }
  try {
    const result = await rendererApplication.sessions.executeStructureCommand(
      sessionId,
      {
        action: 'message-remove',
        messageId,
        replacementPivotId: createMessage('system', '').id,
        guard: {
          action: 'delete-summary',
          compactionRunning: getCompactionUIState(sessionId).status === 'running',
          activeGenerationMessageIds: rendererApplication.generationRuntime.getActiveMessageIds(sessionId),
        },
      },
      onCommitted
    )
    if (result) return
  } catch (error) {
    if (!(error instanceof SessionActionBlockedError)) throw error
    await notifySessionLockBlocked(error.reason, t)
    return
  } finally {
    await cleanup
  }
}

/**
 * 在会话中发送新用户消息，并根据需要生成回复
 * @param params
 */
export async function submitNewUserMessage(
  sessionId: string,
  params: { newUserMsg: Message; needGenerating: boolean; onUserMessageReady?: () => void }
) {
  if (!(await guardBackupWrite())) return
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

  const session = await getSessionHeader(sessionId)
  if (!session) {
    return
  }
  const settings = await getSessionSettings(sessionId, session)
  if (!supportsSessionGeneration(session.type)) {
    return
  }

  if (platform.type === 'mobile') {
    const { getSessionAgentModeEntry } = await import('./agent-mode')
    if (getSessionAgentModeEntry(sessionId, session).value === 'on') {
      const [{ capacitorWorkspace }, { currentBlobStorage }] = await Promise.all([
        import('@/packages/mobile-work-mode/runtime'),
        import('@/adapters/CurrentBlobStorage'),
      ])
      const attachments = async function* () {
        for await (const row of sessionRepository.iterateSessionAttachmentFacts({ sessionId, scope: 'active-path' })) {
          yield {
            files: row.files,
            contentParts: row.imageStorageKeys.map((storageKey) => ({ type: 'image' as const, storageKey })),
          }
        }
        yield params.newUserMsg
      }
      await capacitorWorkspace.preflight(sessionId, attachments(), currentBlobStorage)
    }
  }

  // Run compaction check before sending message (blocking)
  // Only for chat sessions with auto-compaction enabled
  if (session.type === 'chat' || session.type === undefined) {
    const compactionResult = await runCompactionWithUIState(sessionId, {
      kind: 'automatic',
      pendingMessage: params.newUserMsg,
    })
    if (compactionResult.status === 'failed') {
      throw compactionFailureError(compactionResult.failure)
    }
  }

  let { newUserMsg } = params
  const { needGenerating } = params
  const webBrowsing = getSessionWebBrowsing(sessionId, settings.provider)

  const insertTogether = platform.type === 'mobile' && needGenerating
  if (!insertTogether) {
    // Invoke callback after compaction succeeds, before user message is inserted
    // This allows caller to clear draft at the right time
    params.onUserMessageReady?.()
    await insertMessage(sessionId, newUserMsg)
    newUserMsg = await attachLargeFileRagMetadata(sessionId, newUserMsg)
  }

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
    if (insertTogether) {
      const tokenModel = getSessionTokenModel(session)
      for (const message of [newUserMsg, newAssistantMsg]) applyMessageCounts(message, tokenModel)
      await rendererApplication.sessions.insertMessages(sessionId, [newUserMsg, newAssistantMsg])
      // Both messages are saved together, so the draft is released only now.
      params.onUserMessageReady?.()
    } else {
      await insertMessage(sessionId, newAssistantMsg)
    }
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
    markSessionReplyFailed(sessionId, newAssistantMsg)
    return // 文件上传失败，不再继续生成回复
  }
  // 根据需要，生成这条回复消息
  if (needGenerating) {
    return _generateWithoutSessionLock(sessionId, newAssistantMsg, { operationType: 'send_message' })
  }
}

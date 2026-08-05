import type { Session } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { getLogger } from '@/lib/utils'
import { PREVIEW_LINES } from '@shared/constants'
import {
  buildAttachmentWrapperPrefix,
  buildAttachmentWrapperSuffix,
} from '@/packages/context-management/attachment-payload'
import storage from '@/storage'
import * as chatStore from '@/stores/chatStore'
import { computationQueue } from './computation-queue'
import { estimateTokens } from './tokenizer'
import type { ComputationTask, TaskResult, TokenizerType } from './types'

const log = getLogger('token-estimation:executor')

interface ResultPersister {
  addResult(result: NonNullable<TaskResult['result']>): void
}

let resultPersister: ResultPersister | null = null

export function setResultPersister(persister: ResultPersister): void {
  resultPersister = persister
}

export async function executeTask(task: ComputationTask): Promise<TaskResult> {
  if (computationQueue.isSessionCancelled(task.sessionId)) {
    log.debug('Task cancelled due to session cancellation', { taskId: task.id })
    return { success: false, error: 'session_cancelled', silent: true }
  }

  log.debug('Executing task', { taskId: task.id, type: task.type })

  if (task.type === 'message-text') {
    return await executeMessageTextTask(task)
  }
  return await executeAttachmentTask(task)
}

async function executeMessageTextTask(task: ComputationTask): Promise<TaskResult> {
  const { sessionId, messageId, tokenizerType } = task

  const session = await getSessionForTokenEstimation(sessionId)
  if (!session) {
    log.debug('Session not found', { taskId: task.id, sessionId })
    return { success: false, error: 'session_not_found', silent: true }
  }

  let message = session.messages.find((m) => m.id === messageId)
  if (!message && 'threads' in session && session.threads) {
    for (const thread of session.threads) {
      message = thread.messages.find((m) => m.id === messageId)
      if (message) break
    }
  }

  if (!message) {
    log.debug('Message not found', { taskId: task.id, messageId })
    return { success: false, error: 'message_not_found', silent: true }
  }

  const text = getMessageText(message, true, true)
  const tokens = estimateTokens(text, getTokenModel(tokenizerType))

  log.debug('Message text task completed', { taskId: task.id, tokens })

  return {
    success: true,
    result: {
      type: 'message-text',
      sessionId,
      messageId,
      tokenizerType,
      tokens,
      calculatedAt: Date.now(),
    },
  }
}

async function executeAttachmentTask(task: ComputationTask): Promise<TaskResult> {
  const { sessionId, messageId, attachmentId, attachmentType, tokenizerType, contentMode = 'full' } = task

  if (!attachmentId || !attachmentType) {
    log.debug('Missing attachment info', { taskId: task.id })
    return { success: false, error: 'missing_attachment_info' }
  }

  const session = await getSessionForTokenEstimation(sessionId)
  if (!session) {
    log.debug('Session not found', { taskId: task.id, sessionId })
    return { success: false, error: 'session_not_found', silent: true }
  }

  let message = session.messages.find((m) => m.id === messageId)
  if (!message && 'threads' in session && session.threads) {
    for (const thread of session.threads) {
      message = thread.messages.find((m) => m.id === messageId)
      if (message) break
    }
  }

  if (!message) {
    log.debug('Message not found', { taskId: task.id, messageId })
    return { success: false, error: 'message_not_found', silent: true }
  }

  let attachment: { storageKey?: string; name?: string; title?: string; id: string } | undefined

  if (attachmentType === 'file') {
    attachment = message.files?.find((f) => f.id === attachmentId)
  } else {
    attachment = message.links?.find((l) => l.id === attachmentId)
  }

  if (!attachment) {
    log.debug('Attachment not found', { taskId: task.id, attachmentId })
    return { success: false, error: 'attachment_not_found', silent: true }
  }

  const storageKey = attachment.storageKey
  if (!storageKey) {
    log.debug('No storage key', { taskId: task.id, attachmentId })
    return { success: false, error: 'no_storage_key' }
  }

  let content: string | null = null
  try {
    content = await storage.getBlob(storageKey)
  } catch (error) {
    log.debug('Failed to retrieve attachment content', { taskId: task.id, attachmentId, error })
    return {
      success: true,
      result: {
        type: 'attachment',
        sessionId,
        messageId,
        attachmentId,
        attachmentType,
        tokenizerType,
        contentMode,
        tokens: 0,
        lineCount: 0,
        byteLength: 0,
        calculatedAt: Date.now(),
      },
    }
  }

  if (!content) {
    log.debug('Attachment content is empty', { taskId: task.id, attachmentId })
    return {
      success: true,
      result: {
        type: 'attachment',
        sessionId,
        messageId,
        attachmentId,
        attachmentType,
        tokenizerType,
        contentMode,
        tokens: 0,
        lineCount: 0,
        byteLength: 0,
        calculatedAt: Date.now(),
      },
    }
  }

  const lines = content.split('\n')
  const lineCount = lines.length
  const byteLength = new TextEncoder().encode(content).length

  const tokenContent = contentMode === 'preview' ? lines.slice(0, PREVIEW_LINES).join('\n') : content

  const fileName =
    attachmentType === 'file' ? (attachment as { name: string }).name : (attachment as { title: string }).title
  const fileKey = storageKey

  const wrapperPrefix = buildAttachmentWrapperPrefix({
    attachmentIndex: 1,
    fileName,
    fileKey,
    fileLines: lineCount,
    fileSize: byteLength,
  })

  const wrapperSuffix = buildAttachmentWrapperSuffix({
    isTruncated: contentMode === 'preview',
    previewLines: contentMode === 'preview' ? PREVIEW_LINES : undefined,
    totalLines: contentMode === 'preview' ? lineCount : undefined,
    fileKey: contentMode === 'preview' ? fileKey : undefined,
  })

  const model = getTokenModel(tokenizerType)
  const wrapperTokens = estimateTokens(wrapperPrefix + wrapperSuffix, model)
  const contentTokens = estimateTokens(tokenContent, model)
  const tokens = wrapperTokens + contentTokens

  log.debug('Attachment task completed', { taskId: task.id, tokens, lineCount, byteLength })

  return {
    success: true,
    result: {
      type: 'attachment',
      sessionId,
      messageId,
      attachmentId,
      attachmentType,
      tokenizerType,
      contentMode,
      tokens,
      lineCount,
      byteLength,
      calculatedAt: Date.now(),
    },
  }
}

function getTokenModel(tokenizerType: TokenizerType): { provider: string; modelId: string } | undefined {
  if (tokenizerType === 'deepseek') {
    return { provider: 'deepseek', modelId: 'deepseek-chat' }
  }
  return undefined
}

type TokenEstimationSession = Pick<Session, 'messages' | 'threads'>

async function getSessionForTokenEstimation(sessionId: string): Promise<TokenEstimationSession | null> {
  return await chatStore.getSession(sessionId)
}

export function initializeExecutor(): void {
  computationQueue.setExecutor(async (task) => {
    const result = await executeTask(task)
    if (result.success && result.result && resultPersister) {
      resultPersister.addResult(result.result)
    }
    return result
  })
}

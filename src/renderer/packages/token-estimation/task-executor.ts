import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { rendererApplication } from '@/app/renderer-application'
import { getLogger } from '@/lib/utils'
import {
  buildAttachmentWrapperPrefix,
  buildAttachmentWrapperSuffix,
  PREVIEW_LINES,
} from '@/packages/context-management/attachment-payload'
import { computationQueue } from './computation-queue'
import {
  estimateDraftTokensImmediately,
  getDraftTokenizationText,
  getTokenizationTextDigest,
  shouldTokenizeDraftOffMainThread,
} from './draft-tokenization'
import { tokenizeDraftOffMainThread } from './draft-tokenizer-worker-client'
import { estimateTokensForTokenizerType } from './tokenizer'
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

  if (task.type === 'message-text') {
    return await executeMessageTextTask(task)
  }
  return await executeAttachmentTask(task)
}

async function executeMessageTextTask(task: ComputationTask): Promise<TaskResult> {
  const { sessionId, messageId, tokenizerType } = task

  let text: string
  let textSource = task.textSource === 'read-current' ? undefined : task.textSource
  if (task.textSnapshot !== undefined && task.textSource !== 'read-current') {
    text = task.textSnapshot
  } else {
    const source = await rendererApplication.sessions.readSessionMessages({ sessionId, messageIds: [messageId] })
    if (!source) {
      log.debug('Session not found', { taskId: task.id, sessionId })
      return { success: false, error: 'session_not_found', silent: true }
    }

    const message = source.messages.find((m) => m.id === messageId)

    if (!message) {
      log.debug('Message not found', { taskId: task.id, messageId })
      return { success: false, error: 'message_not_found', silent: true }
    }
    text = getDraftTokenizationText(message)
    if (task.textSnapshot !== undefined && task.textSnapshot !== text)
      return { success: false, error: 'stale_message_text', silent: true }
    textSource = source.textTokens?.sources[messageId]
  }

  const textDigest = getTokenizationTextDigest(text)
  if (
    (task.textSnapshot !== undefined && task.textDigest === undefined) ||
    (task.textDigest !== undefined && task.textDigest !== textDigest) ||
    (textSource !== undefined &&
      (textSource.text !== text ||
        textSource.textDigest !== textDigest ||
        textSource.sessionId !== sessionId ||
        textSource.messageId !== messageId))
  ) {
    log.debug('Message text task source changed before execution', { taskId: task.id, messageId })
    return { success: false, error: 'stale_message_text', silent: true }
  }
  const { tokens, approximate } = await tokenizeMessageText(text, tokenizerType)

  return {
    success: true,
    result: {
      type: 'message-text',
      sessionId,
      messageId,
      tokenizerType,
      tokens,
      // The result crosses the worker and the persister throttle before it is
      // applied; the digest lets the persister drop it if the message text
      // changed in that window.
      textDigest,
      textSource,
      approximate,
      calculatedAt: Date.now(),
    },
  }
}

/**
 * Queue tasks execute on the renderer thread, so text long enough for the
 * draft worker encodes there too — a full synchronous encode of it would be
 * the same stall the draft path avoids. Low priority keeps a batch of these
 * behind any interactive draft request. When the worker cannot deliver
 * (unavailable runtime, failure, timeout), the bounded sampling estimate is
 * returned marked approximate: it is persisted as the best available count,
 * shown with the approximate marker, and re-attempted within the bounded
 * per-run budget tracked in `exact-retry`.
 */
async function tokenizeMessageText(
  text: string,
  tokenizerType: TokenizerType
): Promise<{ tokens: number; approximate: boolean }> {
  if (!shouldTokenizeDraftOffMainThread(text)) {
    return { tokens: estimateTokensForTokenizerType(text, tokenizerType), approximate: false }
  }
  try {
    const tokens = await tokenizeDraftOffMainThread(text, tokenizerType, new AbortController().signal, {
      lowPriority: true,
    })
    return { tokens, approximate: false }
  } catch (error) {
    log.debug('Draft tokenizer worker unavailable for message text; keeping the bounded estimate', { error })
    return { tokens: estimateDraftTokensImmediately(text, tokenizerType), approximate: true }
  }
}

async function executeAttachmentTask(task: ComputationTask): Promise<TaskResult> {
  const { sessionId, messageId, attachmentId, attachmentType, tokenizerType, contentMode = 'full' } = task

  if (!attachmentId || !attachmentType) {
    log.debug('Missing attachment info', { taskId: task.id })
    return { success: false, error: 'missing_attachment_info' }
  }

  const source = await rendererApplication.sessions.readSessionMessages({ sessionId, messageIds: [messageId] })
  if (!source) {
    log.debug('Session not found', { taskId: task.id, sessionId })
    return { success: false, error: 'session_not_found', silent: true }
  }

  const message = source.messages.find((m) => m.id === messageId)

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
  const sourceName = attachmentType === 'file' ? (attachment.name ?? '') : (attachment.title ?? '')

  let content: string | null = null
  try {
    content = await currentBlobStorage.get(storageKey)
  } catch (error) {
    log.debug('Failed to retrieve attachment content', { taskId: task.id, attachmentId, error })
    return { success: false, error: 'attachment_read_failed', retryable: true }
  }

  if (content === null) return { success: false, error: 'attachment_content_missing', retryable: true }

  if (content === '') {
    return {
      success: true,
      result: {
        type: 'attachment',
        sessionId,
        messageId,
        attachmentId,
        attachmentType,
        sourceStorageKey: storageKey,
        sourceName,
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

  const wrapperTokens = estimateTokensForTokenizerType(wrapperPrefix + wrapperSuffix, tokenizerType)
  const contentTokens = estimateTokensForTokenizerType(tokenContent, tokenizerType)
  const tokens = wrapperTokens + contentTokens

  return {
    success: true,
    result: {
      type: 'attachment',
      sessionId,
      messageId,
      attachmentId,
      attachmentType,
      sourceStorageKey: storageKey,
      sourceName,
      tokenizerType,
      contentMode,
      tokens,
      lineCount,
      byteLength,
      calculatedAt: Date.now(),
    },
  }
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

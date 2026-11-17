import { buildAttachment } from '@shared/context/attachments'
import type { MessageFile, MessageLink } from '@shared/types'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { getLogger } from '@/lib/utils'
import { shouldTokenizeDraftOffMainThread } from './draft-tokenization'
import { tokenizeDraftOffMainThread } from './draft-tokenizer-worker-client'
import { estimateTokensForTokenizerType } from './tokenizer'
import type { ComputationTask, TaskResult } from './types'

const log = getLogger('token-estimation:attachment')
/** Reads a content snapshot for either a persisted message or an in-memory draft. */
export async function calculateAttachmentTokens(
  attachment: MessageFile | MessageLink,
  task: ComputationTask,
  signal?: AbortSignal
): Promise<TaskResult> {
  const { sessionId, messageId, attachmentId, attachmentType, tokenizerType, contentMode = 'full' } = task
  if (signal?.aborted) return { success: false, error: 'cancelled', silent: true }
  const storageKey = attachment.storageKey
  if (!storageKey) {
    log.debug('No storage key', { taskId: task.id, attachmentId })
    return { success: false, error: 'no_storage_key' }
  }
  const sourceName =
    attachmentType === 'file'
      ? 'name' in attachment
        ? attachment.name
        : ''
      : 'title' in attachment
        ? attachment.title
        : ''

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

  const tokenContent = buildAttachment({
    index: 1,
    name: sourceName,
    key: storageKey,
    content,
    modelSupportToolUseForFile: contentMode === 'preview',
    contentMode,
  })
  const tokens = shouldTokenizeDraftOffMainThread(tokenContent)
    ? await tokenizeDraftOffMainThread(tokenContent, tokenizerType, signal ?? new AbortController().signal, {
        lowPriority: true,
      })
    : estimateTokensForTokenizerType(tokenContent, tokenizerType)

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

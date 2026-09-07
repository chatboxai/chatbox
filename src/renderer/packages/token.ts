import { reportError } from '@/utils/sentry'
import { estimateMessageToolCallTokens } from '../../shared/context/tool-tokens'
import type { Message, MessageFile, MessageLink } from '../../shared/types'
import { TOKEN_CACHE_KEYS, type TokenCacheKey } from '../../shared/types/session'
import { getMessageText, isEmptyMessage } from '../../shared/utils/message'
import {
  buildAttachmentWrapperPrefix,
  buildAttachmentWrapperSuffix,
  MAX_INLINE_FILE_LINES,
} from './context-management/attachment-payload'
import { estimateDraftTokensImmediately, shouldTokenizeDraftOffMainThread } from './token-estimation/draft-tokenization'
import {
  estimateDeepSeekTokens,
  estimateTokens,
  getTokenizerType,
  isDeepSeekModel,
  type TokenModel,
} from './token-estimation/tokenizer'

export { estimateDeepSeekTokens, estimateTokens, getTokenizerType, isDeepSeekModel, type TokenModel }

export function getTokenCacheKey(model?: TokenModel): TokenCacheKey {
  if (isDeepSeekModel(model)) {
    return TOKEN_CACHE_KEYS.deepseek
  }
  return TOKEN_CACHE_KEYS.default
}

export function getTokenCountForModel(
  item: { tokenCountMap?: Record<string, number>; ragMode?: 'inline' | 'session-retrieval' },
  model?: TokenModel
): number {
  if (item.ragMode === 'session-retrieval') {
    return 0
  }

  const tokenCacheKey = getTokenCacheKey(model)

  if (item.tokenCountMap?.[tokenCacheKey]) {
    return item.tokenCountMap[tokenCacheKey]
  }

  return 0
}

/**
 * Message text tokens. An exact per-tokenizer count already carried on the
 * message — filled by the computation queue, or seeded at submit from the
 * draft worker (`seedExactDraftTokens`) — is trusted over re-encoding. Without
 * one, text long enough for the draft worker gets the bounded sampling
 * estimate instead of a full encode: every caller here sits on the main
 * thread, where encoding a very long unseeded submit is exactly the stall
 * this pipeline exists to avoid. The computation queue later replaces the
 * estimate with the worker's exact count. Write paths must clear
 * `tokenCountMap` before re-estimating edited text.
 */
function estimateMessageTextTokens(msg: Message, type: 'output' | 'input', model?: TokenModel): number {
  const carried = msg.tokenCountMap?.[getTokenCacheKey(model)]
  if (carried) return carried
  const text = getMessageText(msg, false, type === 'output')
  if (shouldTokenizeDraftOffMainThread(text)) {
    return estimateDraftTokensImmediately(text, getTokenizerType(model))
  }
  return estimateTokens(text, model)
}

// 参考: https://github.com/pkoukk/tiktoken-go#counting-tokens-for-chat-api-calls
// OpenAI Cookbook: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
export function estimateTokensFromMessages(
  messages: Message[],
  type = 'output' as 'output' | 'input',
  model?: TokenModel
) {
  if (messages.length === 0) {
    return 0
  }
  try {
    const tokensPerMessage = 3
    const tokensPerName = 1
    let ret = 0
    for (const msg of messages) {
      if (isEmptyMessage(msg)) {
        continue
      }
      ret += tokensPerMessage
      ret += estimateMessageTextTokens(msg, type, model)
      ret += estimateTokens(msg.role, model)
      if (msg.name) {
        ret += estimateTokens(msg.name, model)
        ret += tokensPerName
      }

      // Add token counts from files
      if (msg.files?.length) {
        for (const file of msg.files) {
          const fileTokenCount = getTokenCountForModel(file, model)
          if (fileTokenCount > 0) {
            ret += fileTokenCount
          }
        }
      }

      // Add token counts from links
      if (msg.links?.length) {
        for (const link of msg.links) {
          const linkTokenCount = getTokenCountForModel(link, model)
          if (linkTokenCount > 0) {
            ret += linkTokenCount
          }
        }
      }
    }
    // ret += 3 // every reply is primed with <|start|>assistant<|message|>
    return ret
  } catch (e) {
    reportError(e, {
      domain: 'token-estimation',
      operation: 'estimate_messages',
    })
    return 0
  }
}

// Fixed token estimate for sandbox metadata XML per attachment item
export const SANDBOX_METADATA_PER_ITEM_TOKENS = 15
// Fixed token estimate for sandbox <ATTACHMENT_FILE> metadata wrappers.
export const SANDBOX_METADATA_BASE_TOKENS = 40

/**
 * Sum cached token values from messages without calculation.
 * Used by needsCompaction for non-blocking token count checks.
 * Actual calculation is done by InputBox's useTokenEstimation.
 *
 * @param sandboxMode - When true, attachment tokens use fixed metadata estimate
 *                      instead of cached content tokens
 */
export function sumCachedTokensFromMessages(messages: Message[], model?: TokenModel, sandboxMode = false): number {
  if (messages.length === 0) {
    return 0
  }

  const cacheKey = getTokenCacheKey(model)
  const tokensPerMessage = 3
  const tokensPerName = 1
  let total = 0

  for (const msg of messages) {
    // Text token caches never cover tool-call parts, which dominate agent
    // sessions; without this the pressure/compaction checks blindly undercount.
    // Computed before the empty check: a tool-call-only assistant message has
    // no text and would otherwise be skipped as "empty".
    const toolCallTokens = estimateMessageToolCallTokens(msg)

    if (isEmptyMessage(msg) && toolCallTokens === 0) {
      continue
    }

    // Add per-message overhead
    total += tokensPerMessage

    // Read cached message text tokens (tokenCountMap preferred, tokenCount as fallback)
    total += msg.tokenCountMap?.[cacheKey] ?? msg.tokenCount ?? 0

    total += toolCallTokens

    // Add role tokens
    total += estimateTokens(msg.role, model)

    // Add name tokens if present
    if (msg.name) {
      total += estimateTokens(msg.name, model)
      total += tokensPerName
    }

    const fileCount = msg.files?.length ?? 0
    const linkCount = msg.links?.length ?? 0
    const attachmentCount = fileCount + linkCount

    if (sandboxMode && attachmentCount > 0) {
      // In sandbox mode, only metadata XML is sent — use fixed estimate
      total += SANDBOX_METADATA_BASE_TOKENS + attachmentCount * SANDBOX_METADATA_PER_ITEM_TOKENS
    } else {
      // Read cached file tokens
      if (msg.files?.length) {
        for (const file of msg.files) {
          total += file.tokenCountMap?.[cacheKey] ?? 0
        }
      }

      // Read cached link tokens
      if (msg.links?.length) {
        for (const link of msg.links) {
          total += link.tokenCountMap?.[cacheKey] ?? 0
        }
      }
    }
  }

  return total
}

export function sliceTextByTokenLimit(text: string, limit: number, model?: TokenModel) {
  let ret = ''
  let retTokenCount = 0
  const STEP_LEN = 100
  while (text.length > 0) {
    const part = text.slice(0, STEP_LEN)
    text = text.slice(STEP_LEN)
    const partTokenCount = estimateTokens(part, model)
    if (retTokenCount + partTokenCount > limit) {
      break
    }
    ret += part
    retTokenCount += partTokenCount
  }
  return ret
}

export type PreviewTokenCacheKey = 'default_preview' | 'deepseek_preview'

export function getAttachmentTokenCacheKey(params: {
  model?: TokenModel
  preferPreview: boolean
}): TokenCacheKey | PreviewTokenCacheKey {
  const { model, preferPreview } = params
  const isDeepSeek = isDeepSeekModel(model)

  if (preferPreview) {
    return isDeepSeek ? 'deepseek_preview' : 'default_preview'
  }
  return isDeepSeek ? TOKEN_CACHE_KEYS.deepseek : TOKEN_CACHE_KEYS.default
}

const FALLBACK_WRAPPER_SAFETY_MARGIN_TOKENS = 50

function computeAttachmentTokens(
  attachment: MessageFile | MessageLink,
  attachmentIndex: number,
  model: TokenModel,
  modelSupportToolUseForFile: boolean
): number {
  if (
    'ragMode' in attachment &&
    attachment.ragMode === 'session-retrieval' &&
    (attachment.sessionAttachmentIndexStatus ?? attachment.sessionAttachmentStatus) !== 'failed'
  ) {
    return 0
  }

  const lineCount = attachment.lineCount
  const byteLength = attachment.byteLength
  const tokenCountMap = attachment.tokenCountMap

  const isLargeFile = lineCount !== undefined && lineCount > MAX_INLINE_FILE_LINES
  const usePreview = modelSupportToolUseForFile && isLargeFile

  const hasMetadata = lineCount !== undefined && byteLength !== undefined

  const fileName = 'name' in attachment ? attachment.name : attachment.title
  const localPath = 'localPath' in attachment ? attachment.localPath : undefined
  const fileKey = attachment.storageKey || (localPath ? `local:${localPath}` : attachment.id)

  if (!hasMetadata) {
    const placeholderPrefix = buildAttachmentWrapperPrefix({
      attachmentIndex,
      fileName,
      fileKey,
      fileLines: 0,
      fileSize: 0,
    })
    const placeholderSuffix = buildAttachmentWrapperSuffix({ isTruncated: false })
    const wrapperTokens = estimateTokens(placeholderPrefix + placeholderSuffix, model)

    const cacheKey = getAttachmentTokenCacheKey({ model, preferPreview: false })
    const contentTokens = tokenCountMap?.[cacheKey] ?? 0

    return wrapperTokens + contentTokens + FALLBACK_WRAPPER_SAFETY_MARGIN_TOKENS
  }

  const prefix = buildAttachmentWrapperPrefix({
    attachmentIndex,
    fileName,
    fileKey,
    fileLines: lineCount,
    fileSize: byteLength,
  })
  const suffix = buildAttachmentWrapperSuffix({
    isTruncated: usePreview,
    previewLines: usePreview ? 100 : undefined,
    totalLines: usePreview ? lineCount : undefined,
    fileKey: usePreview ? fileKey : undefined,
  })

  const wrapperTokens = estimateTokens(prefix + suffix, model)

  const cacheKey = getAttachmentTokenCacheKey({ model, preferPreview: usePreview })
  let contentTokens = tokenCountMap?.[cacheKey] ?? 0

  if (contentTokens === 0) {
    const fallbackKey = getAttachmentTokenCacheKey({ model, preferPreview: false })
    contentTokens = tokenCountMap?.[fallbackKey] ?? 0
  }

  const trailingNewlineTokens = estimateTokens('\n', model)

  return wrapperTokens + contentTokens + trailingNewlineTokens
}

export interface EstimateTokensForSendPayloadOptions {
  type?: 'output' | 'input'
  model?: TokenModel
  modelSupportToolUseForFile?: boolean
}

export function estimateTokensFromMessagesForSendPayload(
  messages: Message[],
  options: EstimateTokensForSendPayloadOptions = {}
): number {
  const { type = 'input', model, modelSupportToolUseForFile = false } = options

  if (messages.length === 0) {
    return 0
  }

  try {
    const tokensPerMessage = 3
    const tokensPerName = 1
    let total = 0

    for (const msg of messages) {
      if (isEmptyMessage(msg)) {
        continue
      }

      total += tokensPerMessage
      total += estimateMessageTextTokens(msg, type, model)
      total += estimateTokens(msg.role, model)

      if (msg.name) {
        total += estimateTokens(msg.name, model)
        total += tokensPerName
      }

      let attachmentIndex = 1

      if (msg.files?.length) {
        for (const file of msg.files) {
          if (!file.storageKey) continue
          total += computeAttachmentTokens(file, attachmentIndex, model, modelSupportToolUseForFile)
          attachmentIndex++
        }
      }

      if (msg.links?.length) {
        for (const link of msg.links) {
          if (!link.storageKey) continue
          total += computeAttachmentTokens(link, attachmentIndex, model, modelSupportToolUseForFile)
          attachmentIndex++
        }
      }
    }

    return total
  } catch (e) {
    reportError(e, {
      domain: 'token-estimation',
      operation: 'estimate_send_payload',
    })
    return 0
  }
}

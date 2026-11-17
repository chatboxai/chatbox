import { reportError } from '@/utils/sentry'
import type { Message } from '../../shared/types'
import { TOKEN_CACHE_KEYS, type TokenCacheKey } from '../../shared/types/session'
import { getMessageText, isEmptyMessage } from '../../shared/utils/message'
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

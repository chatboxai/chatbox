import { type AttachmentPlanEntry, type AttachmentPolicy, planMessageAttachments } from '../context/attachments'
import type { Message } from '../types'
import { estimateTokensForTokenizerType, type TokenizerType } from './tokenizer'

export const IMAGE_TOKEN_ESTIMATE = 4096

export function estimateImageTokens(message: Message): number {
  return (message.contentParts?.filter((part) => part.type === 'image').length ?? 0) * IMAGE_TOKEN_ESTIMATE
}

/** Cached content counts and directly countable envelopes use the same payload plan as sending. */
export function analyzeAttachmentTokens(message: Message, tokenizerType: TokenizerType, policy: AttachmentPolicy = {}) {
  const missing: Extract<AttachmentPlanEntry, { kind: 'content' }>[] = []
  const imageTokens = estimateImageTokens(message)
  let tokens = imageTokens
  for (const entry of planMessageAttachments(message, policy)) {
    if (entry.kind === 'text') {
      tokens += estimateTokensForTokenizerType(entry.text, tokenizerType)
      continue
    }
    const key = entry.contentMode === 'preview' ? (`${tokenizerType}_preview` as const) : tokenizerType
    const attachment = entry.attachment
    const cached = attachment.tokenCountMap?.[key]
    if (cached !== undefined && attachment.lineCount !== undefined && attachment.byteLength !== undefined)
      tokens += cached
    else missing.push(entry)
  }
  return { tokens, missing, approximate: imageTokens > 0 || missing.length > 0 }
}

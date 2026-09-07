import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { CJK_CHARACTER_PATTERN, estimateTokensForTokenizerType } from './tokenizer'
import type { ExactDraftTokens, TokenizerType } from './types'

/** Keep small drafts exact while moving perceptibly expensive work off-thread. */
export const LONG_DRAFT_TOKENIZATION_THRESHOLD = 4096

/**
 * The one projection draft token counts are computed against — the worker
 * input, the immediate estimate, and the seeded exact count all use it, so
 * their texts stay comparable byte for byte.
 */
export function getDraftTokenizationText(message: Message): string {
  return getMessageText(message, true, true)
}

/**
 * Carry the worker's exact count on the outgoing message so the insert path
 * reads it from `tokenCountMap` instead of re-encoding the whole draft
 * synchronously at submit. Comparing the projections makes the handoff
 * self-verifying: a draft edited after its last worker result is left
 * unseeded and falls back to the ordinary estimate.
 */
export function seedExactDraftTokens(message: Message, exact: ExactDraftTokens | null): Message {
  if (!exact || getDraftTokenizationText(message) !== exact.text) return message
  return { ...message, tokenCountMap: { ...message.tokenCountMap, [exact.tokenizerType]: exact.tokens } }
}

/**
 * Cheap content digest (length + FNV-1a over UTF-16 code units) of a
 * tokenization text projection. Token results computed asynchronously carry
 * it so a consumer can verify, at apply time, that the result still describes
 * the text the message holds now — an edit in between must invalidate the
 * result rather than attach counts of text the message no longer contains.
 */
export function getTokenizationTextDigest(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

const QUICK_ESTIMATE_SAMPLE_SIZE = 512
const WHITESPACE = /\s/
/**
 * Fractional part of the golden ratio. Sampling at a fixed offset inside each
 * stride phase-locks with periodic content (e.g. an indentation pattern whose
 * period divides the stride puts every sample on a whitespace-run start and
 * multiplies the estimate several-fold); advancing the offset by an irrational
 * step is equidistributed against any period while staying deterministic.
 */
const GOLDEN_RATIO_FRACTION = 0.6180339887498949

export function shouldTokenizeDraftOffMainThread(text: string): boolean {
  return text.length >= LONG_DRAFT_TOKENIZATION_THRESHOLD
}

/**
 * Return an exact count for short drafts and a bounded-cost estimate for long
 * drafts. The long-draft value is replaced by the worker result in the hook.
 */
export function estimateDraftTokensImmediately(text: string, tokenizerType: TokenizerType): number {
  if (!shouldTokenizeDraftOffMainThread(text)) {
    return estimateTokensForTokenizerType(text, tokenizerType)
  }

  const stride = text.length / QUICK_ESTIMATE_SAMPLE_SIZE
  let sampledTokens = 0
  let jitter = 0

  for (let sample = 0; sample < QUICK_ESTIMATE_SAMPLE_SIZE; sample++) {
    jitter = (jitter + GOLDEN_RATIO_FRACTION) % 1
    let index = Math.floor((sample + jitter) * stride)
    // Sampling positions are UTF-16 indices; step back from a trailing
    // surrogate so astral characters (e.g. CJK Extension B+) classify by
    // their full code point instead of a lone surrogate.
    const unit = text.charCodeAt(index)
    if (unit >= 0xdc00 && unit <= 0xdfff && index > 0) index -= 1
    const codePoint = text.codePointAt(index) ?? 0
    const character = String.fromCodePoint(codePoint)
    const unitsPerCharacter = codePoint > 0xffff ? 2 : 1

    // The estimate extrapolates by UTF-16 length, so weigh each sampled
    // position in tokens per code unit rather than per character.
    if (CJK_CHARACTER_PATTERN.test(character)) {
      // cl100k encodes astral CJK as ~3 tokens per character; BMP CJK as ~1.
      sampledTokens += tokenizerType === 'deepseek' ? 0.6 / unitsPerCharacter : unitsPerCharacter === 2 ? 1.5 : 1
    } else if (WHITESPACE.test(character)) {
      if (tokenizerType === 'deepseek') {
        // DeepSeek counts a whitespace run as one token; weigh only run starts
        // so indentation-heavy drafts do not overshoot.
        if (index === 0 || !WHITESPACE.test(text[index - 1])) sampledTokens += 1
      } else {
        sampledTokens += 0.25
      }
    } else {
      sampledTokens += tokenizerType === 'deepseek' ? 0.3 / unitsPerCharacter : 0.25
    }
  }

  return Math.max(Math.ceil((sampledTokens / QUICK_ESTIMATE_SAMPLE_SIZE) * text.length), 1)
}

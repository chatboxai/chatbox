import {
  CJK_CHARACTER_PATTERN,
  estimateTokensForTokenizerType,
  type TokenizerType,
} from '@shared/token-estimation/tokenizer'

/** Keep small drafts exact while moving perceptibly expensive work off-thread. */
export const LONG_DRAFT_TOKENIZATION_THRESHOLD = 4096

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

export const OUTPUT_RESERVE_TOKENS = 32_000
export const DEFAULT_COMPACTION_THRESHOLD = 0.6
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000

export function getCompactionThresholdForContextWindow(
  contextWindow: number,
  compactionThreshold?: number | null
): number {
  const availableWindow = getAvailableCompactionWindowTokens(contextWindow)
  return Math.floor(availableWindow * (compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD))
}

export function getAvailableCompactionWindowTokens(contextWindow: number): number {
  return Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
}

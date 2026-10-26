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
  return estimateTokensBySampling(text, tokenizerType)
}

/**
 * Constant-cost estimate that weighs sampled characters the way the tokenizer
 * does (CJK, whitespace, other text). Exact BPE is superlinear on long
 * unbroken runs such as CJK prose, so hot paths that cannot defer to a worker
 * use this instead.
 */
export function estimateTokensBySampling(text: string, tokenizerType: TokenizerType): number {
  if (!text) return 0
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

/** Largest reply reservation; reasoning models on large windows can use all of it. */
export const OUTPUT_RESERVE_TOKENS = 32_000
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000
/** A reply never claims more than this share of the context window. */
export const MAX_OUTPUT_RESERVE_RATIO = 0.25
/** Default trigger, as a share of the window left after the reply reservation. */
export const DEFAULT_COMPACTION_THRESHOLD = 0.75
/** Share of the usable window a compaction aims to leave the request at. */
export const COMPACTION_TARGET_RATIO = 0.5
/**
 * Cap on the compaction target as a share of the trigger, so a low threshold
 * still leaves the request well below it.
 */
export const COMPACTION_TARGET_SHARE_OF_THRESHOLD = 2 / 3
/**
 * Growth (share of the usable window) a request needs after a compaction before
 * the next one. Compaction can only remove what was added since the last one, so
 * a smaller gain is not worth a summary call or the lost prompt cache.
 */
export const COMPACTION_MIN_GROWTH_RATIO = 0.15
/** Room planned for the summary text when sizing the retained tail. */
export const COMPACTION_SUMMARY_ALLOWANCE_RATIO = 0.1
export const COMPACTION_SUMMARY_ALLOWANCE_MAX_TOKENS = 4096

export interface CompactionBudget {
  contextWindow: number
  outputReserveTokens: number
  /** Window left for the request after the reply reservation. */
  usableTokens: number
  /** A request above this size compacts. */
  thresholdTokens: number
  /** Size a compaction aims to leave the request at. */
  targetTokens: number
  minGrowthTokens: number
  summaryAllowanceTokens: number
}

export interface CompactionBudgetOptions {
  compactionThreshold?: number | null
  /** The reply limit the request runs with: the session's max tokens, else the model's max output. */
  maxOutputTokens?: number | null
}

export function getOutputReserveTokens(contextWindow: number, maxOutputTokens?: number | null): number {
  const requested = maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : OUTPUT_RESERVE_TOKENS
  return Math.max(0, Math.min(requested, OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * MAX_OUTPUT_RESERVE_RATIO)))
}

export function getCompactionBudget(
  contextWindow: number,
  options: CompactionBudgetOptions = {}
): CompactionBudget | null {
  if (!(contextWindow > 0)) return null
  const outputReserveTokens = getOutputReserveTokens(contextWindow, options.maxOutputTokens)
  const usableTokens = contextWindow - outputReserveTokens
  if (usableTokens <= 0) return null
  const thresholdTokens = Math.floor(usableTokens * (options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD))
  return {
    contextWindow,
    outputReserveTokens,
    usableTokens,
    thresholdTokens,
    targetTokens: Math.min(
      Math.floor(usableTokens * COMPACTION_TARGET_RATIO),
      Math.floor(thresholdTokens * COMPACTION_TARGET_SHARE_OF_THRESHOLD)
    ),
    minGrowthTokens: Math.floor(usableTokens * COMPACTION_MIN_GROWTH_RATIO),
    summaryAllowanceTokens: Math.min(
      COMPACTION_SUMMARY_ALLOWANCE_MAX_TOKENS,
      Math.floor(usableTokens * COMPACTION_SUMMARY_ALLOWANCE_RATIO)
    ),
  }
}

/**
 * Whether a request of `tokens` should compact. After a compaction left the
 * request at `compactedTokens`, the next one waits for meaningful growth unless
 * the request no longer fits the usable window at all.
 */
export function shouldCompactAtTokens(budget: CompactionBudget, tokens: number, compactedTokens?: number): boolean {
  if (tokens <= budget.thresholdTokens) return false
  if (compactedTokens === undefined || tokens > budget.usableTokens) return true
  return tokens - compactedTokens >= budget.minGrowthTokens
}

/** Verbatim tail kept by a compaction that leaves `fixedTokens` (system prompt, tool definitions) in place. */
export function getRetainedTailTokens(budget: CompactionBudget, fixedTokens: number): number {
  return Math.max(1, budget.targetTokens - fixedTokens - budget.summaryAllowanceTokens)
}

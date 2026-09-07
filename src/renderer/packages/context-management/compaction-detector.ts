import type { Settings } from '@shared/types'
import { getModelContextWindowSync } from '../model-registry'

const OUTPUT_RESERVE_TOKENS = 32_000
const DEFAULT_COMPACTION_THRESHOLD = 0.6
/**
 * Assumed context window for models the registry does not know (custom /
 * self-hosted). Without a fallback these models never trigger compaction at
 * all and grow until the provider rejects the request. 128k is the common
 * floor for current models; genuinely smaller models are no worse off than
 * before (compaction previously never fired for them either).
 */
const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000

export interface OverflowCheckOptions {
  tokens: number
  modelId: string
  settings?: Partial<Pick<Settings, 'compactionThreshold'>>
  /**
   * Override context window value. If provided, this takes precedence over
   * auto-detected value from the model registry (models.dev snapshot/cache).
   * Use this when provider returns a specific contextWindow for the model.
   */
  contextWindow?: number
}

export interface OverflowCheckResult {
  isOverflow: boolean
  contextWindow: number | null
  thresholdTokens: number | null
  currentTokens: number
}

/**
 * Checks if context tokens exceed compaction threshold.
 * Formula: isOverflow = tokens > (contextWindow - OUTPUT_RESERVE) * threshold
 * Returns false for unknown models (cannot determine threshold).
 */
export function checkOverflow(options: OverflowCheckOptions): OverflowCheckResult {
  const { tokens, modelId, settings, contextWindow: providedContextWindow } = options

  if (tokens <= 0) {
    return { isOverflow: false, contextWindow: null, thresholdTokens: null, currentTokens: tokens }
  }

  // Use provided contextWindow (from provider settings) if available, otherwise fall back to
  // model registry, then to a conservative assumed window for unknown models.
  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId) ?? FALLBACK_CONTEXT_WINDOW_TOKENS

  const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
  if (availableWindow <= 0) {
    return { isOverflow: false, contextWindow, thresholdTokens: null, currentTokens: tokens }
  }

  const compactionThreshold = settings?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD
  const thresholdTokens = Math.floor(availableWindow * compactionThreshold)

  return {
    isOverflow: tokens > thresholdTokens,
    contextWindow,
    thresholdTokens,
    currentTokens: tokens,
  }
}

export function isOverflow(options: OverflowCheckOptions): boolean {
  return checkOverflow(options).isOverflow
}

export function getCompactionThresholdTokens(
  modelId: string,
  settings?: Partial<Pick<Settings, 'compactionThreshold'>>,
  providedContextWindow?: number
): number | null {
  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId) ?? FALLBACK_CONTEXT_WINDOW_TOKENS

  const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
  if (availableWindow <= 0) return null

  const compactionThreshold = settings?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD
  return Math.floor(availableWindow * compactionThreshold)
}

export { OUTPUT_RESERVE_TOKENS, DEFAULT_COMPACTION_THRESHOLD, FALLBACK_CONTEXT_WINDOW_TOKENS }

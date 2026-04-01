import type { Settings } from '@shared/types'
import { getModelContextWindowSync } from '../model-registry'

const OUTPUT_RESERVE_TOKENS = 32_000
const DEFAULT_COMPACTION_THRESHOLD = 0.6

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

  // Use provided contextWindow (from provider settings) if available, otherwise fall back to model registry
  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId)
  if (contextWindow === null) {
    return { isOverflow: false, contextWindow: null, thresholdTokens: null, currentTokens: tokens }
  }

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
  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId)
  if (contextWindow === null) return null

  const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
  if (availableWindow <= 0) return null

  const compactionThreshold = settings?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD
  return Math.floor(availableWindow * compactionThreshold)
}

export { OUTPUT_RESERVE_TOKENS, DEFAULT_COMPACTION_THRESHOLD }

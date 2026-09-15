import type { Settings } from '@shared/types'
import { getModelContextWindowSync } from '../model-registry'

import {
  OUTPUT_RESERVE_TOKENS,
  DEFAULT_COMPACTION_THRESHOLD,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  getCompactionThresholdForContextWindow,
  getAvailableCompactionWindowTokens,
} from '@chatbox/core/application/token-estimation/math'

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
 * Unknown models use the fallback context window.
 */
export function checkOverflow(options: OverflowCheckOptions): OverflowCheckResult {
  const { tokens, modelId, settings, contextWindow: providedContextWindow } = options

  if (tokens <= 0) {
    return { isOverflow: false, contextWindow: null, thresholdTokens: null, currentTokens: tokens }
  }

  // Use provided contextWindow (from provider settings) if available, otherwise fall back to
  // model registry, then to a conservative assumed window for unknown models.
  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId) ?? FALLBACK_CONTEXT_WINDOW_TOKENS

  if (getAvailableCompactionWindowTokens(contextWindow) <= 0) {
    return { isOverflow: false, contextWindow, thresholdTokens: null, currentTokens: tokens }
  }

  const thresholdTokens = getCompactionThresholdForContextWindow(contextWindow, settings?.compactionThreshold)

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

  if (getAvailableCompactionWindowTokens(contextWindow) <= 0) return null

  return getCompactionThresholdForContextWindow(contextWindow, settings?.compactionThreshold)
}

export { OUTPUT_RESERVE_TOKENS, DEFAULT_COMPACTION_THRESHOLD, FALLBACK_CONTEXT_WINDOW_TOKENS }

import type { Settings } from '@shared/types'
import { getModelContextWindowSync } from '../model-registry'

import {
  type CompactionBudget,
  OUTPUT_RESERVE_TOKENS,
  DEFAULT_COMPACTION_THRESHOLD,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  getCompactionBudget,
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
  /** The reply limit the request runs with; sizes the output reservation. */
  maxOutputTokens?: number
}

export interface OverflowCheckResult {
  isOverflow: boolean
  contextWindow: number | null
  thresholdTokens: number | null
  currentTokens: number
}

/**
 * Checks if context tokens exceed compaction threshold.
 * Formula: isOverflow = tokens > (contextWindow - outputReserve) * threshold
 * Unknown models use the fallback context window.
 */
export function checkOverflow(options: OverflowCheckOptions): OverflowCheckResult {
  const { tokens, modelId, settings, contextWindow: providedContextWindow } = options

  if (tokens <= 0) {
    return { isOverflow: false, contextWindow: null, thresholdTokens: null, currentTokens: tokens }
  }

  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId) ?? FALLBACK_CONTEXT_WINDOW_TOKENS
  const budget = getCompactionBudget(contextWindow, {
    compactionThreshold: settings?.compactionThreshold,
    maxOutputTokens: options.maxOutputTokens,
  })

  if (!budget) {
    return { isOverflow: false, contextWindow, thresholdTokens: null, currentTokens: tokens }
  }

  const { thresholdTokens } = budget

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

export function resolveCompactionBudget(
  modelId: string,
  settings?: Partial<Pick<Settings, 'compactionThreshold'>>,
  providedContextWindow?: number,
  maxOutputTokens?: number
): CompactionBudget | null {
  const contextWindow = providedContextWindow ?? getModelContextWindowSync(modelId) ?? FALLBACK_CONTEXT_WINDOW_TOKENS
  return getCompactionBudget(contextWindow, { compactionThreshold: settings?.compactionThreshold, maxOutputTokens })
}

export function getCompactionThresholdTokens(
  modelId: string,
  settings?: Partial<Pick<Settings, 'compactionThreshold'>>,
  providedContextWindow?: number,
  maxOutputTokens?: number
): number | null {
  return resolveCompactionBudget(modelId, settings, providedContextWindow, maxOutputTokens)?.thresholdTokens ?? null
}

export { OUTPUT_RESERVE_TOKENS, DEFAULT_COMPACTION_THRESHOLD, FALLBACK_CONTEXT_WINDOW_TOKENS }

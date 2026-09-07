import type { ToolCleanupMode } from '@shared/context'
import type { Message, Settings } from '@shared/types'
import { sumCachedTokensFromMessages } from '../token'
import { getCompactionThresholdTokens } from './compaction-detector'

/**
 * Tool-result stubbing activates at this fraction of the compaction threshold.
 * Below it the full history (calls + results) is sent untouched; at the
 * compaction threshold itself (1.0) summarization takes over.
 */
export const TOOL_RESULT_STUB_PRESSURE_RATIO = 0.8

export interface AssessContextPressureOptions {
  /** Context selection the send path will use, at full fidelity (no cleanup applied). */
  contextMessages: Message[]
  providerId?: string
  modelId?: string
  /** Explicit per-model context window from provider settings, when configured. */
  contextWindow?: number
  compactionThreshold?: Settings['compactionThreshold']
  sandboxMode?: boolean
}

export interface ContextPressureAssessment {
  /** Estimated tokens of the full-fidelity context (text caches + tool-call weight). */
  contextTokens: number
  /** Compaction threshold for this model, or null when no model is known. */
  thresholdTokens: number | null
  /** The tool-cleanup mode the send path should use under this pressure. */
  toolCleanupMode: ToolCleanupMode
}

/**
 * Decide how much tool-history relief the next request needs.
 *
 * The estimate intentionally measures the UN-relieved context: relief and
 * compaction triggers must be driven by how big the history really is, not by
 * how small the previous mitigation made it (a self-referential measure would
 * oscillate). Below the ratio nothing is cleaned — old tool calls and results
 * ride along untouched; above it, results older than the recent rounds are
 * stubbed while the calls stay.
 */
export function assessContextPressure(options: AssessContextPressureOptions): ContextPressureAssessment {
  const { contextMessages, providerId, modelId, contextWindow, compactionThreshold, sandboxMode = false } = options

  const tokenModel = providerId && modelId ? { provider: providerId, modelId } : undefined
  const contextTokens = sumCachedTokensFromMessages(contextMessages, tokenModel, sandboxMode)

  const thresholdTokens = modelId ? getCompactionThresholdTokens(modelId, { compactionThreshold }, contextWindow) : null

  const stubActive =
    thresholdTokens !== null && contextTokens >= Math.floor(thresholdTokens * TOOL_RESULT_STUB_PRESSURE_RATIO)

  return {
    contextTokens,
    thresholdTokens,
    toolCleanupMode: stubActive ? 'stub-old-results' : 'none',
  }
}

/** Resolve a model's configured context window from provider settings, if any. */
export function getConfiguredContextWindow(
  settings: Pick<Settings, 'providers'>,
  providerId: string | undefined,
  modelId: string | undefined
): number | undefined {
  if (!providerId || !modelId) return undefined
  return settings.providers?.[providerId]?.models?.find((model) => model.modelId === modelId)?.contextWindow
}

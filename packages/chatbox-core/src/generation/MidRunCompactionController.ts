import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import {
  collectToolCallIds,
  estimateModelMessagesTokens,
  findKeptContentPartStartIndex,
  findKeptModelMessageStartIndex,
  firstToolCallIdInMessages,
  resolveKeptModelMessageStartIndex,
  retainTokensForThreshold,
  rewriteModelMessagesWithSummary,
} from './mid-run-compaction'

export interface MidRunCompactionResult {
  compacted: boolean
  summary?: string
  boundaryMessageId?: string
}

export interface MidRunCompactionOptions {
  /** Null disables this run's automatic compaction. */
  thresholdTokens: number | null
  signal: AbortSignal
  getContentParts(): MessageContentParts
  /** Returns the durable prefix id, or undefined when no split was committed. */
  splitPrefix(prefix: MessageContentParts, tail: MessageContentParts): Promise<string | undefined>
  getBoundaryMessageId(): string | undefined
  compact(boundaryMessageId: string): Promise<MidRunCompactionResult>
  onFailure?(error: unknown): void
}

type Rewrite = { summary: string; keepToolCallId: string }

/**
 * Owns the whole per-run policy: reuse -> measure -> plan -> split -> summarize
 * -> verify coverage -> advance. The host supplies persistence, not policy.
 * A previous successful rewrite never bypasses the next pressure check.
 */
export class MidRunCompactionController {
  private rewrite: Rewrite | undefined
  private failed = false

  constructor(private readonly options: MidRunCompactionOptions) {}

  async prepareStep(source: ModelMessage[], stepNumber: number): Promise<ModelMessage[]> {
    let effective = source
    let previousStart = -1
    if (this.rewrite) {
      previousStart = resolveKeptModelMessageStartIndex(source, this.rewrite.keepToolCallId)
      if (previousStart < 0) {
        // Never apply an array index from a previous image/steering projection.
        this.failed = true
        this.rewrite = undefined
        return source
      }
      effective = rewriteModelMessagesWithSummary(source, this.rewrite.summary, previousStart)
    }

    const { thresholdTokens, signal } = this.options
    if (
      this.failed ||
      signal.aborted ||
      stepNumber <= 0 ||
      thresholdTokens === null ||
      thresholdTokens <= 0 ||
      estimateModelMessagesTokens(effective) <= thresholdTokens
    )
      return effective

    // Plan against the EFFECTIVE window, then resolve the stable boundary in
    // the SDK's original transcript. This also prevents a later compact from
    // moving the retained boundary backwards into an already-summarized prefix.
    const effectiveStart = findKeptModelMessageStartIndex(effective, retainTokensForThreshold(thresholdTokens))
    if (effectiveStart <= 0) return effective
    const keepToolCallId = firstToolCallIdInMessages(effective.slice(effectiveStart))
    if (!keepToolCallId) return effective
    const keepStart = resolveKeptModelMessageStartIndex(source, keepToolCallId)
    if (keepStart <= Math.max(0, previousStart)) return effective

    const parts = this.options.getContentParts()
    const keptIds = collectToolCallIds(source.slice(keepStart))
    const dropsGeneratingCalls = parts.some((part) => part.type === 'tool-call' && !keptIds.has(part.toolCallId))
    let prefixMessageId: string | undefined

    try {
      if (dropsGeneratingCalls) {
        const partStart = findKeptContentPartStartIndex(parts, keptIds)
        if (partStart <= 0 || partStart >= parts.length) return effective
        prefixMessageId = await this.options.splitPrefix(parts.slice(0, partStart), parts.slice(partStart))
        if (!prefixMessageId) return effective
      }
      if (signal.aborted) return effective
      // A retained historical tool can lie inside an unsplit stored message.
      // Only advance across a complete durable message boundary.
      if (!prefixMessageId && !parts.some((part) => part.type === 'tool-call' && part.toolCallId === keepToolCallId))
        return effective
      const boundaryMessageId = prefixMessageId ?? this.options.getBoundaryMessageId()
      if (!boundaryMessageId) return effective
      const result = await this.options.compact(boundaryMessageId)
      if (signal.aborted || !result.compacted || !result.summary || result.boundaryMessageId !== boundaryMessageId) {
        this.failed = true
        return effective
      }
      this.rewrite = { summary: result.summary, keepToolCallId }
      return rewriteModelMessagesWithSummary(source, result.summary, keepStart)
    } catch (error) {
      // Keep the LAST successful rewrite when a later compact fails; falling
      // back to the raw SDK transcript would resurrect every discarded prefix.
      this.failed = true
      try {
        this.options.onFailure?.(error)
      } catch {
        /* diagnostics cannot change context */
      }
      return effective
    }
  }
}

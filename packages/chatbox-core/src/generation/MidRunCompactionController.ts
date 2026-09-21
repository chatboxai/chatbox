import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import type { CompactionServiceResult, GenerationCompactionRequest } from '../application/context/compaction-types'
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

export interface MidRunCompactionOptions {
  /** Null disables this run's automatic compaction. */
  thresholdTokens: number | null
  signal: AbortSignal
  getContentParts(): MessageContentParts
  /** True only when both the prefix and continuation are durable. */
  splitPrefix(prefix: MessageContentParts, tail: MessageContentParts): Promise<boolean>
  getTargetMessageId(): string
  compact(request: GenerationCompactionRequest): Promise<CompactionServiceResult>
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

    try {
      if (dropsGeneratingCalls) {
        const partStart = findKeptContentPartStartIndex(parts, keptIds)
        if (partStart <= 0 || partStart >= parts.length) return effective
        if (!(await this.options.splitPrefix(parts.slice(0, partStart), parts.slice(partStart)))) return effective
      }
      if (signal.aborted) return effective
      // A retained historical tool can lie inside an unsplit stored message.
      // Only advance across a complete durable message boundary.
      if (!parts.some((part) => part.type === 'tool-call' && part.toolCallId === keepToolCallId)) return effective
      const request: GenerationCompactionRequest = {
        kind: 'generation',
        targetMessageId: this.options.getTargetMessageId(),
        retainedToolCallId: keepToolCallId,
      }
      const result = await this.options.compact(request)
      if (signal.aborted || result.status === 'cancelled') return effective
      if (result.status === 'skipped') {
        // Busy work can finish before a later step; a changed path invalidates this run's plan.
        if (result.reason === 'stale_path') this.failed = true
        return effective
      }
      if (result.status === 'failed') {
        this.failed = true
        this.options.onFailure?.(result.failure)
        return effective
      }
      if (
        result.coverage.kind !== 'generation' ||
        result.coverage.targetMessageId !== request.targetMessageId ||
        result.coverage.retainedToolCallId !== request.retainedToolCallId
      ) {
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

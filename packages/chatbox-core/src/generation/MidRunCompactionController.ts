import { type AttachmentPolicy, describeCompactedAttachments } from '@shared/context/attachments'
import type { MessageContentParts } from '@shared/types'
import type { ModelMessage } from 'ai'
import type { CompactionServiceResult, GenerationCompactionRequest } from '../application/context/compaction-types'
import {
  type CompactionBudget,
  getRetainedTailTokens,
  shouldCompactAtTokens,
} from '../application/token-estimation/math'
import {
  collectToolCallIds,
  estimateModelMessageTokens,
  estimateModelMessagesTokens,
  findKeptContentPartStartIndex,
  findKeptModelMessageStartIndex,
  firstToolCallIdInMessages,
  resolveKeptModelMessageStartIndex,
  rewriteModelMessagesWithSummary,
} from './mid-run-compaction'

export interface MidRunCompactionOptions {
  /** Null disables this run's automatic compaction. */
  budget: CompactionBudget | null
  /** Counts one request message with the request's tokenizer. */
  countMessageTokens?(message: ModelMessage): number
  /** Request tokens sent outside the messages, such as tool definitions. Read once per run. */
  getRequestOverheadTokens?(): Promise<number>
  /** App language code for the summary handoff wording. */
  language?: string
  /** How the request presents attachments; the summary references covered ones the same way. */
  attachmentPolicy?: AttachmentPolicy
  signal: AbortSignal
  getContentParts(): MessageContentParts
  /** True only when both the prefix and continuation are durable. */
  splitPrefix(prefix: MessageContentParts, tail: MessageContentParts): Promise<boolean>
  getTargetMessageId(): string
  compact(request: GenerationCompactionRequest): Promise<CompactionServiceResult>
  onFailure?(error: unknown): void
  /** A compaction left the request above the threshold: fixed content dominates the window. */
  onInsufficientHeadroom?(info: { tokens: number; thresholdTokens: number }): void
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
  /** Request size the last compaction left; the next one waits for growth past it. */
  private compactedTokens: number | undefined
  private requestOverhead: Promise<number> | undefined
  private readonly countMessage: (message: ModelMessage) => number

  constructor(private readonly options: MidRunCompactionOptions) {
    this.countMessage = options.countMessageTokens ?? ((message) => estimateModelMessageTokens(message))
  }

  private readRequestOverhead(): Promise<number> {
    this.requestOverhead ??= (this.options.getRequestOverheadTokens?.() ?? Promise.resolve(0)).catch(() => 0)
    return this.requestOverhead
  }

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
      effective = rewriteModelMessagesWithSummary(source, this.rewrite.summary, previousStart, this.options.language)
    }

    const { budget, signal } = this.options
    if (this.failed || signal.aborted || stepNumber <= 0 || !budget) return effective
    const overhead = await this.readRequestOverhead()
    const tokens = estimateModelMessagesTokens(effective, this.countMessage) + overhead
    if (signal.aborted || !shouldCompactAtTokens(budget, tokens, this.compactedTokens)) return effective

    // Plan against the EFFECTIVE window, then resolve the stable boundary in
    // the SDK's original transcript. This also prevents a later compact from
    // moving the retained boundary backwards into an already-summarized prefix.
    const fixedTokens =
      overhead +
      estimateModelMessagesTokens(
        effective.filter((message) => message.role === 'system'),
        this.countMessage
      )
    const effectiveStart = findKeptModelMessageStartIndex(
      effective,
      getRetainedTailTokens(budget, fixedTokens),
      this.countMessage
    )
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
      // Covered attachments leave the request with their messages; the summary keeps their paths.
      const summary =
        result.summary + describeCompactedAttachments(result.attachments ?? {}, this.options.attachmentPolicy)
      this.rewrite = { summary, keepToolCallId }
      const rewritten = rewriteModelMessagesWithSummary(source, summary, keepStart, this.options.language)
      this.compactedTokens = estimateModelMessagesTokens(rewritten, this.countMessage) + overhead
      if (this.compactedTokens > budget.thresholdTokens) {
        this.options.onInsufficientHeadroom?.({
          tokens: this.compactedTokens,
          thresholdTokens: budget.thresholdTokens,
        })
      }
      return rewritten
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

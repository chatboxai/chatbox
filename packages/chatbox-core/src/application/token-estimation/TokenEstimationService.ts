import { planMessageAttachments } from '@shared/context/attachments'
import {
  SESSION_TOKEN_CACHE_VERSION,
  SESSION_TOKEN_PAGE_MESSAGES,
  type SessionTokenCacheResult,
} from '../../ports/session-token-cache'
import { injectAttachments, selectContextMessages } from '@shared/context'
import { estimateMessageToolCallTokens } from '@shared/context/tool-tokens'
import { getRegistryModelMeta, getUnambiguousRegistryModelContextWindow } from '@shared/model-registry'
import { analyzeAttachmentTokens, estimateImageTokens } from '@shared/token-estimation/attachments'
import {
  estimateTokensForTokenizerType,
  getTokenizerType,
  type TokenizerType,
} from '@shared/token-estimation/tokenizer'
import { getMessageText } from '@shared/utils/message'
import type { BlobStoragePort } from '../../ports'
import type { SessionEventBus } from '../session/session-events'
import type { SessionTokenPlan, SessionTokenRepositoryPort } from '../../ports/session-token-source'
import type {
  SessionTextTokenRepositoryPort,
  SessionTextTokenResult,
  SessionTextTokenRead,
} from '../../ports/session-text-tokens'
import type { Message, CompactionPoint, Settings } from '../../types'

import {
  estimateDraftTokensImmediately,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  getCompactionThresholdForContextWindow,
  LONG_DRAFT_TOKENIZATION_THRESHOLD,
} from './math'

export {
  DEFAULT_COMPACTION_THRESHOLD,
  estimateDraftTokensImmediately,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  LONG_DRAFT_TOKENIZATION_THRESHOLD,
  OUTPUT_RESERVE_TOKENS,
} from './math'

export interface TokenEstimationModel {
  provider: string
  modelId: string
  contextWindow?: number
}

export interface TokenBreakdown {
  text: number
  attachments: number
  toolCalls: number
}

export interface PortableTokenEstimationResult {
  /** An unreadable attachment makes the estimate incomplete and retryable. */
  missingAttachments?: { currentInput: boolean; context: boolean }
  currentInputTokens: number
  contextTokens: number
  totalTokens: number
  contextMessageCount: number
  canManualCompact: boolean
  breakdown: {
    currentInput: TokenBreakdown
    context: TokenBreakdown
  }
  approximation: {
    currentInput: boolean
    context: boolean
  }
}

export interface TokenEstimationRequest {
  sessionId?: string | null
  modelSupportToolUseForFile?: boolean
  sandboxMode?: boolean
  /** Resolved from lightweight history facts after the independent job starts. */
  resolveInstructions?: (plan: SessionTokenPlan | null) => Promise<string>
  constructedMessage?: Message
  model?: TokenEstimationModel
  maxContextMessageCount?: number
  /** Host instructions appended to the system prompt, outside the conversation history. */
  additionalInstructions?: string
}

function emptyBreakdown(): TokenBreakdown {
  return { text: 0, attachments: 0, toolCalls: 0 }
}

function totalBreakdown(value: TokenBreakdown): number {
  return value.text + value.attachments + value.toolCalls
}

function estimateMessageImmediately(message: Message, tokenizerType: TokenizerType): TokenBreakdown {
  const text = getMessageText(message, true, true)
  return {
    text: message.tokenCountMap?.[tokenizerType] ?? estimateDraftTokensImmediately(text, tokenizerType),
    attachments: analyzeAttachmentTokens(message, tokenizerType).tokens,
    toolCalls: estimateMessageToolCallTokens(message),
  }
}

function mergeBreakdowns(messages: Message[], tokenizerType: TokenizerType): TokenBreakdown {
  const result = emptyBreakdown()
  for (const message of messages) {
    const next = estimateMessageImmediately(message, tokenizerType)
    result.text += next.text
    result.attachments += next.attachments
    result.toolCalls += next.toolCalls
  }
  return result
}

function mergeExactBreakdowns(breakdowns: readonly TokenBreakdown[]): TokenBreakdown {
  const result = emptyBreakdown()
  for (const breakdown of breakdowns) {
    result.text += breakdown.text
    result.attachments += breakdown.attachments
    result.toolCalls += breakdown.toolCalls
  }
  return result
}

interface HydratedBreakdown {
  hasMissingAttachments?: boolean
  breakdown: TokenBreakdown
  approximate: boolean
}

function estimateBoundedText(text: string, tokenizerType: TokenizerType): { approximate: boolean; tokens: number } {
  if (text.length === 0) return { approximate: false, tokens: 0 }
  return text.length >= LONG_DRAFT_TOKENIZATION_THRESHOLD
    ? { approximate: true, tokens: estimateDraftTokensImmediately(text, tokenizerType) }
    : { approximate: false, tokens: estimateTokensForTokenizerType(text, tokenizerType) }
}

function estimateBoundedMessagesText(messages: Message[], tokenizerType: TokenizerType) {
  let tokens = 0
  let approximate = false
  const texts: string[] = []
  for (const message of messages) {
    const text = getMessageText(message, true, true)
    const estimate = estimateBoundedText(text, tokenizerType)
    texts.push(text)
    tokens += estimate.tokens
    approximate ||= estimate.approximate
  }
  return { approximate, texts, tokens }
}

function hydratedBreakdown(
  original: Message[],
  withAttachments: Message[],
  tokenizerType: TokenizerType,
  cachedText?: { tokens: number; approximate?: boolean }
): HydratedBreakdown {
  const textWithoutAttachments = cachedText
    ? {
        texts: original.map((message) => getMessageText(message, true, true)),
        tokens: cachedText.tokens,
        approximate: cachedText.approximate === true,
      }
    : estimateBoundedMessagesText(original, tokenizerType)
  const imageTokens = original.reduce((total, message) => total + estimateImageTokens(message), 0)
  const hydratedTexts = withAttachments.map((message) => getMessageText(message, true, true))
  const textWithAttachments = textWithoutAttachments.texts.every((text, index) => text === hydratedTexts[index])
    ? textWithoutAttachments
    : estimateBoundedMessagesText(withAttachments, tokenizerType)
  return {
    breakdown: {
      text: textWithoutAttachments.tokens,
      attachments: imageTokens + Math.max(0, textWithAttachments.tokens - textWithoutAttachments.tokens),
      toolCalls: original.reduce((total, message) => total + estimateMessageToolCallTokens(message), 0),
    },
    approximate: imageTokens > 0 || textWithoutAttachments.approximate || textWithAttachments.approximate,
  }
}

export function selectTokenEstimationContext(
  context: { messages: readonly Message[]; compactionPoints?: CompactionPoint[] } | null | undefined,
  maxContextMessageCount?: number,
  constructedMessage?: Message
): Message[] {
  if (!context) return []
  const input =
    constructedMessage ?? ({ id: 'token-estimation-current-input', role: 'user', contentParts: [] } satisfies Message)
  return selectContextMessages([...context.messages, input], {
    compactionPoints: context.compactionPoints,
    maxContextMessageCount,
  }).filter((message) => message !== input)
}

export function resolveModelContextWindow(model: TokenEstimationModel | undefined): number | null {
  if (!model?.modelId) return null
  if (model.contextWindow && model.contextWindow > 0) return model.contextWindow
  const providerMatch = getRegistryModelMeta(model.provider, model.modelId)
  if (providerMatch?.contextWindow && providerMatch.contextWindow > 0) return providerMatch.contextWindow
  return getUnambiguousRegistryModelContextWindow(model.modelId) ?? null
}

export function getCompactionThresholdTokens(options: {
  model: TokenEstimationModel
  compactionThreshold?: Settings['compactionThreshold']
}): number {
  const contextWindow = resolveModelContextWindow(options.model) ?? FALLBACK_CONTEXT_WINDOW_TOKENS
  return getCompactionThresholdForContextWindow(contextWindow, options.compactionThreshold)
}

function assertEstimationActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Token estimation was cancelled')
  error.name = 'AbortError'
  throw signal.reason ?? error
}

interface HistoryAggregate {
  sessionId: string
  breakdown: TokenBreakdown
  approximate: boolean
  mutableMessageIds: string[]
}

const HISTORY_AGGREGATE_LIMIT = 16
const HISTORY_AGGREGATE_MUTABLE_LIMIT = 256

export class TokenEstimationService {
  private readonly historyAggregates = new Map<string, HistoryAggregate>()
  private historyEpoch = 0

  constructor(
    private readonly blobs: Pick<BlobStoragePort, 'get'>,
    private readonly repository?: SessionTokenRepositoryPort & SessionTextTokenRepositoryPort,
    private readonly events?: Pick<SessionEventBus, 'subscribe'>
  ) {
    events?.subscribe((event) => {
      if (event.type === 'session-list-reset') this.invalidateHistory()
      else if (event.type === 'session-will-delete' || event.type === 'session-deleted')
        this.invalidateHistory(event.ids)
      else if (event.type === 'session-created') this.invalidateHistory([event.session.id])
      else if (event.type === 'session-command-committed') this.invalidateHistory([event.delta.sessionId])
      else if (event.type === 'session-derived-data-patched') this.invalidateHistory([event.sessionId])
    })
  }

  private invalidateHistory(sessionIds?: readonly string[]): void {
    this.historyEpoch++
    for (const [key, value] of this.historyAggregates) {
      if (!sessionIds || sessionIds.includes(value.sessionId)) this.historyAggregates.delete(key)
    }
  }

  /** Synchronous work is restricted to the current draft and explicit instructions. */
  estimateImmediately(request: TokenEstimationRequest): PortableTokenEstimationResult {
    const type = getTokenizerType(request.model)
    const currentInput = request.constructedMessage
      ? estimateMessageImmediately(request.constructedMessage, type)
      : emptyBreakdown()
    const instructions = estimateBoundedText(request.additionalInstructions ?? '', type)
    const context = { ...emptyBreakdown(), text: instructions.tokens }
    const currentInputTokens = totalBreakdown(currentInput)
    const contextTokens = totalBreakdown(context)
    return {
      currentInputTokens,
      contextTokens,
      totalTokens: currentInputTokens + contextTokens,
      contextMessageCount: 0,
      canManualCompact: false,
      breakdown: { currentInput, context },
      approximation: {
        currentInput: Boolean(
          request.constructedMessage &&
            (getMessageText(request.constructedMessage, true, true).length >= LONG_DRAFT_TOKENIZATION_THRESHOLD ||
              estimateImageTokens(request.constructedMessage) > 0)
        ),
        context: Boolean(request.sessionId) || instructions.approximate,
      },
    }
  }

  async estimate(
    request: TokenEstimationRequest,
    options: {
      signal?: AbortSignal
      onProgress?: (result: PortableTokenEstimationResult, completed: number, total: number) => void
    } = {}
  ): Promise<PortableTokenEstimationResult> {
    const epoch = this.historyEpoch
    const type = getTokenizerType(request.model)
    const check = () => assertEstimationActive(options.signal)
    check()
    if (request.sessionId && !this.repository) throw new Error('Row token source is required for historical estimates')
    const plan = request.sessionId
      ? await this.repository!.createSessionTokenPlan({
          sessionId: request.sessionId,
          maxContextMessageCount: request.maxContextMessageCount,
        })
      : null
    check()
    const additional = request.resolveInstructions
      ? await request.resolveInstructions(plan)
      : (request.additionalInstructions ?? '')
    check()
    const input = await this.estimateDraftMessages(
      request.constructedMessage ? [request.constructedMessage] : [],
      type,
      request
    )
    check()
    const instructions = estimateBoundedText(additional, type)
    let history = emptyBreakdown()
    let approximate = false
    let stableHistory = emptyBreakdown()
    let stableApproximate = false
    const mutableMessageIds: string[] = []
    let missingAttachments = false
    let completed = 0
    const total = plan?.messageIds.length ?? 0
    const result = (pending: boolean): PortableTokenEstimationResult => {
      const currentInputTokens = totalBreakdown(input.breakdown)
      const context = { ...history, text: history.text + instructions.tokens }
      const contextTokens = totalBreakdown(context)
      return {
        currentInputTokens,
        contextTokens,
        totalTokens: currentInputTokens + contextTokens,
        contextMessageCount: total,
        canManualCompact: plan?.canManualCompact ?? false,
        missingAttachments: { currentInput: input.hasMissingAttachments === true, context: missingAttachments },
        breakdown: { currentInput: input.breakdown, context: { ...context } },
        approximation: { currentInput: input.approximate, context: pending || approximate || instructions.approximate },
      }
    }
    const cacheKey = `${SESSION_TOKEN_CACHE_VERSION}:${type}:${Number(request.modelSupportToolUseForFile === true)}:${Number(request.sandboxMode === true)}`
    // A revision covers path, compaction and payload changes; host events also fence replacement/import.
    const aggregateKey =
      plan && this.events
        ? JSON.stringify([
            plan.sessionId,
            plan.revision,
            plan.thread.threadId,
            request.maxContextMessageCount !== undefined && request.maxContextMessageCount < Number.MAX_SAFE_INTEGER
              ? request.maxContextMessageCount
              : null,
            request.model?.provider,
            request.model?.modelId,
            cacheKey,
          ])
        : undefined
    const aggregate = aggregateKey ? this.historyAggregates.get(aggregateKey) : undefined
    let readPlan = plan
    if (aggregateKey && aggregate && epoch === this.historyEpoch) {
      this.historyAggregates.delete(aggregateKey)
      this.historyAggregates.set(aggregateKey, aggregate)
      history = { ...aggregate.breakdown }
      stableHistory = { ...aggregate.breakdown }
      approximate = stableApproximate = aggregate.approximate
      completed = total - aggregate.mutableMessageIds.length
      readPlan = { ...plan!, messageIds: aggregate.mutableMessageIds }
      if (!readPlan.messageIds.length) {
        options.onProgress?.(result(false), total, total)
        check()
        return result(false)
      }
    }
    let offset: number | null = readPlan?.messageIds.length ? 0 : null
    while (readPlan && offset !== null) {
      check()
      const page = await this.repository!.readSessionTokenPage({
        plan: readPlan,
        offset,
        limit: SESSION_TOKEN_PAGE_MESSAGES,
        cacheKey,
      })
      check()
      const cacheResults: SessionTokenCacheResult[] = []
      const textResults: SessionTextTokenResult[] = []
      for (const entry of page.entries) {
        if (!entry.value) continue
        history = mergeExactBreakdowns([history, entry.value])
        stableHistory = mergeExactBreakdowns([stableHistory, entry.value])
        stableApproximate ||= entry.value.approximate
        approximate ||= entry.value.approximate
        completed++
      }
      let yieldedAt = Date.now()
      for (const message of page.messages) {
        check()
        const estimate = await this.estimateHistoricalMessage(message, type, page.textTokens, request)
        check()
        history = mergeExactBreakdowns([history, estimate.breakdown])
        approximate ||= estimate.approximate
        missingAttachments ||= estimate.hasMissingAttachments === true
        completed++
        const identity = page.entries.find((entry) => entry.messageId === message.id)
        if (!identity) throw new Error('Token payload identity is missing')
        const externalContent = planMessageAttachments(message, request).some(
          (attachment) => attachment.kind === 'content'
        )
        if (!externalContent && !estimate.hasMissingAttachments) {
          stableHistory = mergeExactBreakdowns([stableHistory, estimate.breakdown])
          stableApproximate ||= estimate.approximate
          cacheResults.push({ identity, cacheKey, value: { ...estimate.breakdown, approximate: estimate.approximate } })
        } else mutableMessageIds.push(message.id)
        const source = page.textTokens?.sources[message.id]
        if (
          source &&
          !page.textTokens?.results.some(
            (entry) => entry.source.payloadId === source.payloadId && entry.value.tokenizerType === type
          )
        ) {
          textResults.push({
            source,
            value: {
              tokenizerType: type,
              sourceDigest: source.textDigest,
              tokens: estimate.breakdown.text,
              calculatedAt: Date.now(),
              approximate: source.text.length >= LONG_DRAFT_TOKENIZATION_THRESHOLD,
            },
          })
        }
        if (Date.now() - yieldedAt >= 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          yieldedAt = Date.now()
        }
      }
      check()
      if (cacheResults.length)
        await this.repository!.acceptSessionTokenCacheResults(readPlan.sessionId, cacheResults).catch(() => undefined)
      if (textResults.length)
        await this.repository!.acceptSessionTextTokenResults(readPlan.sessionId, textResults).catch(() => undefined)
      check()
      options.onProgress?.(result(page.nextOffset !== null), completed, total)
      offset = page.nextOffset
      if (offset !== null) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    check()
    if (
      aggregateKey &&
      plan &&
      epoch === this.historyEpoch &&
      mutableMessageIds.length <= HISTORY_AGGREGATE_MUTABLE_LIMIT &&
      (mutableMessageIds.length < total || total === 0)
    ) {
      this.historyAggregates.delete(aggregateKey)
      this.historyAggregates.set(aggregateKey, {
        sessionId: plan.sessionId,
        breakdown: { ...stableHistory },
        approximate: stableApproximate,
        mutableMessageIds,
      })
      while (this.historyAggregates.size > HISTORY_AGGREGATE_LIMIT)
        this.historyAggregates.delete(this.historyAggregates.keys().next().value!)
    }
    return result(false)
  }

  estimateMessagesTokens(messages: Message[], model?: TokenEstimationModel): number {
    return totalBreakdown(mergeBreakdowns(messages, getTokenizerType(model)))
  }

  private async estimateDraftMessages(
    messages: Message[],
    type: TokenizerType,
    request: Pick<TokenEstimationRequest, 'modelSupportToolUseForFile' | 'sandboxMode'>,
    text?: { tokens: number; approximate?: boolean }
  ): Promise<HydratedBreakdown> {
    if (!messages.length) return { breakdown: emptyBreakdown(), approximate: false }
    let missing = false
    const hydrated = await injectAttachments(
      messages,
      { read: (key) => this.blobs.get(key) },
      request.modelSupportToolUseForFile === true,
      request.sandboxMode === true,
      () => {
        missing = true
      }
    )
    const estimate = hydratedBreakdown(messages, hydrated, type, text)
    return { ...estimate, hasMissingAttachments: missing, approximate: estimate.approximate || missing }
  }

  private estimateHistoricalMessage(
    message: Message,
    type: TokenizerType,
    tokens: SessionTextTokenRead | undefined,
    request: TokenEstimationRequest
  ): Promise<HydratedBreakdown> {
    const source = tokens?.sources[message.id]
    const text = source
      ? tokens?.results.find(
          (entry) => entry.source.payloadId === source.payloadId && entry.value.tokenizerType === type
        )?.value
      : undefined
    return this.estimateDraftMessages([message], type, request, text)
  }
}

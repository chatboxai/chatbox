import { injectAttachments, selectContextMessages } from '@shared/context'
import { estimateMessageToolCallTokens } from '@shared/context/tool-tokens'
import { getRegistryModelMeta, getUnambiguousRegistryModelContextWindow } from '@shared/model-registry'
import {
  CJK_CHARACTER_PATTERN,
  estimateTokensForTokenizerType,
  getTokenizerType,
  type TokenizerType,
} from '@shared/token-estimation/tokenizer'
import { getMessageText } from '@shared/utils/message'
import type { SessionContextSource } from '../../ports/session-context-source'
import type { SessionTextTokenRepositoryPort, SessionTextTokenResult } from '../../ports/session-text-tokens'
import type { BlobStoragePort } from '../../ports'
import type { Message, Session, Settings } from '../../types'
import { findLastCompactionBoundaryMessage } from '../context/compaction-boundary'

export const LONG_DRAFT_TOKENIZATION_THRESHOLD = 4096
export const OUTPUT_RESERVE_TOKENS = 32_000
export const DEFAULT_COMPACTION_THRESHOLD = 0.6
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000
const RAW_TAIL_BUDGET_RATIO = 0.5
const QUICK_ESTIMATE_SAMPLE_SIZE = 512
const GOLDEN_RATIO_FRACTION = 0.6180339887498949
const WHITESPACE = /\s/
const MAX_HISTORY_CACHE_ENTRIES = 1_000
const IMAGE_TOKEN_ESTIMATE = 4_096

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
  contextSource?: SessionContextSource | null
  session?: Session | null
  constructedMessage?: Message
  model?: TokenEstimationModel
  maxContextMessageCount?: number
}

function emptyBreakdown(): TokenBreakdown {
  return { text: 0, attachments: 0, toolCalls: 0 }
}

function totalBreakdown(value: TokenBreakdown): number {
  return value.text + value.attachments + value.toolCalls
}

function attachmentCachedTokens(message: Message, tokenizerType: TokenizerType): number {
  let total = 0
  for (const attachment of [...(message.files ?? []), ...(message.links ?? [])]) {
    total += attachment.tokenCountMap?.[tokenizerType] ?? 0
  }
  return total
}

function imageTokenEstimate(message: Message): number {
  return (message.contentParts?.filter((part) => part.type === 'image').length ?? 0) * IMAGE_TOKEN_ESTIMATE
}

function estimateMessageImmediately(message: Message, tokenizerType: TokenizerType): TokenBreakdown {
  const text = getMessageText(message, true, true)
  return {
    text: message.tokenCountMap?.[tokenizerType] ?? estimateDraftTokensImmediately(text, tokenizerType),
    attachments: attachmentCachedTokens(message, tokenizerType) + imageTokenEstimate(message),
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
  breakdown: TokenBreakdown
  approximate: boolean
}

function estimateBoundedText(text: string, tokenizerType: TokenizerType): { approximate: boolean; tokens: number } {
  return text.length >= LONG_DRAFT_TOKENIZATION_THRESHOLD
    ? { approximate: true, tokens: estimateDraftTokensImmediately(text, tokenizerType) }
    : { approximate: false, tokens: estimateTokensForTokenizerType(text, tokenizerType) }
}

function estimateBoundedMessagesText(messages: Message[], tokenizerType: TokenizerType, useCached = false) {
  let tokens = 0
  let approximate = false
  const texts: string[] = []
  for (const message of messages) {
    const text = getMessageText(message, true, true)
    const cached = useCached ? message.tokenCountMap?.[tokenizerType] : undefined
    const estimate =
      cached === undefined
        ? estimateBoundedText(text, tokenizerType)
        : {
            tokens: cached,
            approximate: message.tokenCountApproximate?.[tokenizerType] === true,
          }
    texts.push(text)
    tokens += estimate.tokens
    approximate ||= estimate.approximate
  }
  return { approximate, texts, tokens }
}

function hydratedBreakdown(
  original: Message[],
  withAttachments: Message[],
  tokenizerType: TokenizerType
): HydratedBreakdown {
  const textWithoutAttachments = estimateBoundedMessagesText(original, tokenizerType, true)
  const imageTokens = original.reduce((total, message) => total + imageTokenEstimate(message), 0)
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

function messageContentFingerprint(message: Message): string | null {
  let serialized: string
  try {
    serialized = JSON.stringify({
      contentParts: message.contentParts,
      files: message.files,
      links: message.links,
      role: message.role,
      tokenCountMap: message.tokenCountMap,
      tokenCountApproximate: message.tokenCountApproximate,
    })
  } catch {
    return null
  }

  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${serialized.length}:${hash >>> 0}`
}

function canCompactSession(session: Pick<Session, 'messages' | 'compactionPoints'> | null | undefined): boolean {
  return Boolean(findLastCompactionBoundaryMessage(selectTokenEstimationContext(session)))
}

export function selectTokenEstimationContext(
  session: Pick<Session, 'messages' | 'compactionPoints'> | null | undefined,
  maxContextMessageCount?: number,
  constructedMessage?: Message
): Message[] {
  if (!session) return []
  const currentInput =
    constructedMessage ?? ({ id: 'token-estimation-current-input', role: 'user', contentParts: [] } satisfies Message)
  return selectContextMessages([...session.messages, currentInput], {
    compactionPoints: session.compactionPoints,
    maxContextMessageCount,
  }).filter((message) => message !== currentInput)
}

export function estimateDraftTokensImmediately(text: string, tokenizerType: TokenizerType): number {
  if (text.length < LONG_DRAFT_TOKENIZATION_THRESHOLD) {
    return estimateTokensForTokenizerType(text, tokenizerType)
  }

  const stride = text.length / QUICK_ESTIMATE_SAMPLE_SIZE
  let sampledTokens = 0
  let jitter = 0
  for (let sample = 0; sample < QUICK_ESTIMATE_SAMPLE_SIZE; sample += 1) {
    jitter = (jitter + GOLDEN_RATIO_FRACTION) % 1
    let index = Math.floor((sample + jitter) * stride)
    const unit = text.charCodeAt(index)
    if (unit >= 0xdc00 && unit <= 0xdfff && index > 0) index -= 1
    const codePoint = text.codePointAt(index) ?? 0
    const character = String.fromCodePoint(codePoint)
    const unitsPerCharacter = codePoint > 0xffff ? 2 : 1
    if (CJK_CHARACTER_PATTERN.test(character)) {
      sampledTokens += tokenizerType === 'deepseek' ? 0.6 / unitsPerCharacter : unitsPerCharacter === 2 ? 1.5 : 1
    } else if (WHITESPACE.test(character)) {
      if (tokenizerType === 'deepseek') {
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
  const availableWindow = Math.max(contextWindow - OUTPUT_RESERVE_TOKENS, Math.floor(contextWindow * 0.5))
  return Math.floor(availableWindow * (options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD))
}

export function getRawTailTokenBudget(options: {
  model: TokenEstimationModel
  compactionThreshold?: Settings['compactionThreshold']
}): number {
  return Math.floor(getCompactionThresholdTokens(options) * RAW_TAIL_BUDGET_RATIO)
}

function estimationContext(request: TokenEstimationRequest) {
  const source = request.contextSource
  return source ? { messages: source.candidateMessages, compactionPoints: source.compactionPoints } : request.session
}

function assertEstimationActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Token estimation was cancelled')
  error.name = 'AbortError'
  throw signal.reason ?? error
}

export class TokenEstimationService {
  private readonly immediateHistoricalByObject = new WeakMap<Message, Map<TokenizerType, TokenBreakdown>>()
  private readonly immediateHistoricalByIdentity = new Map<string, { fingerprint: string; value: TokenBreakdown }>()
  private readonly historicalByObject = new WeakMap<Message, Map<TokenizerType, Promise<HydratedBreakdown>>>()
  private readonly historicalByIdentity = new Map<string, { fingerprint: string; value: Promise<HydratedBreakdown> }>()

  constructor(
    private readonly blobs: Pick<BlobStoragePort, 'get'>,
    private readonly textTokenRepository?: SessionTextTokenRepositoryPort
  ) {}

  estimateImmediately(request: TokenEstimationRequest): PortableTokenEstimationResult {
    const tokenizerType = getTokenizerType(request.model)
    const contextMessages = selectTokenEstimationContext(
      estimationContext(request),
      request.maxContextMessageCount,
      request.constructedMessage
    )
    const currentInput = request.constructedMessage
      ? estimateMessageImmediately(request.constructedMessage, tokenizerType)
      : emptyBreakdown()
    const context = mergeExactBreakdowns(
      contextMessages.map((message) => this.estimateHistoricalMessageImmediately(message, tokenizerType))
    )
    const currentInputTokens = totalBreakdown(currentInput)
    const contextTokens = totalBreakdown(context)
    return {
      currentInputTokens,
      contextTokens,
      totalTokens: currentInputTokens + contextTokens,
      contextMessageCount: contextMessages.length,
      canManualCompact: canCompactSession(estimationContext(request)),
      breakdown: { currentInput, context },
      approximation: {
        currentInput: Boolean(
          request.constructedMessage &&
            (getMessageText(request.constructedMessage, true, true).length >= LONG_DRAFT_TOKENIZATION_THRESHOLD ||
              imageTokenEstimate(request.constructedMessage) > 0)
        ),
        context: contextMessages.length > 0,
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
    const tokenizerType = getTokenizerType(request.model)
    const contextMessages = selectTokenEstimationContext(
      estimationContext(request),
      request.maxContextMessageCount,
      request.constructedMessage
    )
    const canManualCompact = canCompactSession(estimationContext(request))
    const currentMessages = request.constructedMessage ? [request.constructedMessage] : []
    assertEstimationActive(options.signal)
    const currentInputEstimate = await this.estimateDraftMessages(currentMessages, tokenizerType)
    assertEstimationActive(options.signal)
    const contextEstimates: HydratedBreakdown[] = []
    const textResults: SessionTextTokenResult[] = []
    let progressiveContext = emptyBreakdown()
    let lastYieldAt = Date.now()
    for (let offset = 0; offset < contextMessages.length; offset += 16) {
      assertEstimationActive(options.signal)
      const batch = await Promise.all(
        contextMessages
          .slice(offset, offset + 16)
          .map((message) => this.estimateHistoricalMessage(message, tokenizerType))
      )
      contextEstimates.push(...batch)
      if (this.textTokenRepository && request.contextSource?.textTokens) {
        for (let index = 0; index < batch.length; index++) {
          const message = contextMessages[offset + index]
          const source = request.contextSource.textTokens.sources[message.id]
          if (!source || message.tokenCountMap?.[tokenizerType] !== undefined) continue
          if (source.text !== getMessageText(message, true, true)) continue
          textResults.push({
            source,
            value: {
              tokenizerType,
              sourceDigest: source.textDigest,
              tokens: batch[index].breakdown.text,
              calculatedAt: Date.now(),
              approximate: source.text.length >= LONG_DRAFT_TOKENIZATION_THRESHOLD,
            },
          })
        }
      }
      assertEstimationActive(options.signal)
      const context = mergeExactBreakdowns([progressiveContext, ...batch.map((estimate) => estimate.breakdown)])
      progressiveContext = context
      const currentInputTokens = totalBreakdown(currentInputEstimate.breakdown)
      const contextTokens = totalBreakdown(context)
      options.onProgress?.(
        {
          currentInputTokens,
          contextTokens,
          totalTokens: currentInputTokens + contextTokens,
          contextMessageCount: contextMessages.length,
          canManualCompact,
          breakdown: { currentInput: currentInputEstimate.breakdown, context },
          approximation: { currentInput: currentInputEstimate.approximate, context: true },
        },
        contextEstimates.length,
        contextMessages.length
      )
      if (offset + 16 < contextMessages.length && Date.now() - lastYieldAt >= 8) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        lastYieldAt = Date.now()
      }
    }
    assertEstimationActive(options.signal)
    if (textResults.length && request.contextSource && this.textTokenRepository) {
      // Numerical caches are source-bound and rebuildable; a failed cache write must not fail estimation.
      await this.textTokenRepository
        .acceptSessionTextTokenResults(request.contextSource.header.id, textResults)
        .catch(() => undefined)
    }
    const currentInput = currentInputEstimate.breakdown
    const contextBreakdowns = contextEstimates.map((estimate) => estimate.breakdown)
    const context = mergeExactBreakdowns(contextBreakdowns)
    const currentInputTokens = totalBreakdown(currentInput)
    const contextTokens = totalBreakdown(context)
    return {
      currentInputTokens,
      contextTokens,
      totalTokens: currentInputTokens + contextTokens,
      contextMessageCount: contextMessages.length,
      canManualCompact,
      breakdown: { currentInput, context },
      approximation: {
        currentInput: currentInputEstimate.approximate,
        context: contextEstimates.some((estimate) => estimate.approximate),
      },
    }
  }

  estimateMessagesTokens(messages: Message[], model?: TokenEstimationModel): number {
    return totalBreakdown(mergeBreakdowns(messages, getTokenizerType(model)))
  }

  async createMessagesTokenEstimator(
    messages: Message[],
    model?: TokenEstimationModel
  ): Promise<(messages: Message[]) => number> {
    const tokenizerType = getTokenizerType(model)
    const totals = new Map<Message, number>()
    await Promise.all(
      messages.map(async (message) => {
        totals.set(message, totalBreakdown((await this.estimateHistoricalMessage(message, tokenizerType)).breakdown))
      })
    )
    return (selected) => selected.reduce((total, message) => total + (totals.get(message) ?? 0), 0)
  }

  private hydrateMessagesWithAttachments(messages: Message[]): Promise<Message[]> {
    if (messages.length === 0) return Promise.resolve([])
    return injectAttachments(messages, { read: (storageKey) => this.blobs.get(storageKey) }, false, false)
  }

  private async estimateDraftMessages(messages: Message[], tokenizerType: TokenizerType): Promise<HydratedBreakdown> {
    if (messages.length === 0) return { breakdown: emptyBreakdown(), approximate: false }
    const hydrated = await this.hydrateMessagesWithAttachments(messages)
    return hydratedBreakdown(messages, hydrated, tokenizerType)
  }

  private estimateHistoricalMessageImmediately(message: Message, tokenizerType: TokenizerType): TokenBreakdown {
    const objectEntries = this.immediateHistoricalByObject.get(message)
    const objectEntry = objectEntries?.get(tokenizerType)
    if (objectEntry) return objectEntry

    const fingerprint = messageContentFingerprint(message)
    const identityKey = `${tokenizerType}:${message.id}`
    const identityEntry = fingerprint === null ? undefined : this.immediateHistoricalByIdentity.get(identityKey)
    const value =
      identityEntry?.fingerprint === fingerprint
        ? identityEntry.value
        : estimateMessageImmediately(message, tokenizerType)
    const entries = objectEntries ?? new Map()
    entries.set(tokenizerType, value)
    this.immediateHistoricalByObject.set(message, entries)
    if (fingerprint !== null && identityEntry?.fingerprint !== fingerprint) {
      this.immediateHistoricalByIdentity.delete(identityKey)
      this.immediateHistoricalByIdentity.set(identityKey, { fingerprint, value })
      while (this.immediateHistoricalByIdentity.size > MAX_HISTORY_CACHE_ENTRIES) {
        const oldestKey = this.immediateHistoricalByIdentity.keys().next().value
        if (oldestKey === undefined) break
        this.immediateHistoricalByIdentity.delete(oldestKey)
      }
    }
    return value
  }

  private estimateHistoricalMessage(message: Message, tokenizerType: TokenizerType): Promise<HydratedBreakdown> {
    const objectEntries = this.historicalByObject.get(message)
    const objectEntry = objectEntries?.get(tokenizerType)
    if (objectEntry) return objectEntry

    const fingerprint = messageContentFingerprint(message)
    const identityKey = `${tokenizerType}:${message.id}`
    const identityEntry = fingerprint === null ? undefined : this.historicalByIdentity.get(identityKey)
    if (identityEntry?.fingerprint === fingerprint) {
      const entries = objectEntries ?? new Map()
      entries.set(tokenizerType, identityEntry.value)
      this.historicalByObject.set(message, entries)
      return identityEntry.value
    }

    const value = this.estimateDraftMessages([message], tokenizerType)
    const entries = objectEntries ?? new Map()
    entries.set(tokenizerType, value)
    this.historicalByObject.set(message, entries)
    if (fingerprint !== null) {
      this.historicalByIdentity.delete(identityKey)
      this.historicalByIdentity.set(identityKey, { fingerprint, value })
      while (this.historicalByIdentity.size > MAX_HISTORY_CACHE_ENTRIES) {
        const oldestKey = this.historicalByIdentity.keys().next().value
        if (oldestKey === undefined) break
        this.historicalByIdentity.delete(oldestKey)
      }
    }
    void value.catch(() => {
      if (this.historicalByObject.get(message)?.get(tokenizerType) === value) {
        this.historicalByObject.get(message)?.delete(tokenizerType)
      }
      if (this.historicalByIdentity.get(identityKey)?.value === value) {
        this.historicalByIdentity.delete(identityKey)
      }
    })
    return value
  }
}

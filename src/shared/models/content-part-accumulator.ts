import type { ProviderMetadata } from 'ai'
import type { MessageContentParts, MessageReasoningPart, MessageTextPart } from '../types'
import { canCreateReplayPart, mergeProviderMetadata, pickPersistableProviderMetadata } from './provider-part-metadata'

/**
 * Text/reasoning aggregation shared by the streaming (`@chatbox/core`
 * stream-chunk-processor) and non-streaming (`AbstractAISDKModel.chat`)
 * paths, so both persist identical parts and replay metadata.
 */
export interface ContentPartAccumulator {
  readonly contentParts: MessageContentParts
  currentTextPart: MessageTextPart | undefined
  currentReasoningPart: MessageReasoningPart | undefined
  /**
   * Whitespace-only reasoning deltas seen before the current block has produced
   * a part. Signed Anthropic thinking must round-trip byte-for-byte, so leading
   * whitespace is buffered and prepended when the block materializes; it is
   * discarded when the block yields nothing (the spurious empty reasoning some
   * providers interleave with text).
   */
  pendingReasoningText: string
  /** Stamped on created parts when the caller tracks generation steps. */
  stepIndex?: number
}

export type TextChunk =
  | { type: 'text-delta'; text: string; providerMetadata?: ProviderMetadata }
  | { type: 'text-end'; providerMetadata?: ProviderMetadata }

export type ReasoningChunk =
  | { type: 'reasoning-start' | 'reasoning-end'; providerMetadata?: ProviderMetadata }
  | { type: 'reasoning-delta'; text: string; providerMetadata?: ProviderMetadata }

export function finalizeReasoningDuration(part: MessageReasoningPart | undefined): void {
  if (part?.startTime && !part.duration) {
    part.duration = Date.now() - part.startTime
  }
}

function withStepIndex<T extends MessageTextPart | MessageReasoningPart>(part: T, stepIndex: number | undefined): T {
  return stepIndex === undefined ? part : { ...part, stepIndex }
}

function startReasoningPart(acc: ContentPartAccumulator, text: string): MessageReasoningPart {
  const part = withStepIndex<MessageReasoningPart>({ type: 'reasoning', text, startTime: Date.now() }, acc.stepIndex)
  acc.currentTextPart = undefined
  acc.currentReasoningPart = part
  acc.contentParts.push(part)
  return part
}

/**
 * Applies a text chunk. Returns false for a `text-end` with no open text part,
 * which leaves the accumulator untouched.
 */
export function accumulateTextChunk(acc: ContentPartAccumulator, chunk: TextChunk): boolean {
  if (chunk.type === 'text-end' && !acc.currentTextPart) return false
  finalizeReasoningDuration(acc.currentReasoningPart)
  acc.currentReasoningPart = undefined
  acc.pendingReasoningText = ''
  const text = chunk.type === 'text-delta' ? chunk.text : ''
  let part = acc.currentTextPart
  if (part) {
    part.text += text
  } else {
    part = withStepIndex<MessageTextPart>({ type: 'text', text }, acc.stepIndex)
    acc.contentParts.push(part)
  }
  // Gemini rides its thought signature on text parts, sometimes in an empty trailing delta.
  const persistable = pickPersistableProviderMetadata(chunk.providerMetadata, ['google'])
  if (persistable) {
    part.providerMetadata = mergeProviderMetadata(part.providerMetadata, persistable)
  }
  // Signatures belong to a particular text block; keep signed block boundaries.
  acc.currentTextPart = chunk.type === 'text-end' && part.providerMetadata ? undefined : part
  return true
}

export function accumulateReasoningChunk(acc: ContentPartAccumulator, chunk: ReasoningChunk): void {
  const persistable = pickPersistableProviderMetadata(chunk.providerMetadata)
  switch (chunk.type) {
    case 'reasoning-start': {
      finalizeReasoningDuration(acc.currentReasoningPart)
      acc.currentReasoningPart = undefined
      acc.pendingReasoningText = ''
      // Anthropic delivers `redacted_thinking` payloads on the block-start chunk.
      // Metadata outside the persistable whitelist (e.g. Mistral usage data) or
      // unreplayable metadata (a Responses item id without encrypted content)
      // must not create a part — the block stays lazily created on its first
      // non-empty delta, so spurious empty reasoning blocks that some providers
      // interleave with text never split the current text part.
      if (canCreateReplayPart(persistable)) {
        startReasoningPart(acc, '').providerMetadata = persistable
      }
      return
    }
    case 'reasoning-delta': {
      if (acc.currentReasoningPart) {
        // Signed thinking must round-trip byte-for-byte: once the block has a
        // part, even whitespace-only deltas append verbatim.
        acc.currentReasoningPart.text += chunk.text
      } else if (chunk.text.trim() || canCreateReplayPart(persistable)) {
        // Anthropic signature_delta arrives as an empty-text delta carrying only
        // provider metadata; it must still create the reasoning part.
        startReasoningPart(acc, acc.pendingReasoningText + chunk.text)
        acc.pendingReasoningText = ''
      } else {
        acc.pendingReasoningText += chunk.text
      }
      break
    }
    case 'reasoning-end': {
      if (!acc.currentReasoningPart && canCreateReplayPart(persistable)) {
        startReasoningPart(acc, acc.pendingReasoningText)
      }
      acc.pendingReasoningText = ''
      break
    }
  }
  const part = acc.currentReasoningPart
  if (part && persistable) {
    part.providerMetadata = mergeProviderMetadata(part.providerMetadata, persistable)
  }
  if (chunk.type === 'reasoning-end') {
    // A block that ends with replay metadata but no visible text exists only
    // for protocol replay (redacted thinking, signed empty thinking block).
    if (part && !part.text.trim() && part.providerMetadata) {
      part.protocolOnly = true
    }
    finalizeReasoningDuration(part)
    acc.currentReasoningPart = undefined
  }
}

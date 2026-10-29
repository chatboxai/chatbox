import './tokenizer'
import { getSessionMessageTokenizationText } from '@chatbox/core/application/session'
import type { Message } from '@shared/types'

export { getTokenizationTextDigest } from '@chatbox/core/application/session'

import type { ExactDraftTokens } from './types'

export {
  estimateDraftTokensImmediately,
  LONG_DRAFT_TOKENIZATION_THRESHOLD,
  shouldTokenizeDraftOffMainThread,
} from '@chatbox/core/application/token-estimation/math'

/**
 * The one projection draft token counts are computed against — the worker
 * input, the immediate estimate, and the seeded exact count all use it, so
 * their texts stay comparable byte for byte.
 */
export function getDraftTokenizationText(message: Message): string {
  return getSessionMessageTokenizationText(message)
}

/**
 * Carry the worker's exact count on the outgoing message so the insert path
 * reads it from `tokenCountMap` instead of re-encoding the whole draft
 * synchronously at submit. Comparing the projections makes the handoff
 * self-verifying: a draft edited after its last worker result is left
 * unseeded and falls back to the ordinary estimate.
 */
export function seedExactDraftTokens(message: Message, exact: ExactDraftTokens | null): Message {
  if (!exact || getDraftTokenizationText(message) !== exact.text) return message
  return { ...message, tokenCountMap: { ...message.tokenCountMap, [exact.tokenizerType]: exact.tokens } }
}

import type { TokenizerType } from './types'

/**
 * Per-run budget for re-attempting an exact worker encode after a message's
 * persisted count fell back to the sampling estimate. Counted per failed
 * attempt: the initial task consumes one on failure, leaving one retry before
 * the entry stays approximate for the rest of the run. Each app launch starts
 * with a fresh budget, so a transient worker failure is re-exacted on the next
 * launch while a broken worker runtime cannot loop the queue forever.
 */
export const MAX_EXACT_TOKENIZATION_FALLBACKS = 2

const fallbackCounts = new Map<string, number>()

function registryKey(messageId: string, tokenizerType: TokenizerType, textDigest: string): string {
  return `${messageId}:${tokenizerType}:${textDigest}`
}

export function getExactTokenizationFallbackCount(
  messageId: string,
  tokenizerType: TokenizerType,
  textDigest: string
): number {
  return fallbackCounts.get(registryKey(messageId, tokenizerType, textDigest)) ?? 0
}

export function recordExactTokenizationFallback(
  messageId: string,
  tokenizerType: TokenizerType,
  textDigest: string
): void {
  const key = registryKey(messageId, tokenizerType, textDigest)
  fallbackCounts.set(key, (fallbackCounts.get(key) ?? 0) + 1)
}

export function clearExactTokenizationFallbacks(
  messageId: string,
  tokenizerType: TokenizerType,
  textDigest: string
): void {
  fallbackCounts.delete(registryKey(messageId, tokenizerType, textDigest))
}

export function canRetryExactTokenization(
  messageId: string,
  tokenizerType: TokenizerType,
  textDigest: string
): boolean {
  return getExactTokenizationFallbackCount(messageId, tokenizerType, textDigest) < MAX_EXACT_TOKENIZATION_FALLBACKS
}

/** Reset the registry (for testing only). */
export function _resetExactTokenizationFallbacks(): void {
  fallbackCounts.clear()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Read `prompt_tokens_details.cache_write_tokens`. Returns 0 when absent and
 * undefined when present but not a valid token count.
 */
export function readCacheWriteTokens(details: unknown): number | undefined {
  const written = isRecord(details) ? details.cache_write_tokens : undefined
  if (written == null) return 0
  return isTokenCount(written) ? written : undefined
}

/** Preserve compatible-provider cache counts before strict SDK response parsing. */
export function normalizeChatCompletionCacheUsage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.usage)) return false
  const usage = value.usage
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
  if (details.cached_tokens != null) return false
  const singular = isRecord(usage.prompt_token_details) ? usage.prompt_token_details : {}
  const cached =
    usage.prompt_cache_hit_tokens ?? usage.cached_tokens ?? usage.num_cached_tokens ?? singular.cached_tokens
  const written = readCacheWriteTokens(details)
  if (
    !isTokenCount(cached) ||
    !isTokenCount(usage.prompt_tokens) ||
    written === undefined ||
    cached + written > usage.prompt_tokens
  )
    return false
  usage.prompt_tokens_details = { ...details, cached_tokens: cached }
  return true
}

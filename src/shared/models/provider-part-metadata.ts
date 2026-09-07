import type { ProviderMetadata } from 'ai'

/**
 * Whitelist of provider metadata persisted on text/reasoning content parts.
 *
 * The rule is intentionally strict: only keys the app replays on follow-up
 * requests may be stored. Anthropic thinking signatures and redacted thinking
 * payloads are required to resume a tool-use turn after a pause (the Messages
 * API rejects modified or missing thinking blocks), so they must survive
 * persistence. Everything else — OpenAI Responses `itemId` /
 * `reasoningEncryptedContent`, citation payloads, etc. — is not on any replay
 * path and would only bloat session data (see "Session data must be compact").
 *
 * Adding a key here requires adding the matching replay logic in
 * `model-message-converter.ts` in the same change.
 */
const PERSISTABLE_PART_METADATA_KEYS: Record<string, readonly string[]> = {
  anthropic: ['signature', 'redactedData'],
}

/**
 * Filters stream-chunk provider metadata down to the persistable whitelist.
 * Returns `undefined` when nothing survives, so callers can skip creating a
 * content part for metadata the app never replays.
 */
export function pickPersistableProviderMetadata(metadata: ProviderMetadata | undefined): ProviderMetadata | undefined {
  if (!metadata) return undefined
  let picked: ProviderMetadata | undefined
  for (const [provider, keys] of Object.entries(PERSISTABLE_PART_METADATA_KEYS)) {
    const namespace = metadata[provider]
    if (!namespace || typeof namespace !== 'object') continue
    for (const key of keys) {
      const value = namespace[key]
      if (value === undefined) continue
      picked ??= {}
      picked[provider] = { ...picked[provider], [key]: value }
    }
  }
  return picked
}

/**
 * Merges incoming metadata into the metadata accumulated on a content part.
 * Provider namespaces are merged shallowly; later chunks win per key (e.g. an
 * Anthropic `signature_delta` arriving after a `reasoning-start`).
 */
export function mergeProviderMetadata(
  current: ProviderMetadata | undefined,
  incoming: ProviderMetadata | undefined
): ProviderMetadata | undefined {
  if (!incoming) return current
  if (!current) return incoming

  const merged: ProviderMetadata = { ...current }
  for (const [provider, metadata] of Object.entries(incoming)) {
    merged[provider] = {
      ...(current[provider] ?? {}),
      ...metadata,
    }
  }
  return merged
}

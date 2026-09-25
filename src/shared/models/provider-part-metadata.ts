import type { ProviderMetadata } from 'ai'

/**
 * Whitelist of provider metadata persisted on text/reasoning content parts.
 *
 * The rule is intentionally strict: only keys the app replays on follow-up
 * requests may be stored. Everything else — citation payloads, usage
 * breakdowns, etc. — is not on any replay path and would only bloat session
 * data (see "Session data must be compact").
 *
 * Two routes need replay metadata to survive persistence:
 *
 * - Anthropic thinking signatures and redacted thinking payloads are required
 *   to resume a tool-use turn after a pause (the Messages API rejects modified
 *   or missing thinking blocks).
 * - OpenAI Responses `itemId` / `reasoningEncryptedContent` are required to
 *   replay an encrypted reasoning item. Chatbox forces `store: false` (no
 *   server-side state), so the only way to keep the model's reasoning across
 *   turns is to send the item back — the documented stateless-mode pattern.
 * - Gemini `thoughtSignature` must be returned on the parts that carry it.
 *   It rides on `functionCall` parts (mandatory on Gemini 3 — the request 400s
 *   without it) and on the `text` / `thought` parts of a response with no
 *   function call, where Google documents that omitting it can degrade
 *   performance. Note this key lives on text parts too, not just reasoning
 *   ones, which is why `MessageTextPartSchema` carries provider metadata.
 *
 * Adding a key here requires adding the matching replay logic in
 * `model-message-converter.ts` in the same change.
 */
const PERSISTABLE_PART_METADATA_KEYS: Record<string, readonly string[]> = {
  anthropic: ['signature', 'redactedData'],
  openai: ['itemId', 'reasoningEncryptedContent'],
  google: ['thoughtSignature'],
}

/**
 * Part types whose replay metadata is kept, keyed by part type.
 *
 * Ingestion must not keep metadata a part can never replay. Gemini's signature rides on `text`
 * parts, but OpenAI's `itemId` / `reasoningEncryptedContent` are reasoning-part state: a text
 * part never carries them, and retaining them there would only widen what a later foreign route
 * is shown (see `pickPersistableProviderMetadata`).
 */
export type ReplayMetadataPartType = 'text' | 'reasoning'

const REPLAYABLE_NAMESPACES_BY_PART_TYPE: Record<ReplayMetadataPartType, Record<string, readonly string[]>> = {
  text: {
    google: PERSISTABLE_PART_METADATA_KEYS.google,
  },
  reasoning: PERSISTABLE_PART_METADATA_KEYS,
}

/**
 * Filters stream-chunk provider metadata down to the persistable whitelist.
 * Returns `undefined` when nothing survives, so callers can skip creating a
 * content part for metadata the app never replays.
 *
 * `only` restricts the result to the given provider namespaces. Ingestion
 * (stream processing) omits it and keeps every whitelisted namespace, because
 * the session may be resumed on any route later. Replay (`model-message-converter`)
 * passes the target route's namespaces so one provider's metadata never reaches
 * another provider's wire: an Anthropic request carrying a leftover OpenAI
 * `itemId` would turn an otherwise-dropped unsigned reasoning block into a
 * wire-visible one, which the Messages API rejects.
 *
 * `partType` narrows the whitelist to the keys that part type can actually replay.
 */
export function pickPersistableProviderMetadata(
  metadata: ProviderMetadata | undefined,
  only?: readonly string[],
  partType: ReplayMetadataPartType = 'reasoning'
): ProviderMetadata | undefined {
  if (!metadata) return undefined
  const allowed = REPLAYABLE_NAMESPACES_BY_PART_TYPE[partType]
  let picked: ProviderMetadata | undefined
  for (const [provider, keys] of Object.entries(allowed)) {
    if (only && !only.includes(provider)) continue
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
 * Whether picked replay metadata is enough for the target route to reconstruct the reasoning
 * block upstream, i.e. whether the block is genuinely signed rather than merely identifiable.
 *
 * Used by the `signed-only` conversion mode. Holding *some* whitelisted key is not enough:
 *
 * - Anthropic Messages validates the thinking block's `signature`, or replays `redactedData`.
 * - OpenAI Responses runs with `store: false`. An `itemId` alone points at server-side reasoning
 *   state that will not exist on the follow-up request, so an id-only part cannot be
 *   reconstructed — only the encrypted payload travels with the request. The id is still
 *   accumulated while the turn is in flight (it identifies the item), but it does not by itself
 *   make the part replayable history.
 * - Gemini's `thoughtSignature` is self-contained.
 */
export function hasReplayableSignedReasoning(metadata: ProviderMetadata | undefined): boolean {
  if (!metadata) return false

  const hasKey = (namespace: unknown, ...keys: string[]): boolean => {
    if (!namespace || typeof namespace !== 'object') return false
    return keys.some((key) => (namespace as Record<string, unknown>)[key] !== undefined)
  }

  return (
    hasKey(metadata.anthropic, 'signature', 'redactedData') ||
    hasKey(metadata.openai, 'reasoningEncryptedContent') ||
    hasKey(metadata.google, 'thoughtSignature')
  )
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

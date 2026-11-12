import type { ProviderMetadata } from 'ai'

/**
 * Whitelist of provider metadata persisted on text/reasoning content parts.
 *
 * The rule is intentionally strict: only keys the app replays on follow-up
 * requests may be stored. Everything else — citation payloads, usage
 * breakdowns, etc. — is not on any replay path and would only bloat session
 * data (see "Session data must be compact").
 *
 * Three routes need replay metadata to survive persistence:
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
  openai: ['itemId', 'reasoningEncryptedContent', 'chatboxReplaySource'],
  google: ['thoughtSignature'],
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
 */
export function pickPersistableProviderMetadata(
  metadata: ProviderMetadata | undefined,
  only?: readonly string[]
): ProviderMetadata | undefined {
  if (!metadata) return undefined
  let picked: ProviderMetadata | undefined
  for (const [provider, keys] of Object.entries(PERSISTABLE_PART_METADATA_KEYS)) {
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
 * Whether persistable metadata can create a content part on its own. A Responses
 * reasoning item without encrypted content cannot be replayed statelessly, so its
 * item id only annotates reasoning text that exists anyway and never creates an
 * otherwise empty part.
 */
export function canCreateReplayPart(metadata: ProviderMetadata | undefined): boolean {
  if (!metadata) return false
  return Object.entries(metadata).some(
    ([provider, namespace]) => provider !== 'openai' || typeof namespace.reasoningEncryptedContent === 'string'
  )
}

/**
 * Binds Responses metadata to the replay source that produced it. Ciphertext
 * decrypts only for its own provider/account, so without a source it can never
 * replay and is dropped rather than persisted.
 */
export function bindReplaySource(
  metadata: ProviderMetadata | undefined,
  source: string | undefined
): ProviderMetadata | undefined {
  if (!metadata?.openai) return metadata
  const { openai, ...rest } = metadata
  return source ? { ...rest, openai: { ...openai, chatboxReplaySource: source } } : rest
}

/** Where stored replay metadata is going: the route's namespaces and replay source. */
export interface ReplayTarget {
  namespaces: readonly string[]
  source: string | undefined
  /** Responses items of the same assistant turn whose ciphertext came from `source`. */
  replayableOpenAIItemIds: ReadonlySet<string>
}

export function collectReplayableOpenAIItemIds(
  parts: readonly { type: string; providerMetadata?: ProviderMetadata }[],
  source: string | undefined
): ReadonlySet<string> {
  const itemIds = new Set<string>()
  if (!source) return itemIds
  for (const part of parts) {
    const openai = part.type === 'reasoning' ? part.providerMetadata?.openai : undefined
    if (
      typeof openai?.itemId === 'string' &&
      typeof openai.reasoningEncryptedContent === 'string' &&
      openai.reasoningEncryptedContent &&
      openai.chatboxReplaySource === source
    ) {
      itemIds.add(openai.itemId)
    }
  }
  return itemIds
}

/**
 * Wire metadata for replaying a stored part to `target`, or `undefined` when
 * nothing may go out. Responses reasoning replays only to the source of its
 * ciphertext (stateless Responses cannot retrieve reasoning from an item id);
 * a multi-summary item carries its ciphertext on the last summary only, so
 * earlier summaries join it through the shared item id. Local provenance never
 * reaches the wire.
 */
export function pickReplayMetadata(
  metadata: ProviderMetadata | undefined,
  target: ReplayTarget
): ProviderMetadata | undefined {
  const picked = pickPersistableProviderMetadata(metadata, target.namespaces)
  if (picked?.openai) {
    const { chatboxReplaySource, ...wire } = picked.openai
    const replayable =
      !!target.source &&
      chatboxReplaySource === target.source &&
      (!!wire.reasoningEncryptedContent ||
        (typeof wire.itemId === 'string' && target.replayableOpenAIItemIds.has(wire.itemId)))
    if (replayable) {
      picked.openai = wire
    } else {
      delete picked.openai
    }
  }
  return picked && Object.keys(picked).length > 0 ? picked : undefined
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

import type { ModelMessage } from 'ai'

export type AnthropicCacheTtl = '5m' | '1h'

/**
 * Add ephemeral cache control breakpoints for Anthropic prompt caching.
 * Places up to 3 breakpoints for optimal prefix caching:
 * 1. System message (stable prefix when instructions are unchanged)
 * 2. Second-to-last user message (previous turn's breakpoint, cache-hit on this turn)
 * 3. Last message (creates new cache prefix for the next turn)
 *
 * Used by direct/custom Anthropic Messages and Anthropic-routed Chatbox AI.
 * A one-hour TTL requires upstream support and has a higher cache-write price.
 * See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
export function addAnthropicCacheControl(messages: ModelMessage[], ttl: AnthropicCacheTtl = '5m'): ModelMessage[] {
  if (messages.length === 0) {
    return messages
  }

  const result = [...messages]
  const cacheIndices = new Set<number>()

  // 1. Cache system message if present
  if (result[0]?.role === 'system') {
    cacheIndices.add(0)
  }

  // 2. Cache second-to-last user message (previous turn's "last message" breakpoint)
  const lastIndex = result.length - 1
  let userCount = 0
  for (let i = lastIndex; i >= 0; i--) {
    if (result[i].role === 'user') {
      userCount++
      if (userCount === 2) {
        cacheIndices.add(i)
        break
      }
    }
  }

  // 3. Cache the last message
  cacheIndices.add(lastIndex)

  for (const idx of cacheIndices) {
    const msg = result[idx]
    result[idx] = {
      ...msg,
      providerOptions: {
        ...msg.providerOptions,
        anthropic: {
          ...(msg.providerOptions?.anthropic as Record<string, unknown> | undefined),
          // Omit the default TTL for compatibility with existing relays.
          cacheControl: { type: 'ephemeral', ...(ttl === '1h' ? { ttl: '1h' } : {}) },
        },
      },
    }
  }

  return result
}

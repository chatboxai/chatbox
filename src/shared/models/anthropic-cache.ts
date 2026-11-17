import type { ModelMessage } from 'ai'

export type AnthropicPromptCacheTTL = '5m' | '1h'

type ContentPart = Exclude<ModelMessage['content'], string>[number]

type ProviderOptions = NonNullable<ModelMessage['providerOptions']>

type CacheControl = { type: 'ephemeral'; ttl?: AnthropicPromptCacheTTL }

function getPartProviderOptions(part: ContentPart): ProviderOptions | undefined {
  return 'providerOptions' in part ? part.providerOptions : undefined
}

type CacheTarget = { messageIndex: number; partIndex?: number }

/**
 * Places Anthropic prompt-cache breakpoints for one request.
 *
 * Call this on the final messages of every request, including every step of an
 * automatic tool loop, so the breakpoints follow the conversation tail. Markers
 * already present on the messages are removed first, so re-applying it on a
 * transcript that carries markers from an earlier step never accumulates them.
 *
 * At most three breakpoints are placed, leaving one of Anthropic's four slots for
 * automatic caching (a request-level `cache_control` added by a gateway):
 * 1. The leading system message.
 * 2. The tail of the previous request: the last cacheable block before the most
 *    recent assistant message. Reading the previous request's cache entry here keeps
 *    hits working when one round appends more blocks than the lookback window.
 * 3. The last cacheable block, which writes the entry the next request reads.
 *
 * Thinking blocks and empty text blocks cannot carry `cache_control`, so a target
 * message ending in one falls back to its last cacheable block, or to an earlier
 * message when it has none.
 *
 * See: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
export function applyAnthropicCacheBreakpoints(
  messages: ModelMessage[],
  ttl?: AnthropicPromptCacheTTL
): ModelMessage[] {
  const result = messages.map(stripCacheControl)
  if (result.length === 0) {
    return result
  }

  const targets: CacheTarget[] = []
  const addTarget = (target: CacheTarget | undefined) => {
    if (target && !targets.some((t) => t.messageIndex === target.messageIndex && t.partIndex === target.partIndex)) {
      targets.push(target)
    }
  }

  if (result[0].role === 'system') {
    addTarget(findCacheTarget(result, 0))
  }

  const lastTarget = findLastCacheTarget(result, result.length - 1)
  const lastAssistantIndex = result.findLastIndex((message) => message.role === 'assistant')
  if (lastTarget && lastAssistantIndex > 0) {
    const previousTail = findLastCacheTarget(result, lastAssistantIndex - 1)
    if (previousTail && previousTail.messageIndex < lastTarget.messageIndex) {
      addTarget(previousTail)
    }
  }
  addTarget(lastTarget)

  const cacheControl: CacheControl = { type: 'ephemeral', ...(ttl ? { ttl } : {}) }
  for (const target of targets) {
    result[target.messageIndex] = markMessage(result[target.messageIndex], target.partIndex, cacheControl)
  }
  return result
}

function findLastCacheTarget(messages: ModelMessage[], fromIndex: number): CacheTarget | undefined {
  for (let i = fromIndex; i >= 0; i--) {
    const target = findCacheTarget(messages, i)
    if (target) {
      return target
    }
  }
  return undefined
}

function findCacheTarget(messages: ModelMessage[], messageIndex: number): CacheTarget | undefined {
  const message = messages[messageIndex]
  if (typeof message.content === 'string') {
    return message.content.length > 0 ? { messageIndex } : undefined
  }
  const parts = message.content as ContentPart[]
  const partIndex = parts.findLastIndex(isCacheablePart)
  if (partIndex === -1) {
    return undefined
  }
  // Tool results always carry a part-level marker: some providers copy a tool
  // message's marker onto every result it expands into.
  if (partIndex === parts.length - 1 && message.role !== 'tool') {
    return { messageIndex }
  }
  return { messageIndex, partIndex }
}

function isCacheablePart(part: ContentPart): boolean {
  switch (part.type) {
    case 'text':
      return part.text.length > 0
    case 'image':
    case 'file':
    case 'tool-call':
    case 'tool-result':
      return true
    default:
      return false
  }
}

function markMessage(message: ModelMessage, partIndex: number | undefined, cacheControl: CacheControl): ModelMessage {
  if (partIndex === undefined || typeof message.content === 'string') {
    return { ...message, providerOptions: withCacheControl(message.providerOptions, cacheControl) } as ModelMessage
  }
  const content = (message.content as ContentPart[]).map((part, index) =>
    index === partIndex
      ? { ...part, providerOptions: withCacheControl(getPartProviderOptions(part), cacheControl) }
      : part
  )
  return { ...message, content } as ModelMessage
}

function withCacheControl(providerOptions: ProviderOptions | undefined, cacheControl: CacheControl): ProviderOptions {
  return {
    ...providerOptions,
    anthropic: { ...providerOptions?.anthropic, cacheControl },
  }
}

function stripCacheControl(message: ModelMessage): ModelMessage {
  const providerOptions = withoutCacheControl(message.providerOptions)
  let content = message.content
  if (typeof content !== 'string') {
    const parts = content as ContentPart[]
    let changed = false
    const stripped = parts.map((part) => {
      const currentOptions = getPartProviderOptions(part)
      const partOptions = withoutCacheControl(currentOptions)
      if (partOptions === currentOptions) {
        return part
      }
      changed = true
      return { ...part, providerOptions: partOptions }
    })
    if (changed) {
      content = stripped as typeof content
    }
  }
  if (providerOptions === message.providerOptions && content === message.content) {
    return message
  }
  return { ...message, providerOptions, content } as ModelMessage
}

function withoutCacheControl(providerOptions: ProviderOptions | undefined): ProviderOptions | undefined {
  const anthropic = providerOptions?.anthropic
  if (!anthropic || (!('cacheControl' in anthropic) && !('cache_control' in anthropic))) {
    return providerOptions
  }
  const { cacheControl: _cacheControl, cache_control: _cacheControlSnake, ...rest } = anthropic
  const { anthropic: _anthropic, ...others } = providerOptions
  if (Object.keys(rest).length === 0) {
    return Object.keys(others).length === 0 ? undefined : others
  }
  return { ...others, anthropic: rest }
}

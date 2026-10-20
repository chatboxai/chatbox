/** Ollama replays assistant thinking from `reasoning`, while the SDK emits `reasoning_content`. */
export function createOllamaReasoningFetch(fetchFunction: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    if (typeof init?.body !== 'string') return fetchFunction(input, init)
    let body: { messages?: unknown[] }
    try {
      body = JSON.parse(init.body)
    } catch {
      return fetchFunction(input, init)
    }
    if (!body || !Array.isArray(body.messages)) return fetchFunction(input, init)
    let changed = false
    body.messages = body.messages.map((message: unknown) => {
      if (!message || typeof message !== 'object') return message
      const value = message as Record<string, unknown>
      if (value.role !== 'assistant' || typeof value.reasoning_content !== 'string') return message
      const { reasoning_content, ...rest } = value
      changed = true
      return { ...rest, reasoning: rest.reasoning ?? reasoning_content }
    })
    return fetchFunction(input, changed ? { ...init, body: JSON.stringify(body) } : init)
  }
}

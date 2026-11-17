function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Retains the identity of complete tool headers while normalizing argument-only continuations. */
export function createOpenAIToolCallDeltaNormalizer(): (value: unknown) => boolean {
  const knownCalls = new Map<number, Set<number>>()

  return (value) => {
    if (!isObject(value) || !Array.isArray(value.choices)) return false
    let changed = false
    for (const choice of value.choices) {
      if (!isObject(choice) || !isObject(choice.delta) || !Array.isArray(choice.delta.tool_calls)) continue
      const choiceIndex = choice.index ?? 0
      if (typeof choiceIndex !== 'number' || !Number.isInteger(choiceIndex) || choiceIndex < 0) continue
      for (const call of choice.delta.tool_calls) {
        if (!isObject(call) || typeof call.index !== 'number' || !Number.isInteger(call.index) || call.index < 0)
          continue
        if (!isObject(call.function)) continue
        const calls = knownCalls.get(choiceIndex)
        if (
          call.type === 'function' &&
          typeof call.id === 'string' &&
          call.id.length > 0 &&
          typeof call.function.name === 'string' &&
          call.function.name.length > 0
        ) {
          if (calls) calls.add(call.index)
          else knownCalls.set(choiceIndex, new Set([call.index]))
          continue
        }
        const hasEmptyIdentity =
          (call.id == null || call.id === '') && (call.function.name == null || call.function.name === '')
        if (call.type === '' && hasEmptyIdentity && calls?.has(call.index)) {
          delete call.type
          changed = true
        } else if (!hasEmptyIdentity || (call.type != null && call.type !== 'function')) {
          calls?.delete(call.index)
        }
      }
    }
    return changed
  }
}

export function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error('Operation canceled')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): error is { readonly name: 'AbortError' } {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason)
}

/** React Native signals do not consistently expose the newer throwIfAborted method. */
export function throwIfWorkAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('Tool execution stopped')
  error.name = 'AbortError'
  throw error
}

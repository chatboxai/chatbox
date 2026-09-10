import { type StartStreamOptions, StreamHttp } from 'capacitor-stream-http'

export type { StartStreamOptions } from 'capacitor-stream-http'
export { StreamHttp }

type NativeStreamEventName = 'chunk' | 'end' | 'error'
type NativeStreamEvent = { id: string; chunk?: string; error?: string }
type PendingNativeStreamEvent = { eventName: NativeStreamEventName; data: NativeStreamEvent }
type NativeStreamPhase = 'setup' | 'starting' | 'active' | 'terminal'
type NativeReadableStreamOptions = { signal?: AbortSignal }
type ListenerRemover = () => void | Promise<void>

const activeStreamIds = new Set<string>()

function toAbortError(reason: unknown): unknown {
  return typeof reason === 'object' && reason !== null && 'name' in reason && reason.name === 'AbortError'
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

function removeListener(remove: ListenerRemover) {
  try {
    void Promise.resolve(remove()).catch((error: unknown) => {
      console.warn('Failed to remove native stream listener', error)
    })
  } catch (error) {
    console.warn('Failed to remove native stream listener', error)
  }
}

export function createNativeReadableStream(
  options: StartStreamOptions,
  { signal }: NativeReadableStreamOptions = {}
): ReadableStream<Uint8Array> {
  let phase: NativeStreamPhase = 'setup'
  let streamId: string | null = null
  let nativeStartPromise: Promise<{ id: string }> | null = null
  let nativeCancelPromise: Promise<void> | null = null
  const removeListeners: ListenerRemover[] = []
  const pendingEvents: PendingNativeStreamEvent[] = []
  let removeAbortListener: (() => void) | null = null
  const textEncoder = new TextEncoder()

  const finish = () => {
    if (phase === 'terminal') return false
    phase = 'terminal'
    pendingEvents.length = 0
    if (streamId !== null) activeStreamIds.delete(streamId)
    for (const remove of removeListeners.splice(0)) removeListener(remove)
    removeAbortListener?.()
    removeAbortListener = null
    return true
  }

  const isTerminal = () => phase === 'terminal'

  const addListener = async (eventName: NativeStreamEventName, listener: (data: NativeStreamEvent) => void) => {
    const handle = await StreamHttp.addListener(eventName, listener)
    if (phase === 'terminal') removeListener(handle.remove)
    else removeListeners.push(handle.remove)
  }

  const cancelNativeRequest = () => {
    if (nativeCancelPromise) return nativeCancelPromise
    if (streamId !== null) {
      nativeCancelPromise = StreamHttp.cancelStream({ id: streamId })
    } else if (nativeStartPromise) {
      nativeCancelPromise = nativeStartPromise.then(({ id }) => StreamHttp.cancelStream({ id }))
    } else {
      nativeCancelPromise = Promise.resolve()
    }
    return nativeCancelPromise
  }

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const handleAbort = () => {
        if (!finish()) return
        controller.error(toAbortError(signal?.reason))
        if (streamId !== null || nativeStartPromise) {
          void cancelNativeRequest().catch((error: unknown) => {
            console.warn('Failed to cancel native stream', error)
          })
        }
      }

      if (signal) {
        if (signal.aborted) {
          handleAbort()
          return
        }
        signal.addEventListener('abort', handleAbort, { once: true })
        removeAbortListener = () => signal.removeEventListener('abort', handleAbort)
      }

      const handleEvent = (eventName: NativeStreamEventName, data: NativeStreamEvent) => {
        if (phase === 'terminal' || phase === 'setup') return
        if (phase === 'starting') {
          if (!activeStreamIds.has(data.id)) pendingEvents.push({ eventName, data })
          return
        }
        if (data.id !== streamId) return

        switch (eventName) {
          case 'chunk':
            controller.enqueue(textEncoder.encode(data.chunk || ''))
            break
          case 'end':
            if (finish()) controller.close()
            break
          case 'error':
            if (finish()) controller.error(new Error(data.error || 'Native stream error'))
            break
        }
      }

      try {
        await addListener('chunk', (data) => handleEvent('chunk', data))
        if (isTerminal()) return

        await addListener('end', (data) => handleEvent('end', data))
        if (isTerminal()) return

        await addListener('error', (data) => handleEvent('error', data))
        if (isTerminal()) return

        phase = 'starting'
        nativeStartPromise = StreamHttp.startStream(options)
        const { id } = await nativeStartPromise
        if (isTerminal()) {
          await (nativeCancelPromise ?? cancelNativeRequest())
          return
        }

        streamId = id
        activeStreamIds.add(id)
        phase = 'active'
        for (const event of pendingEvents.splice(0)) {
          handleEvent(event.eventName, event.data)
          if (isTerminal()) break
        }
      } catch (error) {
        if (!finish()) return
        controller.error(error instanceof Error ? error : new Error('Failed to start native stream'))
      }
    },
    cancel: async () => {
      if (!finish()) return
      await cancelNativeRequest()
    },
  })
}

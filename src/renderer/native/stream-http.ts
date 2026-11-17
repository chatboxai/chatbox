import { type StartStreamOptions, StreamHttp } from 'capacitor-stream-http'

export type { StartStreamOptions } from 'capacitor-stream-http'
export { StreamHttp }

type NativeStreamEventName = 'chunk' | 'end' | 'error' | 'response'
type NativeStreamEvent = {
  id: string
  chunk?: string
  error?: string
  status?: number
  headers?: Record<string, string>
}
type PendingNativeStreamEvent = { eventName: NativeStreamEventName; data: NativeStreamEvent }
type NativeStreamPhase = 'setup' | 'starting' | 'active' | 'terminal'
type NativeReadableStreamOptions = {
  signal?: AbortSignal
  responseTimeoutMs?: number
  maxBufferedBytes?: number
}
type ListenerRemover = () => void | Promise<void>

const activeStreamIds = new Set<string>()
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
const MAX_PENDING_EVENTS = 4096

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
  streamOptions: NativeReadableStreamOptions = {}
): ReadableStream<Uint8Array> {
  return createNativeStream(options, streamOptions, false).body
}

export async function createNativeResponse(
  options: StartStreamOptions,
  streamOptions: NativeReadableStreamOptions = {}
): Promise<Response> {
  const { body, response } = createNativeStream(options, streamOptions, true)
  const metadata = await response
  const nullBody = options.method.toUpperCase() === 'HEAD' || [204, 205, 304].includes(metadata.status)
  if (nullBody) void body.cancel().catch(() => undefined)
  try {
    return new Response(nullBody ? null : body, metadata)
  } catch (error) {
    void body.cancel().catch(() => undefined)
    throw error
  }
}

function createNativeStream(
  options: StartStreamOptions,
  { signal, responseTimeoutMs = 30_000, maxBufferedBytes = MAX_BUFFERED_BYTES }: NativeReadableStreamOptions,
  requireResponse: boolean
) {
  let phase: NativeStreamPhase = 'setup'
  let streamId: string | null = null
  let nativeStartPromise: Promise<{ id: string }> | null = null
  let nativeCancelPromise: Promise<void> | null = null
  const removeListeners: ListenerRemover[] = []
  const pendingEvents: PendingNativeStreamEvent[] = []
  let pendingBytes = 0
  let removeAbortListener: (() => void) | null = null
  let responseTimer: ReturnType<typeof setTimeout> | undefined
  let receivedResponse = false
  let resolveResponse!: (value: { status: number; headers: Record<string, string> }) => void
  let rejectResponse!: (reason: unknown) => void
  const response = new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  // The stream-only API has no consumer for response metadata.
  void response.catch(() => undefined)
  const textEncoder = new TextEncoder()

  const finish = (error?: unknown) => {
    if (phase === 'terminal') return false
    phase = 'terminal'
    clearTimeout(responseTimer)
    pendingEvents.length = 0
    pendingBytes = 0
    if (!receivedResponse) rejectResponse(error ?? new Error('Native stream ended without response metadata'))
    if (streamId !== null) activeStreamIds.delete(streamId)
    for (const remove of removeListeners.splice(0)) removeListener(remove)
    removeAbortListener?.()
    removeAbortListener = null
    return true
  }

  const isTerminal = () => phase === 'terminal'
  const cancelNativeRequest = () => {
    if (nativeCancelPromise) return nativeCancelPromise
    if (streamId !== null) nativeCancelPromise = StreamHttp.cancelStream({ id: streamId })
    else if (nativeStartPromise)
      nativeCancelPromise = nativeStartPromise.then(({ id }) => StreamHttp.cancelStream({ id }))
    else nativeCancelPromise = Promise.resolve()
    return nativeCancelPromise
  }
  const cancelInBackground = () => {
    void cancelNativeRequest().catch((error: unknown) => console.warn('Failed to cancel native stream', error))
  }

  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const fail = (error: unknown, cancel: boolean) => {
          if (!finish(error)) return
          controller.error(error)
          if (cancel) cancelInBackground()
        }
        const handleAbort = () => fail(toAbortError(signal?.reason), true)
        if (signal?.aborted) {
          handleAbort()
          return
        }
        signal?.addEventListener('abort', handleAbort, { once: true })
        removeAbortListener = () => signal?.removeEventListener('abort', handleAbort)
        responseTimer = setTimeout(
          () => fail(new DOMException('Timed out waiting for native response', 'TimeoutError'), true),
          responseTimeoutMs
        )

        const handleEvent = (eventName: NativeStreamEventName, data: NativeStreamEvent) => {
          if (phase === 'terminal' || phase === 'setup') return
          if (phase === 'starting') {
            if (activeStreamIds.has(data.id)) return
            pendingBytes += textEncoder.encode(JSON.stringify(data)).byteLength
            if (pendingEvents.length >= MAX_PENDING_EVENTS || pendingBytes > maxBufferedBytes) {
              fail(new Error('Native stream exceeded pending event buffer limit'), true)
              return
            }
            pendingEvents.push({ eventName, data })
            return
          }
          if (data.id !== streamId) return
          switch (eventName) {
            case 'response':
              if (receivedResponse) return
              if (!data.status || data.status < 200 || data.status > 599 || !data.headers) {
                fail(new TypeError('Invalid native response metadata'), true)
                return
              }
              receivedResponse = true
              clearTimeout(responseTimer)
              resolveResponse({ status: data.status, headers: data.headers })
              break
            case 'chunk': {
              if (requireResponse && !receivedResponse) {
                fail(new Error('Native stream body arrived before response metadata'), true)
                return
              }
              if (!requireResponse) clearTimeout(responseTimer)
              const chunk = textEncoder.encode(data.chunk || '')
              if (chunk.byteLength > (controller.desiredSize ?? 0)) {
                fail(new Error('Native stream exceeded body buffer limit'), true)
                return
              }
              controller.enqueue(chunk)
              break
            }
            case 'end':
              if (finish()) controller.close()
              break
            case 'error':
              fail(new Error(data.error || 'Native stream error'), false)
              break
          }
        }

        const setup = async () => {
          try {
            for (const eventName of ['chunk', 'end', 'error', 'response'] as const) {
              const listener = (data: NativeStreamEvent) => handleEvent(eventName, data)
              const handle =
                eventName === 'response'
                  ? await StreamHttp.addListener('response', listener)
                  : await StreamHttp.addListener(eventName, listener)
              if (isTerminal()) {
                removeListener(handle.remove)
                return
              }
              removeListeners.push(handle.remove)
            }
            phase = 'starting'
            nativeStartPromise = StreamHttp.startStream(options)
            const { id } = await nativeStartPromise
            if (isTerminal()) {
              await cancelNativeRequest()
              return
            }
            streamId = id
            activeStreamIds.add(id)
            phase = 'active'
            const events = pendingEvents.splice(0)
            pendingBytes = 0
            for (const event of events) {
              handleEvent(event.eventName, event.data)
              if (isTerminal()) break
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error('Failed to start native stream'), true)
          }
        }
        void setup()
      },
      cancel() {
        if (!finish(toAbortError(undefined))) return
        return cancelNativeRequest()
      },
    },
    { highWaterMark: maxBufferedBytes, size: (chunk) => chunk.byteLength }
  )
  return { body, response }
}

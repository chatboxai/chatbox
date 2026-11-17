import { NonReplayableRequestError } from '../models/errors'

/** Native owns the request; reads acknowledge only bytes already delivered to JS. */
export interface BackgroundStreamBridge {
  start(options: {
    id: string
    url: string
    method: string
    headers: Record<string, string>
    body?: string
  }): Promise<{ started: boolean } | void>
  read(options: { id: string; after: number }): Promise<{
    chunks: { sequence: number; base64: string }[]
    status?: number
    headers?: Record<string, string>
    done: boolean
    error?: string
  }>
  cancel(options: { id: string }): Promise<void>
  release(options: { id: string }): Promise<void>
}

export function isBackgroundStreamRequest(url: string, body: unknown, headers?: Headers): boolean {
  if (headers?.get('accept')?.includes('text/event-stream') || /[?&]alt=sse(?:&|$)/.test(url)) return true
  if (typeof body !== 'string') return false
  try {
    return JSON.parse(body)?.stream === true
  } catch {
    return false
  }
}

export async function backgroundStreamFetch(
  bridge: BackgroundStreamBridge,
  url: string,
  init: RequestInit = {},
  subscribeToResume?: (resume: () => void) => () => void,
  fallback?: () => Promise<Response>
): Promise<Response> {
  const id = globalThis.crypto?.randomUUID?.() ?? `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const signal = init.signal
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  if (init.body != null && typeof init.body !== 'string') throw new TypeError('Native stream requires a string body')
  let after = 0
  let finished = false
  let started = false
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  let unsubscribeResume: (() => void) | undefined
  const abortError = () => new DOMException('The operation was aborted.', 'AbortError')
  const cleanup = async (cancel: boolean) => {
    if (finished) return
    finished = true
    if (timer) clearTimeout(timer)
    wake?.()
    signal?.removeEventListener('abort', onAbort)
    unsubscribeResume?.()
    if (started) {
      try {
        if (cancel) await bridge.cancel({ id })
      } finally {
        await bridge.release({ id })
      }
    }
  }
  const onAbort = () => {
    controller?.error(abortError())
    // Start can still be crossing the bridge; its continuation owns cancellation.
    void cleanup(true).catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  unsubscribeResume = subscribeToResume?.(() => {
    if (timer) clearTimeout(timer)
    const pending = wake
    wake = undefined
    pending?.()
  })
  const pause = () =>
    new Promise<void>((resolve) => {
      wake = resolve
      timer = setTimeout(() => {
        wake = undefined
        resolve()
      }, 100)
    })
  try {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value
    })
    const admission = await bridge.start({
      id,
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body ?? undefined,
    })
    if (admission?.started === false) {
      await cleanup(false)
      if (signal?.aborted) throw abortError()
      if (fallback) return fallback()
      throw new NonReplayableRequestError('Native background execution unavailable before dispatch')
    }
    started = true
    if (finished || signal?.aborted) {
      await bridge.cancel({ id })
      await bridge.release({ id })
      throw abortError()
    }
    let snapshot = await bridge.read({ id, after })
    while (!snapshot.status && !snapshot.done && !finished) {
      await pause()
      if (!finished) snapshot = await bridge.read({ id, after })
    }
    if (finished) throw abortError()
    if (!snapshot.status)
      throw new NonReplayableRequestError(snapshot.error ?? 'Native stream ended before response headers')
    const initial = snapshot
    let first = true
    let terminal = false
    let terminalError: string | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
      },
      async pull(value) {
        try {
          while (!finished) {
            if (terminal) {
              if (terminalError) value.error(new NonReplayableRequestError(terminalError))
              else value.close()
              await cleanup(false)
              return
            }
            const batch = first ? initial : await bridge.read({ id, after })
            first = false
            if (finished) return
            let delivered = false
            for (const chunk of batch.chunks) {
              if (chunk.sequence <= after) continue
              if (chunk.sequence !== after + 1) throw new NonReplayableRequestError('Native stream cursor gap')
              const binary = atob(chunk.base64)
              value.enqueue(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
              after = chunk.sequence
              delivered = true
            }
            if (batch.done) {
              terminal = true
              terminalError = batch.error
              // Let the consumer drain retained bytes before surfacing a terminal error.
              if (delivered) return
              continue
            }
            if (delivered) return
            await pause()
          }
        } catch (error) {
          if (!finished)
            value.error(
              error instanceof NonReplayableRequestError
                ? error
                : new NonReplayableRequestError(error instanceof Error ? error.message : 'Native stream read failed')
            )
          await cleanup(true)
        }
      },
      async cancel() {
        await cleanup(true)
      },
    })
    // Fetch forbids bodies for these status codes.
    if ([204, 205, 304].includes(initial.status ?? 0)) {
      await cleanup(true)
      return new Response(null, { status: initial.status, headers: initial.headers })
    }
    const response = new Response(stream, { status: initial.status, headers: initial.headers })
    return response
  } catch (error) {
    await cleanup(true).catch(() => {})
    if (signal?.aborted) throw abortError()
    throw error instanceof NonReplayableRequestError
      ? error
      : new NonReplayableRequestError(error instanceof Error ? error.message : 'Native stream failed')
  }
}

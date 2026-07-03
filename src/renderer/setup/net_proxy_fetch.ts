/**
 * SEC-3: renderer-side half of the main-process fetch proxy.
 *
 * The BrowserWindow runs with webSecurity enabled, so direct cross-origin
 * fetch() calls (AI provider APIs, web search, remote model registries, …)
 * would fail CORS — those servers don't send CORS headers. Instead of
 * threading a custom fetch through every ai-SDK adapter and helper, this
 * module replaces the global fetch with a wrapper that forwards cross-origin
 * http(s) requests to the main process over IPC (src/main/net-proxy.ts) and
 * streams the response body back. Same-origin requests and non-http schemes
 * (data:, blob:) keep using the native fetch. Installed for the desktop
 * (Electron) platform only — web/mobile builds are unaffected.
 */

const nativeFetch = globalThis.fetch.bind(globalThis)

interface NetProxyResponseHead {
  status: number
  statusText: string
  headers: [string, string][]
  hasBody: boolean
}

interface NetProxyReadResult {
  done: boolean
  chunk?: Uint8Array
}

// Statuses the Response constructor refuses to pair with a body.
const NULL_BODY_STATUSES = new Set([204, 205, 304])

function newAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function shouldProxy(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.origin !== window.location.origin
}

async function serializeBody(
  body: BodyInit | null | undefined,
  headers: Headers
): Promise<string | Uint8Array | undefined> {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
    }
    return body.toString()
  }
  if (body instanceof Blob) {
    if (body.type && !headers.has('content-type')) {
      headers.set('content-type', body.type)
    }
    return new Uint8Array(await body.arrayBuffer())
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0))
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength))
  }
  // FormData / ReadableStream bodies never occur on provider calls today; fail
  // loudly rather than silently sending a mis-encoded request.
  throw new TypeError('net-proxy: unsupported request body type')
}

function buildResponse(head: NetProxyResponseHead, stream: ReadableStream<Uint8Array> | null, url: string): Response {
  const response = new Response(NULL_BODY_STATUSES.has(head.status) ? null : stream, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  })
  // Response.url is read-only and empty when constructed manually; several
  // callers use it for error messages.
  Object.defineProperty(response, 'url', { value: url })
  return response
}

async function proxiedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : undefined
  const rawUrl = request ? request.url : input.toString()

  let url: URL
  try {
    url = new URL(rawUrl, window.location.href)
  } catch {
    return nativeFetch(input as RequestInfo, init)
  }
  if (!shouldProxy(url)) {
    return nativeFetch(input as RequestInfo, init)
  }

  const invoke = window.electronAPI.invoke
  const signal = init?.signal ?? request?.signal
  if (signal?.aborted) throw newAbortError()

  // Register the abort hook before the first await so an abort during body
  // serialization or the IPC round-trip cannot be lost.
  const id = crypto.randomUUID()
  const abort = () => {
    invoke('net-proxy:abort', id).catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })

  let head: NetProxyResponseHead
  try {
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    // Per the fetch spec, init.headers replaces the Request's headers entirely.
    const headers = new Headers(init?.headers ?? request?.headers)
    const rawBody =
      init?.body ?? (request && method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : null)
    const body = await serializeBody(rawBody, headers)

    const headersRecord: Record<string, string> = {}
    headers.forEach((value, name) => {
      headersRecord[name] = value
    })

    if (signal?.aborted) throw newAbortError()
    head = (await invoke('net-proxy:fetch', {
      id,
      url: url.toString(),
      method,
      headers: headersRecord,
      body,
      redirect: init?.redirect ?? request?.redirect,
    })) as NetProxyResponseHead
  } catch (error) {
    signal?.removeEventListener('abort', abort)
    if (signal?.aborted) throw newAbortError()
    if (error instanceof TypeError) throw error
    // Native fetch rejects with a TypeError on network failure; keep that shape.
    throw new TypeError(error instanceof Error ? error.message : String(error))
  }

  if (!head.hasBody) {
    signal?.removeEventListener('abort', abort)
    return buildResponse(head, null, url.toString())
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: NetProxyReadResult
      try {
        result = (await invoke('net-proxy:read', id)) as NetProxyReadResult
      } catch (error) {
        signal?.removeEventListener('abort', abort)
        controller.error(signal?.aborted ? newAbortError() : error)
        return
      }
      if (result.done) {
        signal?.removeEventListener('abort', abort)
        controller.close()
        return
      }
      controller.enqueue(new Uint8Array(result.chunk as Uint8Array))
    },
    cancel() {
      signal?.removeEventListener('abort', abort)
      abort()
    },
  })

  return buildResponse(head, stream, url.toString())
}

export function installNetProxyFetch() {
  if (typeof window === 'undefined' || !window.electronAPI?.invoke) return
  globalThis.fetch = proxiedFetch as typeof globalThis.fetch
}

installNetProxyFetch()

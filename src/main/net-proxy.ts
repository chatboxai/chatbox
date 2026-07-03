import { app, ipcMain, session } from 'electron'

// SEC-3: main-process fetch proxy. The renderer runs with webSecurity enabled,
// so it cannot call cross-origin provider APIs (OpenAI, Anthropic, Ollama,
// custom hosts, …) directly — those servers don't send CORS headers. Instead,
// the renderer's global fetch (src/renderer/setup/net_proxy_fetch.ts) forwards
// cross-origin http(s) requests here over three invoke channels:
//
//   net-proxy:fetch  — start the request, returns status/headers
//   net-proxy:read   — pull the next response-body chunk (natural backpressure)
//   net-proxy:abort  — cancel a pending request or an open body stream
//
// Requests go through session.defaultSession.fetch so the user-configured
// proxy (src/main/proxy.ts) and Chromium's network stack still apply.
//
// Trust model: the renderer is untrusted. This proxy grants it plain
// http(s) networking — the same reach it had under webSecurity:false — and
// nothing more: ses.fetch can reach file:// and custom app schemes, so only
// http:/https: URLs are accepted here.

const IDLE_TIMEOUT_MS = 120_000
const MAX_STREAMS = 64

interface ProxyStream {
  reader: ReadableStreamDefaultReader<Uint8Array>
  controller: AbortController
  idleTimer: NodeJS.Timeout
  senderId: number
}

interface NetProxyFetchRequest {
  id: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  redirect?: RequestRedirect
}

// Response headers that describe the wire encoding of the original response.
// ses.fetch already decompressed the body, so forwarding these would make the
// reconstructed Response lie about its own content.
const STRIPPED_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding'])

const streams = new Map<string, ProxyStream>()
// Fetches that haven't produced response headers yet, so an abort can reach
// them before a stream entry exists.
const pendingFetches = new Map<string, AbortController>()

function streamKey(senderId: number, id: unknown): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error('net-proxy: invalid stream id')
  }
  return `${senderId}:${id}`
}

function dropStream(key: string, reason?: unknown) {
  const stream = streams.get(key)
  if (!stream) return
  streams.delete(key)
  clearTimeout(stream.idleTimer)
  stream.controller.abort(reason)
  stream.reader.cancel().catch(() => {})
}

function touchIdleTimer(key: string) {
  const stream = streams.get(key)
  if (!stream) return
  clearTimeout(stream.idleTimer)
  stream.idleTimer = setTimeout(() => {
    console.warn('[net-proxy] dropping idle response stream', key)
    dropStream(key, new Error('net-proxy: stream idle timeout'))
  }, IDLE_TIMEOUT_MS)
}

function abortStreamsForSender(senderId: number) {
  for (const key of [...streams.keys()]) {
    if (key.startsWith(`${senderId}:`)) {
      dropStream(key, new Error('net-proxy: renderer gone'))
    }
  }
  for (const [key, controller] of [...pendingFetches.entries()]) {
    if (key.startsWith(`${senderId}:`)) {
      pendingFetches.delete(key)
      controller.abort()
    }
  }
}

function parseRequest(payload: unknown): NetProxyFetchRequest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('net-proxy: invalid request payload')
  }
  const request = payload as NetProxyFetchRequest
  if (typeof request.url !== 'string') {
    throw new Error('net-proxy: invalid request url')
  }
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    throw new Error(`net-proxy: malformed url`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`net-proxy: scheme not allowed: ${url.protocol}`)
  }
  if (request.headers !== undefined && (typeof request.headers !== 'object' || request.headers === null)) {
    throw new Error('net-proxy: invalid request headers')
  }
  if (request.body !== undefined && typeof request.body !== 'string' && !(request.body instanceof Uint8Array)) {
    throw new Error('net-proxy: invalid request body')
  }
  return request
}

export function registerNetProxyHandlers() {
  ipcMain.handle('net-proxy:fetch', async (event, payload: unknown) => {
    const request = parseRequest(payload)
    const key = streamKey(event.sender.id, request.id)
    if (streams.has(key) || pendingFetches.has(key)) {
      throw new Error('net-proxy: duplicate stream id')
    }
    if (streams.size + pendingFetches.size >= MAX_STREAMS) {
      throw new Error('net-proxy: too many concurrent requests')
    }

    const controller = new AbortController()
    pendingFetches.set(key, controller)
    let response: Response
    try {
      response = await session.defaultSession.fetch(request.url, {
        method: request.method || 'GET',
        headers: request.headers,
        // TS lacks BodyInit coverage for cloned Uint8Arrays; runtime accepts them.
        body: request.body as Exclude<RequestInit['body'], ReadableStream>,
        redirect: request.redirect || 'follow',
        // Providers authenticate via headers; never attach session cookies.
        credentials: 'omit',
        signal: controller.signal,
      })
    } finally {
      pendingFetches.delete(key)
    }

    const headers: [string, string][] = []
    response.headers.forEach((value, name) => {
      if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
        headers.push([name, value])
      }
    })

    const body = response.body
    const hasBody = body !== null && !event.sender.isDestroyed()
    if (body !== null && !hasBody) {
      // Renderer disappeared while the fetch was in flight — don't leak the body.
      controller.abort()
    }
    if (hasBody && body) {
      streams.set(key, {
        reader: body.getReader(),
        controller,
        idleTimer: setTimeout(() => {}, 0),
        senderId: event.sender.id,
      })
      touchIdleTimer(key)
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      hasBody,
    }
  })

  ipcMain.handle('net-proxy:read', async (event, id: unknown) => {
    const key = streamKey(event.sender.id, id)
    const stream = streams.get(key)
    if (!stream) {
      throw new Error('net-proxy: unknown stream')
    }
    touchIdleTimer(key)
    let result: ReadableStreamReadResult<Uint8Array>
    try {
      result = await stream.reader.read()
    } catch (error) {
      dropStream(key, error)
      throw error
    }
    if (result.done) {
      streams.delete(key)
      clearTimeout(stream.idleTimer)
      return { done: true }
    }
    touchIdleTimer(key)
    return { done: false, chunk: result.value }
  })

  ipcMain.handle('net-proxy:abort', (event, id: unknown) => {
    const key = streamKey(event.sender.id, id)
    const pending = pendingFetches.get(key)
    if (pending) {
      pendingFetches.delete(key)
      pending.abort()
    }
    dropStream(key, new Error('net-proxy: aborted by renderer'))
  })

  // A destroyed/reloaded renderer can no longer pull or abort its streams.
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => abortStreamsForSender(webContents.id))
    webContents.on('did-start-navigation', (details) => {
      if (!details.isSameDocument) {
        abortStreamsForSender(webContents.id)
      }
    })
  })
}

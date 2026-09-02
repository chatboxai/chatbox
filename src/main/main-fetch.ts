import { net } from 'electron'
import type { FetchImplementation } from '../shared/request/request'

function isHarmonyBuild(): boolean {
  return process.env.CHATBOX_BUILD_TARGET === 'harmony_app'
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function getRequestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}

  const normalized = new Headers(headers)
  const result: Record<string, string> = {}
  normalized.forEach((value, name) => {
    // Chromium owns these transport headers and rejects setting them manually.
    if (name !== 'content-length' && name !== 'host') {
      result[name] = value
    }
  })
  return result
}

async function getRequestBody(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  }
  throw new Error(`HarmonyOS net.request does not support request body type ${body.constructor.name}`)
}

async function harmonyNetRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const body = await getRequestBody(init.body)

  return new Promise((resolve, reject) => {
    const request = net.request({
      url: getRequestUrl(input),
      method: init.method,
      headers: getRequestHeaders(init.headers),
      credentials: init.credentials,
      redirect: init.redirect,
    })

    const abort = () => request.abort()
    if (init.signal?.aborted) {
      abort()
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      reject(error)
      return
    }
    init.signal?.addEventListener('abort', abort, { once: true })

    request.once('error', (error) => {
      init.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    request.once('response', (incoming) => {
      const chunks: Buffer[] = []
      incoming.once('end', () => {
        init.signal?.removeEventListener('abort', abort)
        const headers: [string, string][] = []
        for (const [name, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) {
            headers.push([name, item])
          }
        }
        resolve(
          // Buffer[] -> Uint8Array[]: @types/node types Buffer as Uint8Array<ArrayBufferLike>,
          // which does not line up with the non-generic lib Uint8Array under this tsconfig.
          new Response(new Uint8Array(Buffer.concat(chunks as Uint8Array[])), {
            status: incoming.statusCode,
            statusText: incoming.statusMessage,
            headers,
          })
        )
      })
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.once('error', reject)
      incoming.once('aborted', () => reject(new Error('HarmonyOS network response was aborted')))
    })

    if (body) {
      request.end(body)
    } else {
      request.end()
    }
  })
}

/**
 * Use Electron's Chromium network stack on HarmonyOS.
 *
 * The HarmonyOS Electron port does not currently expose WebAssembly in the
 * Node runtime, while Node's built-in fetch (Undici) needs it to initialize
 * its HTTP parser. The port's net.fetch is also unusable in this runtime, so
 * use the lower-level Chromium-backed net.request API.
 */
export const mainFetch: FetchImplementation = (input, init) => {
  if (isHarmonyBuild()) {
    return harmonyNetRequest(input, init)
  }
  return fetch(input, init)
}

/** Use the default Electron session so Desktop direct requests honor the app's proxy configuration. */
export const desktopSessionFetch: FetchImplementation = (input, init) => {
  return net.fetch(getRequestUrl(input), init)
}

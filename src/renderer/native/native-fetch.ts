import { createNativeResponse } from './stream-http'

/** Fetch-compatible text transport for the native MCP SDK clients. */
export const nativeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  if (!['http:', 'https:'].includes(new URL(request.url).protocol)) {
    throw new TypeError('Native fetch requires an HTTP or HTTPS URL')
  }
  if (request.signal.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError')
  if (request.redirect === 'manual') {
    throw new TypeError('Native fetch does not support manual redirects')
  }
  if (request.credentials === 'omit') {
    throw new TypeError('This native HTTP plugin does not support cookie isolation')
  }
  const headers: Record<string, string> = {}
  request.headers.forEach((value, name) => {
    headers[name] = value
  })
  const body = request.body === null ? undefined : await request.text()
  if (request.signal.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError')
  return createNativeResponse(
    { url: request.url, method: request.method, headers, body, redirect: request.redirect },
    { signal: request.signal }
  )
}

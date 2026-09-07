import { ApiError, MidStreamApiError } from '../errors'

interface ByteTransformController {
  enqueue(chunk: Uint8Array): void
}

interface ByteTransformer {
  transform(chunk: Uint8Array, controller: ByteTransformController): void
  flush(controller: ByteTransformController): void
}

type TransformStreamConstructor = new (transformer: ByteTransformer) => unknown

function getTransformStreamConstructor(): TransformStreamConstructor | undefined {
  return (globalThis as typeof globalThis & { TransformStream?: TransformStreamConstructor }).TransformStream
}

function getResponseBody(response: Response): unknown | null {
  return (response as Response & { body?: unknown | null }).body ?? null
}

function canPipeThrough(body: unknown): body is { pipeThrough(transform: unknown): unknown } {
  return Boolean(body && typeof body === 'object' && 'pipeThrough' in body && typeof body.pipeThrough === 'function')
}

/**
 * Locate the next SSE event boundary. Spec allows both LF (`\n\n`) and CRLF
 * (`\r\n\r\n`) blank-line terminators; pick whichever appears first.
 */
export function findSseFrameBoundary(buffer: string): { index: number; length: number } | null {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf === -1 && lf === -1) {
    return null
  }
  if (crlf === -1) {
    return { index: lf, length: 2 }
  }
  if (lf === -1) {
    return { index: crlf, length: 4 }
  }
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 }
}

/**
 * Google Generative Language SSE may carry an error object mid-stream after HTTP 200:
 *   data: {"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}
 *
 * @ai-sdk/google's chunkSchema has no `error` field, so Zod strips it to `{}` and the
 * transform silently skips the chunk. Wrap the response body to detect that shape and
 * throw a readable ApiError before the SDK swallows it.
 *
 * NOTE: this works around an undocumented implementation detail of @ai-sdk/google
 * (silent Zod stripping of unknown fields). Re-verify the swallow behavior when
 * upgrading that package; if upstream starts surfacing mid-stream error frames
 * itself, this wrapper becomes redundant and can be removed.
 *
 * Complete SSE frames (blank-line terminated, LF or CRLF) are forwarded as they
 * arrive. An incomplete trailing frame is only flushed at stream close: it is
 * still checked for the error shape, but if truncated mid-JSON it passes through
 * raw and the SDK's own parse failure surfaces the problem.
 *
 * Errors detected after content has already been forwarded are thrown as
 * MidStreamApiError so the retry layer does not silently re-run a generation
 * whose partial output already reached the UI (and may already be billed).
 */
export function wrapGeminiStreamDetectingError<TStream>(body: TStream): TStream {
  const TransformStreamImpl = getTransformStreamConstructor()
  if (!TransformStreamImpl || !canPipeThrough(body)) {
    return body
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let forwardedContent = false

  const throwIfGoogleErrorData = (data: string) => {
    if (!data || data === '[DONE]') {
      return
    }
    let parsed: { error?: { message?: unknown; code?: unknown } }
    try {
      parsed = JSON.parse(data) as { error?: { message?: unknown; code?: unknown } }
    } catch {
      return
    }
    if (!parsed?.error || typeof parsed.error !== 'object') {
      return
    }
    const message =
      typeof parsed.error.message === 'string' && parsed.error.message
        ? parsed.error.message
        : 'Upstream Google Generative AI stream error'
    const statusCode = typeof parsed.error.code === 'number' ? parsed.error.code : 503
    if (forwardedContent) {
      throw new MidStreamApiError(message, data, statusCode)
    }
    throw new ApiError(message, data, statusCode)
  }

  // Returns true when the event carried `data:` payload (actual stream content,
  // as opposed to SSE comments/keepalives).
  const processEvent = (event: string): boolean => {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart())
    // No SSE framing: some proxies report application/json and send a plain
    // JSON body, so check the raw payload for the same error shape.
    const payload = dataLines.length > 0 ? dataLines.join('\n') : event.trim()
    if (payload) {
      throwIfGoogleErrorData(payload)
    }
    return dataLines.length > 0
  }

  return body.pipeThrough(
    new TransformStreamImpl({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })

        let boundary = findSseFrameBoundary(buffer)
        while (boundary) {
          const event = buffer.slice(0, boundary.index)
          const separator = buffer.slice(boundary.index, boundary.index + boundary.length)
          buffer = buffer.slice(boundary.index + boundary.length)
          const hadData = processEvent(event)
          controller.enqueue(encoder.encode(event + separator))
          // Comment/keepalive frames carry no model output, so an error right
          // after one is still safe to auto-retry.
          if (hadData) {
            forwardedContent = true
          }
          boundary = findSseFrameBoundary(buffer)
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (!buffer) {
          return
        }
        // Incomplete trailing frame: still check in case the upstream closed
        // without the final blank line.
        processEvent(buffer)
        controller.enqueue(encoder.encode(buffer))
      },
    })
  ) as TStream
}

export function shouldWrapGeminiErrorStream(url: string, response: Response): boolean {
  const body = getResponseBody(response)
  // React Native does not currently expose Web Streams/TransformStream. Keep
  // the response untouched there; a native host may opt into this protection
  // later by installing a compatible Web Streams implementation.
  if (!body || !canPipeThrough(body) || !getTransformStreamConstructor() || !response.ok) {
    return false
  }
  // Scope to Google's streaming REST verb: mid-stream error frames only occur
  // there, and wrapping a non-streaming JSON body would needlessly buffer it
  // until close. The verb alone identifies a Google streaming call — callers
  // (chatboxAIFetch) are responsible for only routing their own gateway URLs here,
  // so no gateway-path knowledge is duplicated in this layer.
  if (!url.includes(':streamGenerateContent')) {
    return false
  }
  const contentType = response.headers.get('content-type') || ''
  // Google SSE is typically text/event-stream; some proxies may report JSON.
  return contentType.includes('text/event-stream') || contentType.includes('application/json')
}

/**
 * If this is a ChatboxAI Google streaming response, return a Response whose body
 * throws ApiError when a mid-stream Google error SSE is observed.
 */
export function maybeWrapGeminiErrorResponse(url: string, response: Response): Response {
  const body = getResponseBody(response)
  if (!shouldWrapGeminiErrorStream(url, response) || !body) {
    return response
  }
  return new Response(wrapGeminiStreamDetectingError(body) as never, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

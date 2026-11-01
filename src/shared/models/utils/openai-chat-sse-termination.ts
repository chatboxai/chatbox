interface ByteTransformController {
  enqueue(chunk: Uint8Array): void
  terminate(): void
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

function findSseFrameBoundary(buffer: string): { index: number; length: number } | null {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf === -1 && lf === -1) return null
  if (crlf === -1) return { index: lf, length: 2 }
  if (lf === -1) return { index: crlf, length: 4 }
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 }
}

function getSseEventData(frame: string): string | undefined {
  const dataLines: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line === 'data') {
      dataLines.push('')
      continue
    }
    if (!line.startsWith('data:')) continue
    const value = line.slice('data:'.length)
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
  }
  return dataLines.length > 0 ? dataLines.join('\n') : undefined
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return input.toString()
}

function isChatCompletionsUrl(input: RequestInfo | URL): boolean {
  const value = getRequestUrl(input)
  try {
    return new URL(value).pathname.replace(/\/+$/, '').endsWith('/chat/completions')
  } catch {
    return value.split(/[?#]/, 1)[0].replace(/\/+$/, '').endsWith('/chat/completions')
  }
}

function hasStreamingRequestBody(init?: RequestInit): boolean {
  if (typeof init?.body !== 'string') return false
  try {
    const body: unknown = JSON.parse(init.body)
    return Boolean(body && typeof body === 'object' && !Array.isArray(body) && 'stream' in body && body.stream === true)
  } catch {
    return false
  }
}

/**
 * OpenAI Chat Completions and compatible APIs define an exact `data: [DONE]`
 * SSE event as the logical end of a streamed response. Close the derived stream
 * at that event so a provider or proxy that leaves the HTTP body open cannot
 * keep generation active indefinitely.
 */
export function wrapOpenAIChatCompletionSse<TStream>(body: TStream): TStream {
  const TransformStreamImpl = getTransformStreamConstructor()
  if (!TransformStreamImpl || !canPipeThrough(body)) return body

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return body.pipeThrough(
    new TransformStreamImpl({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        let boundary = findSseFrameBoundary(buffer)
        while (boundary) {
          const frame = buffer.slice(0, boundary.index)
          const separator = buffer.slice(boundary.index, boundary.index + boundary.length)
          buffer = buffer.slice(boundary.index + boundary.length)
          if (getSseEventData(frame) === '[DONE]') {
            controller.terminate()
            return
          }
          controller.enqueue(encoder.encode(frame + separator))
          boundary = findSseFrameBoundary(buffer)
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (buffer) controller.enqueue(encoder.encode(buffer))
      },
    })
  ) as TStream
}

export function maybeWrapOpenAIChatCompletionSseResponse(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  response: Response
): Response {
  const body = getResponseBody(response)
  if (
    !response.ok ||
    !body ||
    !canPipeThrough(body) ||
    !getTransformStreamConstructor() ||
    !isChatCompletionsUrl(input) ||
    !hasStreamingRequestBody(init)
  ) {
    return response
  }

  return new Response(wrapOpenAIChatCompletionSse(body) as never, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function createOpenAIChatCompletionSseFetch(fetchFunction?: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await (fetchFunction ?? globalThis.fetch)(input, init)
    return maybeWrapOpenAIChatCompletionSseResponse(input, init, response)
  }
}

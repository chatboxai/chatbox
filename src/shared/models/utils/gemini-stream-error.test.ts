import { describe, expect, it, vi } from 'vitest'
import { ApiError, MidStreamApiError } from '../errors'
import {
  findSseFrameBoundary,
  maybeWrapGeminiErrorResponse,
  shouldWrapGeminiErrorStream,
  wrapGeminiStreamDetectingError,
} from './gemini-stream-error'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

describe('wrapGeminiStreamDetectingError', () => {
  it('forwards normal candidate chunks', async () => {
    const payload =
      'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n' +
      'data: {"candidates":[{"finishReason":"STOP"}]}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).resolves.toBe(payload)
  })

  it('throws ApiError when a Google error SSE arrives mid-stream', async () => {
    const ok = 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n'
    const err =
      'data: {"error":{"code":503,"message":"The server was restarted during this response. Please retry to continue.","status":"UNAVAILABLE"}}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ok))
        controller.enqueue(new TextEncoder().encode(err))
        controller.close()
      },
    })

    const wrapped = wrapGeminiStreamDetectingError(input)
    await expect(readAll(wrapped)).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).message).toContain(
        'The server was restarted during this response. Please retry to continue.'
      )
      expect((e as ApiError).statusCode).toBe(503)
      return true
    })
  })

  it('throws MidStreamApiError (non-retryable) when content already streamed before the error', async () => {
    const ok = 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n'
    const err = 'data: {"error":{"code":503,"message":"shutdown","status":"UNAVAILABLE"}}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ok))
        controller.enqueue(new TextEncoder().encode(err))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).rejects.toBeInstanceOf(MidStreamApiError)
  })

  it('throws a plain ApiError (retryable) when the error arrives before any content', async () => {
    const err = 'data: {"error":{"code":503,"message":"unavailable","status":"UNAVAILABLE"}}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(err))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError)
      expect(e).not.toBeInstanceOf(MidStreamApiError)
      return true
    })
  })

  it('still throws a retryable ApiError when only comment/keepalive frames preceded the error', async () => {
    const keepalive = ': ping\n\n'
    const err = 'data: {"error":{"code":503,"message":"unavailable","status":"UNAVAILABLE"}}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(keepalive))
        controller.enqueue(new TextEncoder().encode(err))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError)
      expect(e).not.toBeInstanceOf(MidStreamApiError)
      return true
    })
  })

  it('detects an error in a plain JSON body without SSE framing', async () => {
    const body = '{"error":{"code":503,"message":"proxy reported JSON","status":"UNAVAILABLE"}}'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).message).toContain('proxy reported JSON')
      expect((e as ApiError).statusCode).toBe(503)
      return true
    })
  })

  it('detects error frames split across chunks', async () => {
    const part1 = 'data: {"error":{"code":503,"message":"split '
    const part2 = 'frame","status":"UNAVAILABLE"}}\n\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(part1))
        controller.enqueue(new TextEncoder().encode(part2))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).rejects.toBeInstanceOf(ApiError)
  })

  it('detects error frames delimited by CRLF (spec-compliant SSE)', async () => {
    const ok = 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\r\n\r\n'
    const err =
      'data: {"error":{"code":503,"message":"The server was restarted during this response. Please retry to continue.","status":"UNAVAILABLE"}}\r\n\r\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ok + err))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).message).toContain('The server was restarted during this response')
      return true
    })
  })

  it('forwards CRLF-delimited normal chunks unchanged', async () => {
    const payload =
      'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\r\n\r\n' +
      'data: {"candidates":[{"finishReason":"STOP"}]}\r\n\r\n'
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    })

    await expect(readAll(wrapGeminiStreamDetectingError(input))).resolves.toBe(payload)
  })
})

describe('findSseFrameBoundary', () => {
  it('prefers the earlier of LF and CRLF boundaries', () => {
    expect(findSseFrameBoundary('a\n\nb\r\n\r\n')).toEqual({ index: 1, length: 2 })
    expect(findSseFrameBoundary('a\r\n\r\nb\n\n')).toEqual({ index: 1, length: 4 })
    expect(findSseFrameBoundary('no boundary yet')).toBeNull()
  })
})

describe('shouldWrapGeminiErrorStream / maybeWrapGeminiErrorResponse', () => {
  const streamUrl =
    'https://api.chatboxai.app/gateway/google-ai-studio/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse'

  it('only wraps Google streaming endpoint URLs', () => {
    const res = new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    // Response without body in node may still have body null for string ctor in some envs —
    // construct with a stream body for the positive case.
    const streamRes = new Response(new ReadableStream(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    expect(shouldWrapGeminiErrorStream(streamUrl, streamRes)).toBe(true)
    expect(shouldWrapGeminiErrorStream('https://api.chatboxai.app/gateway/openai/v1/chat/completions', streamRes)).toBe(
      false
    )
    // Non-streaming Google endpoint: wrapping would buffer the whole JSON body.
    expect(
      shouldWrapGeminiErrorStream(
        'https://api.chatboxai.app/gateway/google-ai-studio/v1beta/models/gemini-2.5-pro:generateContent',
        streamRes
      )
    ).toBe(false)
    expect(shouldWrapGeminiErrorStream(streamUrl, res)).toBe(
      // string body still provides a body stream in undici/fetch
      Boolean(res.body)
    )
  })

  it('returns the original response when wrapping is not needed', () => {
    const response = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    expect(maybeWrapGeminiErrorResponse('https://api.chatboxai.app/gateway/openai/v1/x', response)).toBe(response)
  })

  it('returns the original response when the host has no TransformStream', () => {
    const response = new Response(new ReadableStream(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    vi.stubGlobal('TransformStream', undefined)
    try {
      expect(maybeWrapGeminiErrorResponse(streamUrl, response)).toBe(response)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

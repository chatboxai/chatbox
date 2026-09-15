import { describe, expect, it, vi } from 'vitest'
import { createAfetch } from '../request/request'
import { NonReplayableRequestError } from '../models/errors'
import { backgroundStreamFetch, type BackgroundStreamBridge, isBackgroundStreamRequest } from './background-stream'

function mailbox(chunks: string[], error?: string) {
  const bridge: BackgroundStreamBridge = {
    start: vi.fn(async () => {}),
    read: vi.fn(async ({ after }) => ({
      chunks: chunks
        .map((chunk, index) => ({ sequence: index + 1, base64: btoa(chunk) }))
        .filter((chunk) => chunk.sequence > after),
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      done: true,
      error,
    })),
    cancel: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  }
  return bridge
}

describe('native mailbox fetch', () => {
  it('drains retained bytes exactly once and releases terminal state', async () => {
    const bridge = mailbox(['one', 'two', 'three'])
    expect(await (await backgroundStreamFetch(bridge, 'https://example.test')).text()).toBe('onetwothree')
    expect(bridge.start).toHaveBeenCalledTimes(1)
    expect(bridge.release).toHaveBeenCalledTimes(1)
    expect(bridge.cancel).not.toHaveBeenCalled()
  })
  it('preserves split UTF-8 bytes across bridge chunks', async () => {
    const bytes = new TextEncoder().encode('你好🙂')
    const bridge = mailbox(Array.from(bytes, (byte) => String.fromCharCode(byte)))
    expect(await (await backgroundStreamFetch(bridge, 'https://example.test')).text()).toBe('你好🙂')
  })
  it('cancels a request aborted while native start is pending', async () => {
    const bridge = mailbox([])
    let resolveStart: (() => void) | undefined
    bridge.start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve
        })
    )
    const abort = new AbortController()
    const result = backgroundStreamFetch(bridge, 'https://example.test', { signal: abort.signal })
    abort.abort()
    resolveStart?.()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(bridge.cancel).toHaveBeenCalledTimes(1)
    expect(bridge.release).toHaveBeenCalledTimes(1)
    expect(bridge.read).not.toHaveBeenCalled()
  })
  it('does not start a pre-aborted request', async () => {
    const bridge = mailbox([])
    const abort = new AbortController()
    abort.abort()
    await expect(backgroundStreamFetch(bridge, 'https://example.test', { signal: abort.signal })).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(bridge.start).not.toHaveBeenCalled()
  })
  it('reports native terminal failure without replaying the POST', async () => {
    const bridge = mailbox([], 'execution expired')
    const response = await backgroundStreamFetch(bridge, 'https://example.test', { method: 'POST', body: '{}' })
    await expect(response.text()).rejects.toThrow('execution expired')
    expect(bridge.start).toHaveBeenCalledTimes(1)
    expect(bridge.release).toHaveBeenCalledTimes(1)
  })
  it('delivers buffered partial bytes before a terminal error', async () => {
    const bridge = mailbox(['partial'], 'execution expired')
    const reader = (await backgroundStreamFetch(bridge, 'https://example.test')).body?.getReader()
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('partial')
    await expect(reader?.read()).rejects.toThrow('execution expired')
    expect(bridge.release).toHaveBeenCalledTimes(1)
  })
  it('prevents replay when the native bridge disappears after headers', async () => {
    const bridge = mailbox([])
    bridge.read = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, done: false, chunks: [] })
      .mockRejectedValue(new Error('Network request failed'))
    await expect((await backgroundStreamFetch(bridge, 'https://example.test')).text()).rejects.toBeInstanceOf(
      NonReplayableRequestError
    )
    expect(bridge.start).toHaveBeenCalledTimes(1)
  })
  it('preserves the non-replayable failure when bridge cleanup also fails', async () => {
    const bridge = mailbox([])
    bridge.read = vi.fn().mockRejectedValue(new Error('Network request failed'))
    bridge.cancel = vi.fn().mockRejectedValue(new Error('Network request failed'))
    bridge.release = vi.fn().mockRejectedValue(new Error('Network request failed'))
    await expect(backgroundStreamFetch(bridge, 'https://example.test')).rejects.toBeInstanceOf(
      NonReplayableRequestError
    )
    expect(bridge.start).toHaveBeenCalledTimes(1)
  })
  it('drains on foreground resume even when the polling timer is suspended', async () => {
    vi.useFakeTimers()
    try {
      const bridge = mailbox(['complete'])
      vi.mocked(bridge.read).mockResolvedValueOnce({ status: 200, done: false, chunks: [] })
      let resume: (() => void) | undefined
      const unsubscribe = vi.fn()
      const response = await backgroundStreamFetch(bridge, 'https://example.test', {}, (callback) => {
        resume = callback
        return unsubscribe
      })
      const body = response.text()
      await Promise.resolve()
      expect(bridge.read).toHaveBeenCalledTimes(1)
      resume?.()
      expect(await body).toBe('complete')
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('returns HTTP errors to the caller with headers and body intact', async () => {
    const bridge = mailbox(['rate limited'])
    bridge.read = vi.fn(async () => ({
      status: 503,
      done: true,
      headers: { 'retry-after': '30', 'x-request-id': 'request-1' },
      chunks: [{ sequence: 1, base64: btoa('unavailable') }],
    }))
    const response = await backgroundStreamFetch(bridge, 'https://example.test')
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(response.headers.get('x-request-id')).toBe('request-1')
    expect(await response.text()).toBe('unavailable')
    expect(bridge.start).toHaveBeenCalledTimes(1)
    expect(bridge.release).toHaveBeenCalledTimes(1)
  })
  it('preserves Chatbox quota error classification through the shared request adapter', async () => {
    const bridge = mailbox([])
    bridge.read = vi.fn(async () => ({
      status: 403,
      done: true,
      headers: { 'x-request-id': 'quota-request' },
      chunks: [{ sequence: 1, base64: btoa(JSON.stringify({ error: { code: 'token_quota_exhausted' } })) }],
    }))
    const afetch = createAfetch({ type: 'mobile', platform: 'android', os: 'android', version: 'test' }, (url, init) =>
      backgroundStreamFetch(bridge, String(url), init)
    )
    await expect(afetch('https://example.test', {}, { parseChatboxRemoteError: true, retry: 0 })).rejects.toMatchObject(
      {
        code: 10004,
        requestId: 'quota-request',
      }
    )
    expect(bridge.start).toHaveBeenCalledTimes(1)
  })
  it('falls back only when native explicitly declines before dispatch', async () => {
    const bridge = mailbox([])
    bridge.start = vi.fn(async () => ({ started: false }))
    const fallback = vi.fn(async () => new Response('legacy response'))
    expect(await (await backgroundStreamFetch(bridge, 'https://example.test', {}, undefined, fallback)).text()).toBe(
      'legacy response'
    )
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(bridge.read).not.toHaveBeenCalled()
    expect(bridge.cancel).not.toHaveBeenCalled()
    expect(bridge.release).not.toHaveBeenCalled()
  })
  it('does not fall back on ambiguous start failure or post-dispatch failure', async () => {
    const fallback = vi.fn(async () => new Response('duplicate'))
    const rejected = mailbox([])
    rejected.start = vi.fn().mockRejectedValue(new Error('Bridge disconnected'))
    await expect(
      backgroundStreamFetch(rejected, 'https://example.test', {}, undefined, fallback)
    ).rejects.toBeInstanceOf(NonReplayableRequestError)
    const interrupted = mailbox([], 'expired')
    await expect(
      (await backgroundStreamFetch(interrupted, 'https://example.test', {}, undefined, fallback)).text()
    ).rejects.toBeInstanceOf(NonReplayableRequestError)
    expect(fallback).not.toHaveBeenCalled()
  })
  it('does not fall back after cancellation while waiting for admission', async () => {
    const bridge = mailbox([])
    const abort = new AbortController()
    bridge.start = vi.fn(async () => {
      abort.abort()
      return { started: false }
    })
    const fallback = vi.fn(async () => new Response('unexpected'))
    await expect(
      backgroundStreamFetch(bridge, 'https://example.test', { signal: abort.signal }, undefined, fallback)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fallback).not.toHaveBeenCalled()
  })
  it('detects missing cursor data and cancels', async () => {
    const bridge = mailbox([])
    bridge.read = vi.fn(async () => ({ status: 200, done: false, chunks: [{ sequence: 2, base64: btoa('lost') }] }))
    await expect((await backgroundStreamFetch(bridge, 'https://example.test')).text()).rejects.toThrow('cursor gap')
    expect(bridge.cancel).toHaveBeenCalledTimes(1)
  })
  it('keeps concurrent requests isolated', async () => {
    const bridge = mailbox(['hello'])
    const result = await Promise.all([
      backgroundStreamFetch(bridge, 'https://example.test/a'),
      backgroundStreamFetch(bridge, 'https://example.test/b'),
    ])
    expect(await Promise.all(result.map((response) => response.text()))).toEqual(['hello', 'hello'])
    expect(new Set(vi.mocked(bridge.start).mock.calls.map(([options]) => options.id)).size).toBe(2)
  })
  it('continues polling through a duplicate-only batch', async () => {
    const bridge = mailbox(['first', 'second'])
    vi.mocked(bridge.read)
      .mockResolvedValueOnce({ status: 200, done: false, chunks: [{ sequence: 1, base64: btoa('first') }] })
      .mockResolvedValueOnce({ status: 200, done: false, chunks: [{ sequence: 1, base64: btoa('first') }] })
    expect(await (await backgroundStreamFetch(bridge, 'https://example.test')).text()).toBe('firstsecond')
  })
  it('recognizes JSON, SSE Accept and Gemini streams', () => {
    expect(isBackgroundStreamRequest('https://example.test', '{bad')).toBe(false)
    expect(isBackgroundStreamRequest('https://example.test', '{"stream":true}')).toBe(true)
    expect(isBackgroundStreamRequest('https://example.test?alt=sse', '{}')).toBe(true)
    expect(isBackgroundStreamRequest('https://example.test', null, new Headers({ accept: 'text/event-stream' }))).toBe(
      true
    )
  })
})

import { type StartStreamOptions, StreamHttp } from 'capacitor-stream-http'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createNativeReadableStream } from './stream-http'

vi.mock('capacitor-stream-http', () => ({
  StreamHttp: {
    addListener: vi.fn(),
    startStream: vi.fn(),
    cancelStream: vi.fn(),
  },
}))

type EventName = 'chunk' | 'end' | 'error'
type StreamEvent = { id: string; chunk?: string; error?: string }
type StreamListener = (data: StreamEvent) => void
type ListenerRemover = ReturnType<typeof vi.fn<() => Promise<void>>>
type ListenerHandle = { remove: ListenerRemover }

const eventNames: EventName[] = ['chunk', 'end', 'error']
const listeners: Record<EventName, StreamListener[]> = { chunk: [], end: [], error: [] }
const listenerRemovers: ListenerRemover[] = []
const options: StartStreamOptions = {
  url: 'https://example.com/stream',
  method: 'POST',
}

function optionsFor(id: string): StartStreamOptions {
  return { ...options, url: `https://example.com/${id}` }
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function createRemover(): ListenerRemover {
  return vi.fn<() => Promise<void>>(async () => undefined)
}

function emit(eventName: EventName, event: StreamEvent) {
  for (const listener of [...listeners[eventName]]) listener(event)
}

async function waitForNativeStarts(count = 1) {
  await vi.waitFor(() => expect(StreamHttp.startStream).toHaveBeenCalledTimes(count))
}

async function waitForActiveStreams(count = 1) {
  await waitForNativeStarts(count)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function decode(value: Uint8Array | undefined) {
  return new TextDecoder().decode(value)
}

function expectListenersRemovedOnce() {
  expect(listenerRemovers).toHaveLength(3)
  expect(listenerRemovers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
}

describe('createNativeReadableStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listenerRemovers.length = 0
    for (const eventName of eventNames) listeners[eventName].length = 0
    vi.mocked(StreamHttp.addListener).mockImplementation((eventName, listener) => {
      listeners[eventName].push(listener)
      const remove = createRemover()
      listenerRemovers.push(remove)
      return Promise.resolve({ remove })
    })
    vi.mocked(StreamHttp.startStream).mockResolvedValue({ id: 'stream-1' })
    vi.mocked(StreamHttp.cancelStream).mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('enqueues chunks and closes on the native end event', async () => {
    const abortController = new AbortController()
    const removeAbortListener = vi.spyOn(abortController.signal, 'removeEventListener')
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()
    await waitForActiveStreams()

    emit('chunk', { id: 'stream-1', chunk: 'first' })
    emit('end', { id: 'stream-1' })
    abortController.abort()

    expect(decode((await reader.read()).value)).toBe('first')
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expectListenersRemovedOnce()
    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(StreamHttp.cancelStream).not.toHaveBeenCalled()
  })

  test('fails on the native error event and ignores later terminal events', async () => {
    const reader = createNativeReadableStream(options).getReader()
    await waitForActiveStreams()

    emit('error', { id: 'stream-1', error: 'gateway failed' })
    emit('end', { id: 'stream-1' })

    await expect(reader.read()).rejects.toThrow('gateway failed')
    expectListenersRemovedOnce()
    expect(StreamHttp.cancelStream).not.toHaveBeenCalled()
  })

  test('replays early chunks before closing on an early end event', async () => {
    const start = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockReturnValue(start.promise)
    const reader = createNativeReadableStream(options).getReader()
    await waitForNativeStarts()

    emit('chunk', { id: 'stream-1', chunk: 'early' })
    emit('end', { id: 'stream-1' })
    start.resolve({ id: 'stream-1' })

    expect(decode((await reader.read()).value)).toBe('early')
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expectListenersRemovedOnce()
  })

  test('fails on an error emitted before native start returns its ID', async () => {
    const start = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockReturnValue(start.promise)
    const reader = createNativeReadableStream(options).getReader()
    await waitForNativeStarts()

    emit('error', { id: 'stream-1', error: 'invalid URL' })
    start.resolve({ id: 'stream-1' })

    await expect(reader.read()).rejects.toThrow('invalid URL')
    expectListenersRemovedOnce()
  })

  test('ignores events received during listener setup', async () => {
    const chunkListener = createDeferred<ListenerHandle>()
    const chunkRemove = createRemover()
    vi.mocked(StreamHttp.addListener).mockImplementationOnce((eventName, listener) => {
      listeners[eventName].push(listener)
      listenerRemovers.push(chunkRemove)
      return chunkListener.promise
    })
    const reader = createNativeReadableStream(options).getReader()
    await vi.waitFor(() => expect(listeners.chunk).toHaveLength(1))

    emit('chunk', { id: 'stream-1', chunk: 'before start' })
    chunkListener.resolve({ remove: chunkRemove })
    await waitForActiveStreams()
    emit('end', { id: 'stream-1' })

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  test('isolates an active stream from a stream whose native ID is pending', async () => {
    const secondStart = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockResolvedValueOnce({ id: 'stream-a' }).mockReturnValueOnce(secondStart.promise)
    const firstReader = createNativeReadableStream(optionsFor('a')).getReader()
    await waitForActiveStreams()
    const secondReader = createNativeReadableStream(optionsFor('b')).getReader()
    await waitForNativeStarts(2)

    emit('chunk', { id: 'stream-a', chunk: 'active' })
    emit('chunk', { id: 'stream-b', chunk: 'pending' })
    emit('end', { id: 'stream-b' })
    secondStart.resolve({ id: 'stream-b' })
    emit('end', { id: 'stream-a' })

    expect(decode((await firstReader.read()).value)).toBe('active')
    await expect(firstReader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(decode((await secondReader.read()).value)).toBe('pending')
    await expect(secondReader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  test('isolates two pending streams whose IDs resolve in reverse order', async () => {
    const firstStart = createDeferred<{ id: string }>()
    const secondStart = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockImplementation((startOptions) =>
      startOptions.url.endsWith('/a') ? firstStart.promise : secondStart.promise
    )
    const firstReader = createNativeReadableStream(optionsFor('a')).getReader()
    const secondReader = createNativeReadableStream(optionsFor('b')).getReader()
    await waitForNativeStarts(2)

    emit('chunk', { id: 'stream-a', chunk: 'first' })
    emit('end', { id: 'stream-a' })
    emit('chunk', { id: 'stream-b', chunk: 'second' })
    emit('end', { id: 'stream-b' })
    secondStart.resolve({ id: 'stream-b' })

    expect(decode((await secondReader.read()).value)).toBe('second')
    await expect(secondReader.read()).resolves.toEqual({ done: true, value: undefined })

    firstStart.resolve({ id: 'stream-a' })
    expect(decode((await firstReader.read()).value)).toBe('first')
    await expect(firstReader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  test.each([
    ['chunk', 1],
    ['end', 2],
    ['error', 3],
  ] as const)('stops listener setup after abort while the %s listener is pending', async (pendingEvent, callCount) => {
    const listener = createDeferred<ListenerHandle>()
    const pendingRemove = createRemover()
    vi.mocked(StreamHttp.addListener).mockImplementation((eventName, callback) => {
      listeners[eventName].push(callback)
      const remove = eventName === pendingEvent ? pendingRemove : createRemover()
      listenerRemovers.push(remove)
      return eventName === pendingEvent ? listener.promise : Promise.resolve({ remove })
    })
    const abortController = new AbortController()
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()
    await vi.waitFor(() => expect(StreamHttp.addListener).toHaveBeenCalledTimes(callCount))

    abortController.abort(123_456)
    const readResult = expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    listener.resolve({ remove: pendingRemove })

    await readResult
    await vi.waitFor(() => expect(pendingRemove).toHaveBeenCalledOnce())
    expect(StreamHttp.addListener).toHaveBeenCalledTimes(callCount)
    expect(StreamHttp.startStream).not.toHaveBeenCalled()
    expect(listenerRemovers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })

  test('rejects an already-aborted stream before native setup', async () => {
    const abortController = new AbortController()
    abortController.abort(123_456)
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()

    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    expect(StreamHttp.addListener).not.toHaveBeenCalled()
    expect(StreamHttp.startStream).not.toHaveBeenCalled()
    expect(StreamHttp.cancelStream).not.toHaveBeenCalled()
  })

  test('cancels exactly once when abort precedes the native ID', async () => {
    const start = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockReturnValue(start.promise)
    const abortController = new AbortController()
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()
    await waitForNativeStarts()

    const read = reader.read()
    abortController.abort(123_456)
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    start.resolve({ id: 'stream-1' })

    await vi.waitFor(() => expect(StreamHttp.cancelStream).toHaveBeenCalledWith({ id: 'stream-1' }))
    expect(StreamHttp.cancelStream).toHaveBeenCalledOnce()
    expectListenersRemovedOnce()
  })

  test('aborts a locked active stream through its native request', async () => {
    const abortController = new AbortController()
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()
    await waitForActiveStreams()

    const read = reader.read()
    abortController.abort(123_456)
    emit('end', { id: 'stream-1' })

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(StreamHttp.cancelStream).toHaveBeenCalledWith({ id: 'stream-1' }))
    expect(StreamHttp.cancelStream).toHaveBeenCalledOnce()
    expectListenersRemovedOnce()
  })

  test('waits for a pending native ID when the reader is cancelled', async () => {
    const start = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockReturnValue(start.promise)
    const reader = createNativeReadableStream(options).getReader()
    await waitForNativeStarts()

    const cancel = reader.cancel()
    start.resolve({ id: 'stream-1' })
    await cancel

    expect(StreamHttp.cancelStream).toHaveBeenCalledOnce()
    expect(StreamHttp.cancelStream).toHaveBeenCalledWith({ id: 'stream-1' })
    expectListenersRemovedOnce()
  })

  test('propagates native cancellation failure to reader cancellation', async () => {
    vi.mocked(StreamHttp.cancelStream).mockRejectedValue(new Error('cancel failed'))
    const reader = createNativeReadableStream(options).getReader()
    await waitForActiveStreams()

    await expect(reader.cancel()).rejects.toThrow('cancel failed')
    expect(StreamHttp.cancelStream).toHaveBeenCalledOnce()
    expectListenersRemovedOnce()
  })

  test('logs native cancellation failure after abort while settling the reader', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(StreamHttp.cancelStream).mockRejectedValue(new Error('cancel failed'))
    const abortController = new AbortController()
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()
    await waitForActiveStreams()

    abortController.abort()

    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to cancel native stream', expect.any(Error)))
  })

  test('settles once when native start rejects after abort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const start = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockReturnValue(start.promise)
    const abortController = new AbortController()
    const reader = createNativeReadableStream(options, { signal: abortController.signal }).getReader()
    await waitForNativeStarts()

    abortController.abort()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    start.reject(new Error('start failed'))

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Failed to cancel native stream', expect.any(Error)))
    expectListenersRemovedOnce()
    expect(StreamHttp.cancelStream).not.toHaveBeenCalled()
  })

  test('fails the reader and cleans up when native start fails', async () => {
    const start = createDeferred<{ id: string }>()
    vi.mocked(StreamHttp.startStream).mockReturnValue(start.promise)
    const reader = createNativeReadableStream(options).getReader()
    await waitForNativeStarts()

    start.reject(new Error('start failed'))

    await expect(reader.read()).rejects.toThrow('start failed')
    expectListenersRemovedOnce()
  })

  test('continues cleanup when listener removers fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const asyncFailureRemove = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('async remove failed')))
    const syncFailureRemove = vi.fn<() => Promise<void>>(() => {
      throw new Error('sync remove failed')
    })
    const successfulRemove = createRemover()
    const removers = [asyncFailureRemove, syncFailureRemove, successfulRemove]
    vi.mocked(StreamHttp.addListener).mockImplementation((eventName, listener) => {
      listeners[eventName].push(listener)
      const remove = removers[eventNames.indexOf(eventName)]
      listenerRemovers.push(remove)
      return Promise.resolve({ remove })
    })
    const reader = createNativeReadableStream(options).getReader()
    await waitForActiveStreams()

    emit('end', { id: 'stream-1' })

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expectListenersRemovedOnce()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
    expect(warn).toHaveBeenCalledWith('Failed to remove native stream listener', expect.any(Error))
  })
})

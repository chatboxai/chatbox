import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftTokenizationWorkerRequest, DraftTokenizationWorkerResponse } from '../draft-tokenizer-worker-handler'

class MockWorker {
  static instances: MockWorker[] = []

  onmessage: ((event: MessageEvent<DraftTokenizationWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postedMessages: DraftTokenizationWorkerRequest[] = []
  terminateCalls = 0

  constructor() {
    MockWorker.instances.push(this)
  }

  postMessage(message: DraftTokenizationWorkerRequest): void {
    this.postedMessages.push(message)
  }

  terminate(): void {
    this.terminateCalls += 1
  }

  get lastRequest(): DraftTokenizationWorkerRequest {
    return this.postedMessages[this.postedMessages.length - 1]
  }

  respond(id: number, tokens: number): void {
    this.onmessage?.(new MessageEvent('message', { data: { id, tokens } }))
  }

  respondError(id: number, error: string): void {
    this.onmessage?.(new MessageEvent('message', { data: { id, error } }))
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

async function loadClient() {
  vi.resetModules()
  return await import('../draft-tokenizer-worker-client')
}

describe('draft tokenizer worker client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', MockWorker)
  })

  afterEach(() => {
    MockWorker.instances = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('posts one request at a time and drains the queue in order on one worker', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    const first = tokenizeDraftOffMainThread('long draft', 'deepseek', new AbortController().signal)
    const second = tokenizeDraftOffMainThread('other draft', 'default', new AbortController().signal)
    expect(MockWorker.instances).toHaveLength(1)
    const worker = MockWorker.instances[0]
    expect(worker.postedMessages).toHaveLength(1)
    expect(worker.lastRequest).toMatchObject({ text: 'long draft', tokenizerType: 'deepseek' })

    worker.respond(worker.lastRequest.id, 42)
    await expect(first).resolves.toBe(42)

    expect(worker.postedMessages).toHaveLength(2)
    expect(worker.lastRequest).toMatchObject({ text: 'other draft', tokenizerType: 'default' })
    worker.respond(worker.lastRequest.id, 7)
    await expect(second).resolves.toBe(7)

    expect(worker.terminateCalls).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('serves an interactive request before earlier low-priority ones', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    const active = tokenizeDraftOffMainThread('active', 'default', new AbortController().signal)
    const background = tokenizeDraftOffMainThread('background', 'default', new AbortController().signal, {
      lowPriority: true,
    })
    const interactive = tokenizeDraftOffMainThread('interactive', 'default', new AbortController().signal)

    const worker = MockWorker.instances[0]
    worker.respond(worker.lastRequest.id, 1)
    expect(worker.lastRequest.text).toBe('interactive')
    worker.respond(worker.lastRequest.id, 2)
    expect(worker.lastRequest.text).toBe('background')
    worker.respond(worker.lastRequest.id, 3)

    await expect(active).resolves.toBe(1)
    await expect(interactive).resolves.toBe(2)
    await expect(background).resolves.toBe(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preempts an active low-priority encode when an interactive request arrives', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    const background = tokenizeDraftOffMainThread('background', 'default', new AbortController().signal, {
      lowPriority: true,
    })
    const worker = MockWorker.instances[0]
    expect(worker.lastRequest.text).toBe('background')

    const interactive = tokenizeDraftOffMainThread('interactive', 'default', new AbortController().signal)

    // The background encode cannot be recalled, so its worker is dropped and
    // the interactive request goes straight out on a fresh one.
    expect(worker.terminateCalls).toBe(1)
    expect(MockWorker.instances).toHaveLength(2)
    const respawned = MockWorker.instances[1]
    expect(respawned.lastRequest.text).toBe('interactive')

    respawned.respond(respawned.lastRequest.id, 2)
    await expect(interactive).resolves.toBe(2)

    // The preempted request stayed pending and was re-posted afterwards.
    expect(respawned.lastRequest.text).toBe('background')
    respawned.respond(respawned.lastRequest.id, 3)
    await expect(background).resolves.toBe(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not preempt for another low-priority request', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    const first = tokenizeDraftOffMainThread('bg-1', 'default', new AbortController().signal, { lowPriority: true })
    const second = tokenizeDraftOffMainThread('bg-2', 'default', new AbortController().signal, { lowPriority: true })

    const worker = MockWorker.instances[0]
    expect(worker.terminateCalls).toBe(0)
    expect(worker.postedMessages).toHaveLength(1)

    worker.respond(worker.lastRequest.id, 1)
    await expect(first).resolves.toBe(1)
    expect(MockWorker.instances).toHaveLength(1)
    expect(worker.lastRequest.text).toBe('bg-2')
    worker.respond(worker.lastRequest.id, 2)
    await expect(second).resolves.toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps posted work bounded during an edit burst and completes the latest request', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    // Repeatedly supersede the draft the way the hook does: abort the previous
    // request, then issue the next one.
    let controller = new AbortController()
    const results: Promise<number>[] = [tokenizeDraftOffMainThread('draft 0', 'default', controller.signal)]
    for (let edit = 1; edit <= 9; edit++) {
      controller.abort()
      controller = new AbortController()
      results.push(tokenizeDraftOffMainThread(`draft ${edit}`, 'default', controller.signal))
    }

    const worker = MockWorker.instances[0]
    // Only the first request ever reached the worker; the aborted waiters
    // were dropped without being posted.
    expect(worker.postedMessages).toHaveLength(1)
    for (const stale of results.slice(0, 9)) {
      await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    }

    worker.respond(worker.postedMessages[0].id, 11)
    expect(worker.postedMessages).toHaveLength(2)
    expect(worker.lastRequest.text).toBe('draft 9')
    worker.respond(worker.lastRequest.id, 999)
    await expect(results[9]).resolves.toBe(999)
    expect(worker.terminateCalls).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects on abort, keeps the worker, and drops the stale response', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()
    const controller = new AbortController()

    const result = tokenizeDraftOffMainThread('long draft', 'default', controller.signal)
    const worker = MockWorker.instances[0]
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminateCalls).toBe(0)
    // The timeout stays armed while the stale encode occupies the worker.
    expect(vi.getTimerCount()).toBe(1)

    const next = tokenizeDraftOffMainThread('long draft', 'default', new AbortController().signal)
    expect(worker.postedMessages).toHaveLength(1)
    worker.respond(worker.postedMessages[0].id, 42)
    expect(vi.getTimerCount()).toBe(1)

    expect(MockWorker.instances).toHaveLength(1)
    expect(worker.postedMessages).toHaveLength(2)
    worker.respond(worker.lastRequest.id, 5)
    await expect(next).resolves.toBe(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tears down a worker hung on an aborted encode and serves the waiting request on a fresh one', async () => {
    const { DRAFT_TOKENIZATION_WORKER_TIMEOUT_MS, tokenizeDraftOffMainThread } = await loadClient()
    const controller = new AbortController()

    const stale = tokenizeDraftOffMainThread('stale draft', 'default', controller.signal)
    controller.abort()
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })

    const next = tokenizeDraftOffMainThread('new draft', 'default', new AbortController().signal)
    const worker = MockWorker.instances[0]
    expect(worker.postedMessages).toHaveLength(1)

    vi.advanceTimersByTime(DRAFT_TOKENIZATION_WORKER_TIMEOUT_MS)
    expect(worker.terminateCalls).toBe(1)
    expect(MockWorker.instances).toHaveLength(2)
    const respawned = MockWorker.instances[1]
    expect(respawned.lastRequest.text).toBe('new draft')
    respawned.respond(respawned.lastRequest.id, 8)
    await expect(next).resolves.toBe(8)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a per-request failure without tearing the worker down', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    const result = tokenizeDraftOffMainThread('long draft', 'default', new AbortController().signal)
    const worker = MockWorker.instances[0]
    worker.respondError(worker.lastRequest.id, 'tokenizer failed')

    await expect(result).rejects.toThrow('tokenizer failed')
    expect(worker.terminateCalls).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails only the posted request on a worker error and respawns for the waiting one', async () => {
    const { tokenizeDraftOffMainThread } = await loadClient()

    const first = tokenizeDraftOffMainThread('one', 'default', new AbortController().signal)
    const second = tokenizeDraftOffMainThread('two', 'default', new AbortController().signal)
    const worker = MockWorker.instances[0]
    worker.fail('worker failed')

    await expect(first).rejects.toThrow('worker failed')
    expect(worker.terminateCalls).toBe(1)

    expect(MockWorker.instances).toHaveLength(2)
    const respawned = MockWorker.instances[1]
    expect(respawned.lastRequest.text).toBe('two')
    respawned.respond(respawned.lastRequest.id, 9)
    await expect(second).resolves.toBe(9)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out, terminates, and respawns for the next request', async () => {
    const { DRAFT_TOKENIZATION_WORKER_TIMEOUT_MS, tokenizeDraftOffMainThread } = await loadClient()

    const result = tokenizeDraftOffMainThread('long draft', 'default', new AbortController().signal)
    const worker = MockWorker.instances[0]
    const rejection = expect(result).rejects.toThrow('Draft tokenization worker timed out')

    vi.advanceTimersByTime(DRAFT_TOKENIZATION_WORKER_TIMEOUT_MS)
    await rejection

    expect(worker.terminateCalls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
    worker.respond(worker.lastRequest.id, 42)

    void tokenizeDraftOffMainThread('long draft', 'default', new AbortController().signal)
    expect(MockWorker.instances).toHaveLength(2)
  })

  it('rejects the request when sending fails and keeps the worker for later calls', async () => {
    const postMessageError = new Error('postMessage failed')
    class ThrowingWorker extends MockWorker {
      override postMessage(message: DraftTokenizationWorkerRequest): void {
        if (message.text === 'bad') throw postMessageError
        super.postMessage(message)
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker)
    const { tokenizeDraftOffMainThread } = await loadClient()

    const bad = tokenizeDraftOffMainThread('bad', 'default', new AbortController().signal)
    const good = tokenizeDraftOffMainThread('good', 'default', new AbortController().signal)
    await expect(bad).rejects.toBe(postMessageError)
    expect(vi.getTimerCount()).toBe(1)

    // The failed send did not stall the queue: the next request went out on
    // the same worker instance.
    expect(MockWorker.instances).toHaveLength(1)
    const worker = MockWorker.instances[0]
    worker.respond(worker.lastRequest.id, 3)
    await expect(good).resolves.toBe(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects when the runtime cannot create a worker and retries on the next call', async () => {
    let attempts = 0
    const workerError = new Error('Worker is unavailable')
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          attempts += 1
          throw workerError
        }
      }
    )
    const { tokenizeDraftOffMainThread } = await loadClient()

    await expect(tokenizeDraftOffMainThread('long draft', 'default', new AbortController().signal)).rejects.toBe(
      workerError
    )
    await expect(tokenizeDraftOffMainThread('long draft', 'default', new AbortController().signal)).rejects.toBe(
      workerError
    )
    expect(attempts).toBe(2)
  })
})

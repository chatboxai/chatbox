import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenerationRuntimeStore } from './runtime-store'

describe('GenerationRuntimeStore', () => {
  const stores: GenerationRuntimeStore[] = []

  function createStore(): GenerationRuntimeStore {
    const store = new GenerationRuntimeStore()
    stores.push(store)
    return store
  }

  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose()
  })

  it('starts each runtime in the preparing phase', () => {
    const store = createStore()
    const state = store.start('session-1', 'message-1')

    expect(state).toMatchObject({
      sessionId: 'session-1',
      messageId: 'message-1',
      phase: 'preparing',
    })
    expect(state.abortController.signal.aborted).toBe(false)
    expect(store.get('session-1')).toBe(state)
  })

  it('lists active message ids scoped to the session', () => {
    const store = createStore()
    store.start('session-1', 'message-1')
    store.start('session-1', 'message-2')
    store.start('session-2', 'message-3')

    expect(store.getActiveMessageIds('session-1')).toEqual(new Set(['message-1', 'message-2']))
    expect(store.getActiveMessageIds('session-2')).toEqual(new Set(['message-3']))
    expect(store.getActiveMessageIds('session-3')).toEqual(new Set())
  })

  it('transitions only the matching message runtime', () => {
    const store = createStore()
    store.start('session-1', 'message-1')

    expect(store.setPhase('session-1', 'stale-message', 'streaming')).toBeUndefined()
    expect(store.get('session-1')?.phase).toBe('preparing')
    expect(store.setPhase('session-1', 'message-1', 'streaming')?.phase).toBe('streaming')
  })

  it('aborts and removes the matching runtime', () => {
    const store = createStore()
    const state = store.start('session-1', 'message-1')
    const abortListener = vi.fn()
    state.abortController.signal.addEventListener('abort', abortListener)

    expect(store.abort('session-1', 'stale-message')).toBe(false)
    expect(state.abortController.signal.aborted).toBe(false)
    expect(store.abort('session-1', 'message-1', 123_456)).toBe(true)
    expect(state.abortController.signal.aborted).toBe(true)
    expect(state.abortController.signal.reason).toBe(123_456)
    expect(abortListener).toHaveBeenCalledOnce()
    expect(store.get('session-1')).toBeUndefined()
  })

  it('retains a stopping runtime until terminal persistence settles', () => {
    const store = createStore()
    const active = store.start('session-1', 'message-1')

    const stopping = store.beginStop('session-1', 'message-1', 123_456, active)

    expect(stopping).toMatchObject({ phase: 'stopping' })
    expect(active.abortController.signal.aborted).toBe(true)
    expect(active.abortController.signal.reason).toBe(123_456)
    expect(store.get('session-1', 'message-1')).toBe(stopping)
    expect(store.setPhase('session-1', 'message-1', 'streaming', active)).toBe(stopping)
    expect(store.finishActive('session-1', 'message-1', active)).toBe(false)
    expect(store.clear('session-1', 'message-1', stopping)).toBe(true)
    expect(store.get('session-1')).toBeUndefined()
  })

  it('carries an abort request across the placeholder window exactly once', () => {
    const store = createStore()

    store.requestAbort('session-1', 'message-1', 123_456)
    const cancelled = store.start('session-1', 'message-1')
    const retry = store.start('session-1', 'message-1')

    expect(cancelled.abortController.signal.aborted).toBe(true)
    expect(cancelled.abortController.signal.reason).toBe(123_456)
    expect(retry.abortController.signal.aborted).toBe(false)
  })

  it('clears pending abort requests with the rest of a Session runtime', () => {
    const store = createStore()

    store.requestAbort('session-1', 'message-1', 'stopped')
    expect(store.abort('session-1')).toBe(true)

    expect(store.start('session-1', 'message-1').abortController.signal.aborted).toBe(false)
  })

  it('discards active controls and aborts one late registration for a removed message', () => {
    const store = createStore()
    const active = store.start('session-1', 'active')
    store.requestAbort('session-1', 'pending', 'stopped')

    expect(store.discard('session-1', 'active', 'fork-deleted')).toBe(true)
    expect(store.discard('session-1', 'pending', 'fork-deleted')).toBe(true)

    expect(active.abortController.signal.aborted).toBe(true)
    expect(active.abortController.signal.reason).toBe('fork-deleted')
    expect(store.start('session-1', 'active').abortController.signal.aborted).toBe(false)
    expect(store.start('session-1', 'pending').abortController.signal).toMatchObject({
      aborted: true,
      reason: 'fork-deleted',
    })
    expect(store.start('session-1', 'pending').abortController.signal.aborted).toBe(false)
  })

  it('finishes active runtimes but preserves paused runtimes', () => {
    const store = createStore()
    store.start('session-1', 'message-1')
    expect(store.finishActive('session-1', 'message-1')).toBe(true)
    expect(store.get('session-1')).toBeUndefined()

    store.start('session-1', 'message-2')
    store.setPhase('session-1', 'message-2', 'paused')
    expect(store.finishActive('session-1', 'message-2')).toBe(false)
    expect(store.get('session-1')?.phase).toBe('paused')
    expect(store.clear('session-1', 'message-2')).toBe(true)
    expect(store.get('session-1')).toBeUndefined()
  })

  it('retargets a live runtime to a continuation message, keeping its controller', () => {
    const store = createStore()
    const state = store.start('session-1', 'segment-1')
    store.setPhase('session-1', 'segment-1', 'streaming', state)

    const next = store.retarget('session-1', 'segment-1', 'continuation-1', state)

    expect(next).toMatchObject({ messageId: 'continuation-1', phase: 'streaming' })
    expect(next?.abortController).toBe(state.abortController)
    expect(store.get('session-1', 'segment-1')).toBeUndefined()
    expect(store.get('session-1', 'continuation-1')?.abortController).toBe(state.abortController)

    // Stop targeting the continuation id aborts the shared run.
    store.requestAbort('session-1', 'continuation-1', 42)
    expect(state.abortController.signal.aborted).toBe(true)
  })

  it('leaves a stale-id Stop as a pending abort instead of aborting the moved run', () => {
    const store = createStore()
    const state = store.start('session-1', 'segment-1')
    store.retarget('session-1', 'segment-1', 'continuation-1', state)

    // A Stop click against the finalized segment's id (stale UI) must not
    // abort the continuation run; it is recorded for the placeholder window
    // like any abort against an unregistered id.
    store.requestAbort('session-1', 'segment-1', 7)
    expect(state.abortController.signal.aborted).toBe(false)
    expect(store.get('session-1', 'continuation-1')?.phase).toBe('preparing')
  })

  it('keeps a stopping runtime on the id owned by the Stop operation', () => {
    const store = createStore()
    const state = store.start('session-1', 'segment-1')
    const stopping = store.beginStop('session-1', 'segment-1', 7, state)

    expect(store.retarget('session-1', 'segment-1', 'continuation-1', state)).toBeUndefined()
    expect(store.get('session-1', 'segment-1')).toBe(stopping)
    expect(store.get('session-1', 'continuation-1')).toBeUndefined()

    expect(store.clear('session-1', 'segment-1', stopping)).toBe(true)
  })

  it('keeps concurrent alternative-message runtimes in the same Session', () => {
    const store = createStore()
    const first = store.start('session-1', 'message-1')
    const second = store.start('session-1', 'message-2')

    expect(first.abortController.signal.aborted).toBe(false)
    expect(store.get('session-1', 'message-1')).toBe(first)
    expect(store.get('session-1')).toBe(second)
    expect(store.list('session-1')).toEqual([first, second])
    expect(store.finishActive('session-1', 'message-1', first)).toBe(true)
    expect(store.get('session-1', 'message-2')).toBe(second)
  })

  it('replaces the same message runtime and ignores its stale completion', () => {
    const store = createStore()
    const first = store.start('session-1', 'message-1')
    const replacement = store.start('session-1', 'message-1')

    expect(first.abortController.signal.aborted).toBe(true)
    expect(store.finishActive('session-1', 'message-1', first)).toBe(false)
    expect(store.get('session-1', 'message-1')).toBe(replacement)
  })

  it('isolates runtimes by session', () => {
    const store = createStore()
    const first = store.start('session-1', 'message-1')
    const second = store.start('session-2', 'message-2')

    expect(store.get('session-1')).toBe(first)
    expect(store.get('session-2')).toBe(second)
  })

  it('tracks unsettled stream drains per session until they resolve', async () => {
    const store = createStore()
    let finishDrain: (() => void) | undefined
    const drain = new Promise<void>((resolve) => {
      finishDrain = resolve
    })

    store.registerUnsettledStreamDrain('session-1', drain)

    const barrier = store.waitForUnsettledStreamDrains('session-1')
    expect(barrier).toBeInstanceOf(Promise)
    expect(store.waitForUnsettledStreamDrains('session-2')).toBeUndefined()

    finishDrain?.()
    await barrier
    await Promise.resolve()
    expect(store.waitForUnsettledStreamDrains('session-1')).toBeUndefined()
  })

  it('notifies React bindings only for successful state changes', () => {
    const store = createStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.start('session-1', 'message-1')
    store.setPhase('session-1', 'stale-message', 'streaming')
    store.setPhase('session-1', 'message-1', 'streaming')
    store.clear('session-1', 'message-1')

    expect(listener).toHaveBeenCalledTimes(3)
    expect(store.getVersion()).toBe(3)
    unsubscribe()
    store.start('session-2', 'message-2')
    expect(listener).toHaveBeenCalledTimes(3)
    expect(store.getVersion()).toBe(4)
  })

  it('aborts all retained controllers when disposed', () => {
    const store = createStore()
    const first = store.start('session-1', 'message-1')
    const second = store.start('session-2', 'message-2')

    store.dispose()

    expect(first.abortController.signal.aborted).toBe(true)
    expect(second.abortController.signal.aborted).toBe(true)
    expect(store.get('session-1')).toBeUndefined()
    expect(store.get('session-2')).toBeUndefined()
  })
})

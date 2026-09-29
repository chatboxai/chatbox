import { describe, expect, it, vi } from 'vitest'
import { GenerationRuntimeStore, type GenerationRuntimeState } from '../../generation/runtime-store'
import type { Session } from '../../types'
import { createGenerationStopRecovery } from './generation-stop-recovery'
import { SessionEventBus, type SessionEventListener } from './session-events'

const session = (generating: boolean): Session => ({
  id: 'session',
  name: 'Session',
  messages: [{ id: 'reply', role: 'assistant', contentParts: [], generating }],
})

function harness(all = true) {
  const runtime = new GenerationRuntimeStore()
  const events = new SessionEventBus()
  const listeners = new Set<SessionEventListener>()
  const subscribe = events.subscribe.bind(events)
  vi.spyOn(events, 'subscribe').mockImplementation((listener) => {
    listeners.add(listener)
    const unsubscribe = subscribe(listener)
    return () => {
      listeners.delete(listener)
      unsubscribe()
    }
  })
  const active = runtime.start('session', 'reply')
  const stopGate = all ? runtime.beginSessionStop('session') : undefined
  const stoppingRuntimes = new Map<string, GenerationRuntimeState>()
  const preparationBarrier = runtime.waitForGenerationPreparationLeases('session')
  const create = () =>
    createGenerationStopRecovery({
      runtime,
      events,
      sessionId: 'session',
      targetMessageId: all ? undefined : 'reply',
      stopGate,
      preparationBarrier,
      stoppingRuntimes,
    })
  const recovery = create()
  const stopping = runtime.beginStop('session', 'reply', undefined, active)
  if (stopping) stoppingRuntimes.set('reply', stopping)
  const publish = (value: Session) =>
    events.publish({ type: 'session-updated', session: value, meta: null, preserveCachedGeneratingMessages: false })
  return { runtime, events, listeners, stopGate, stoppingRuntimes, create, recovery, publish }
}

describe('durable generation stop recovery', () => {
  it.each(['before', 'after'] as const)(
    'releases terminal runtimes when persistence finishes %s Stop fails',
    async (timing) => {
      const h = harness()
      if (timing === 'before') await h.publish(session(false))
      expect(h.runtime.get('session', 'reply')?.phase).toBe('stopping')
      h.recovery.recover()
      if (timing === 'after') await h.publish(session(false))
      expect(h.runtime.get('session', 'reply')).toBeUndefined()
      expect(h.runtime.isSessionStopRequested('session')).toBe(false)
      expect(h.listeners.size).toBe(0)
      await h.runtime.waitForIdle()
    }
  )

  it('retains a failed stop until durable terminal data arrives', async () => {
    const h = harness()
    h.recovery.recover()
    await h.publish(session(true))
    expect(h.runtime.get('session', 'reply')?.phase).toBe('stopping')
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    expect(h.listeners.size).toBe(1)
    h.runtime.dispose()
    expect(h.listeners.size).toBe(0)
  })

  it('waits for every candidate, including a stored branch', async () => {
    const h = harness(false)
    const second = h.runtime.start('session', 'second')
    h.recovery.dispose()
    const stopGate = h.runtime.beginSessionStop('session')
    const stopping = h.runtime.beginStop('session', 'second', undefined, second)
    if (stopping) h.stoppingRuntimes.set('second', stopping)
    const recovery = createGenerationStopRecovery({
      runtime: h.runtime,
      events: h.events,
      sessionId: 'session',
      stopGate,
      stoppingRuntimes: h.stoppingRuntimes,
    })
    recovery.recover()
    const firstTerminal: Session = {
      ...session(false),
      messageForksHash: {
        reply: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'current', messages: [] },
            { id: 'stored', messages: [{ id: 'second', role: 'assistant', generating: true, contentParts: [] }] },
          ],
        },
      },
    }
    await h.publish(firstTerminal)
    expect(h.runtime.get('session', 'reply')).toBeUndefined()
    expect(h.runtime.get('session', 'second')?.phase).toBe('stopping')
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    await h.publish({
      ...firstTerminal,
      messageForksHash: {
        reply: {
          position: 0,
          createdAt: 1,
          lists: [
            { id: 'current', messages: [] },
            { id: 'stored', messages: [{ id: 'second', role: 'assistant', generating: false, contentParts: [] }] },
          ],
        },
      },
    })
    expect(h.runtime.list('session')).toHaveLength(0)
    expect(h.runtime.isSessionStopRequested('session')).toBe(false)
  })

  it('keeps admission closed until preparation has finished, and idle waits for stream drains', async () => {
    const h = harness(false)
    h.recovery.dispose()
    const lease = h.runtime.acquireGenerationPreparationLease('session')!
    const stopGate = h.runtime.beginSessionStop('session')
    const recovery = createGenerationStopRecovery({
      runtime: h.runtime,
      events: h.events,
      sessionId: 'session',
      stopGate,
      stoppingRuntimes: h.stoppingRuntimes,
      preparationBarrier: h.runtime.waitForGenerationPreparationLeases('session'),
    })
    let finishDrain = () => {}
    const drain = new Promise<void>((resolve) => {
      finishDrain = resolve
    })
    h.runtime.registerUnsettledStreamDrain('session', drain)
    const idle = vi.fn()
    const idlePromise = h.runtime.waitForIdle().then(idle)
    recovery.recover()
    await h.publish(session(false))
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    expect(idle).not.toHaveBeenCalled()
    h.runtime.releaseGenerationPreparationLease(lease)
    await Promise.resolve()
    expect(h.runtime.isSessionStopRequested('session')).toBe(false)
    expect(idle).not.toHaveBeenCalled()
    finishDrain()
    await idlePromise
    expect(h.listeners.size).toBe(0)
  })

  it('replaces failed single-stop observers on retry and removes them on success', () => {
    const h = harness(false)
    h.recovery.recover()
    for (let index = 0; index < 5; index++) {
      const recovery = h.create()
      recovery.recover()
      expect(h.listeners.size).toBe(1)
      if (index === 4) recovery.dispose()
    }
    expect(h.listeners.size).toBe(0)
  })

  it('does not release a newer Stop-all gate', async () => {
    const h = harness()
    h.recovery.recover()
    const next = h.runtime.beginSessionStop('session')
    expect(h.listeners.size).toBe(0)
    await h.publish(session(false))
    expect(h.runtime.isSessionStopRequested('session', h.stopGate)).toBe(false)
    expect(h.runtime.isSessionStopRequested('session', next)).toBe(true)
  })

  it.each(['new-generation', 'pause'] as const)('does not clear a target replaced by %s', async (replacement) => {
    const h = harness(false)
    h.recovery.recover()
    const active = h.runtime.start('session', 'reply')
    const next = replacement === 'new-generation' ? active : h.runtime.setPhase('session', 'reply', 'paused', active)
    expect(h.listeners.size).toBe(0)
    await h.publish(session(false))
    expect(h.runtime.get('session', 'reply')).toBe(next)
  })

  it.each([false, true])('cleans up a deleted session (all=%s)', async (all) => {
    const h = harness(all)
    h.recovery.recover()
    await h.events.publish({ type: 'session-deleted', ids: ['session'] })
    expect(h.runtime.list('session')).toHaveLength(0)
    expect(h.runtime.isSessionStopRequested('session')).toBe(false)
    expect(h.listeners.size).toBe(0)
  })
})

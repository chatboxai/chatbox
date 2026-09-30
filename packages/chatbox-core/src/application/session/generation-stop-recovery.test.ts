import { InMemorySessionRecordStore, InMemorySessionRowStore, InMemorySessionRepository } from '../../testing'
import { RowBackedSessionRepository } from './RowBackedSessionRepository'
import { SessionService } from './SessionService'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'
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

function harness(all = true, readDurableSession?: () => Promise<Session | null>) {
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
      readDurableSession,
    })
  const recovery = create()
  const stopping = runtime.beginStop('session', 'reply', undefined, active)
  if (stopping) stoppingRuntimes.set('reply', stopping)
  const publish = (value: Session) =>
    events.publish({ type: 'session-updated', session: value, meta: null, preserveCachedGeneratingMessages: false })
  return { runtime, events, listeners, stopGate, stoppingRuntimes, create, recovery, publish }
}

describe('durable generation stop recovery', () => {
  it('releases Stop-all after a durable terminal command rejects its metadata write', async () => {
    const rows = new RowBackedSessionRepository({
      records: new InMemorySessionRecordStore(),
      rows: new InMemorySessionRowStore(),
    })
    await rows.setSession(session(true))
    const repository = Object.assign(new InMemorySessionRepository(), {
      getSession: rows.getSession.bind(rows),
      executeSessionCommand: rows.executeSessionCommand.bind(rows),
    })
    vi.spyOn(repository.meta, 'update').mockRejectedValueOnce(new Error('metadata unavailable'))
    const read = vi.fn(() => rows.getSession('session'))
    const h = harness(true, read)
    const service = new SessionService(repository, new SessionWriteCoordinator(repository), h.events, {
      createId: () => 'unused',
    })
    const published = vi.spyOn(h.events, 'publish')
    await expect(
      service.updateMessage('session', 'reply', { generating: false, finishReason: 'canceled' })
    ).rejects.toThrow('metadata unavailable')
    expect(published.mock.calls.some(([event]) => event.type === 'session-command-committed')).toBe(true)
    expect(read).not.toHaveBeenCalled()
    h.recovery.recover()
    await vi.waitFor(() => expect(h.runtime.isSessionStopRequested('session')).toBe(false))
    expect(h.runtime.list('session')).toHaveLength(0)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each(['before', 'after'] as const)(
    'reads durable rows only when the terminal command arrives %s a failed stop',
    async (timing) => {
      const repository = new RowBackedSessionRepository({
        records: new InMemorySessionRecordStore(),
        rows: new InMemorySessionRowStore(),
      })
      await repository.setSession(session(true))
      const read = vi.fn(() => repository.getSession('session'))
      const h = harness(true, read)
      const commit = await repository.executeSessionCommand('session', {
        type: 'update',
        messageId: 'reply',
        updater: { generating: false, finishReason: 'canceled' },
      })
      if (commit.kind !== 'rows') throw new Error('Expected row command')
      const publish = () =>
        h.events.publish({
          type: 'session-command-committed',
          delta: commit.delta,
          meta: null,
          preserveCachedGeneratingMessages: false,
        })
      if (timing === 'before') await publish()
      expect(read).not.toHaveBeenCalled()
      h.recovery.recover()
      if (timing === 'after') await publish()
      await vi.waitFor(() => expect(h.runtime.isSessionStopRequested('session')).toBe(false))
      expect(h.runtime.list('session')).toHaveLength(0)
      expect(read).toHaveBeenCalledTimes(1)
      expect(h.listeners.size).toBe(0)
    }
  )

  it('does not accept a delayed durable read after a newer command', async () => {
    const repository = new RowBackedSessionRepository({
      records: new InMemorySessionRecordStore(),
      rows: new InMemorySessionRowStore(),
    })
    await repository.setSession(session(true))
    let resolve!: (value: Session | null) => void
    const read = vi
      .fn<() => Promise<Session | null>>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue(session(true))
    const h = harness(true, read)
    h.recovery.recover()
    const publish = async (generating: boolean) => {
      const result = await repository.executeSessionCommand('session', {
        type: 'update',
        messageId: 'reply',
        updater: { generating },
      })
      if (result.kind !== 'rows') throw new Error('Expected row command')
      await h.events.publish({
        type: 'session-command-committed',
        delta: result.delta,
        meta: null,
        preserveCachedGeneratingMessages: false,
      })
    }
    await publish(false)
    await publish(true)
    resolve(session(false))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    expect(h.runtime.get('session', 'reply')?.phase).toBe('stopping')
    h.recovery.dispose()
  })

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

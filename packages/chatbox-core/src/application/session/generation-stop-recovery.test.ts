import { describe, expect, it, vi } from 'vitest'
import { GenerationRuntimeStore, type GenerationRuntimeState } from '../../generation/runtime-store'
import type { SessionCommandDelta } from '../../ports/session-repository'
import { InMemorySessionRepository } from '../../testing/InMemorySessionRepository'
import { createGenerationStopRecovery, type GenerationStopRecoveryDurableState } from './generation-stop-recovery'
import { SessionEventBus, type SessionEventListener } from './session-events'
import { SessionService } from './SessionService'
import { SessionWriteCoordinator } from './SessionWriteCoordinator'

const state = (ids: string[] = []): GenerationStopRecoveryDurableState => ({
  generatingMessageIds: ids,
  currentConversationGeneratingCount: ids.length,
})
const delta: SessionCommandDelta = {
  record: {
    id: 'session',
    name: 'Session',
    activeThreadId: 'session',
    storageFormat: 'rows',
    rowFormatVersion: 3,
    rowAuthority: 1,
  },
  sessionId: 'session',
  revision: 2,
  previousRevision: 1,
  header: { id: 'session', name: 'Session' },
  diff: { sessionId: 'session', threads: { upsert: [], delete: [] }, messages: { upsert: [], delete: [] } },
  appendedMessageIds: [],
}
const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}
function harness(all = true, read?: () => Promise<GenerationStopRecoveryDurableState | null>) {
  let durable: GenerationStopRecoveryDurableState | null = state(['reply'])
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
  const readDurableState = vi.fn(read ?? (async () => durable))
  const create = () =>
    createGenerationStopRecovery({
      runtime,
      events,
      sessionId: 'session',
      targetMessageId: all ? undefined : 'reply',
      stopGate,
      preparationBarrier: runtime.waitForGenerationPreparationLeases('session'),
      stoppingRuntimes,
      readDurableState,
    })
  const recovery = create()
  const stopping = runtime.beginStop('session', 'reply', undefined, active)
  if (stopping) stoppingRuntimes.set('reply', stopping)
  const publish = async (value: GenerationStopRecoveryDurableState | null) => {
    durable = value
    await events.publish({
      type: 'session-command-committed',
      delta,
      meta: null,
      metaRevision: null,
      preserveCachedGeneratingMessages: false,
    })
    await flush()
  }
  return { runtime, events, listeners, stopGate, stoppingRuntimes, readDurableState, create, recovery, publish }
}

describe('durable generation stop recovery', () => {
  it('releases Stop-all when terminal rows commit and metadata projection fails', async () => {
    const repository = new InMemorySessionRepository()
    await repository.seedSession({
      id: 'session',
      name: 'Session',
      messages: [{ id: 'reply', role: 'assistant', contentParts: [], generating: true }],
    })
    vi.spyOn(repository.meta, 'create').mockRejectedValueOnce(new Error('metadata unavailable'))
    const h = harness(true, async () => {
      const [header, rows] = await Promise.all([
        repository.getSessionHeader('session'),
        repository.readSessionMessages({ sessionId: 'session', messageIds: ['reply'] }),
      ])
      return header
        ? {
            generatingMessageIds:
              rows?.messages.filter((message) => message.generating).map((message) => message.id) ?? [],
            currentConversationGeneratingCount: header.control.generatingAssistantCount,
          }
        : null
    })
    const service = new SessionService(repository, new SessionWriteCoordinator(repository), h.events, {
      createId: () => 'unused',
    })
    const published = vi.spyOn(h.events, 'publish')
    await service.updateMessage('session', 'reply', { generating: false, finishReason: 'canceled' })
    expect(published.mock.calls.some(([event]) => event.type === 'session-command-committed')).toBe(true)
    expect(h.readDurableState).not.toHaveBeenCalled()
    h.recovery.recover()
    await vi.waitFor(() => expect(h.runtime.isSessionStopRequested('session')).toBe(false))
    expect(h.runtime.list('session')).toHaveLength(0)
  })

  it.each(['before', 'after'] as const)(
    'reads committed rows when a terminal command arrives %s Stop fails',
    async (timing) => {
      const h = harness()
      if (timing === 'before') await h.publish(state())
      expect(h.readDurableState).not.toHaveBeenCalled()
      h.recovery.recover()
      if (timing === 'after') await h.publish(state())
      await flush()
      expect(h.runtime.list('session')).toHaveLength(0)
      expect(h.runtime.isSessionStopRequested('session')).toBe(false)
      expect(h.listeners.size).toBe(0)
    }
  )

  it('rejects a delayed read superseded by a newer command', async () => {
    let resolve!: (value: GenerationStopRecoveryDurableState) => void
    const read = vi
      .fn<() => Promise<GenerationStopRecoveryDurableState>>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      .mockResolvedValue(state(['reply']))
    const h = harness(true, read)
    h.recovery.recover()
    await h.publish(state())
    await h.publish(state(['reply']))
    resolve(state())
    await flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(h.runtime.get('session', 'reply')?.phase).toBe('stopping')
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    h.recovery.dispose()
  })

  it('retains the gate while durable rows still contain a generating reply', async () => {
    const h = harness()
    h.recovery.recover()
    await h.publish(state(['reply']))
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    expect(h.listeners.size).toBe(1)
    h.runtime.dispose()
    expect(h.listeners.size).toBe(0)
  })

  it('waits for a stopped message in an inactive branch', async () => {
    const h = harness(false)
    h.recovery.dispose()
    const second = h.runtime.start('session', 'second')
    const stopping = h.runtime.beginStop('session', 'second', undefined, second)
    if (stopping) h.stoppingRuntimes.set('second', stopping)
    const stopGate = h.runtime.beginSessionStop('session')
    const recovery = createGenerationStopRecovery({
      runtime: h.runtime,
      events: h.events,
      sessionId: 'session',
      stopGate,
      stoppingRuntimes: h.stoppingRuntimes,
      readDurableState: h.readDurableState,
    })
    recovery.recover()
    await h.publish(state(['second']))
    expect(h.runtime.get('session', 'reply')).toBeUndefined()
    expect(h.runtime.get('session', 'second')?.phase).toBe('stopping')
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    await h.publish(state())
    expect(h.runtime.list('session')).toHaveLength(0)
    expect(h.runtime.isSessionStopRequested('session')).toBe(false)
  })

  it('keeps admission closed through preparation and waits for stream drains', async () => {
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
      readDurableState: h.readDurableState,
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
    await h.publish(state())
    expect(h.runtime.isSessionStopRequested('session')).toBe(true)
    h.runtime.releaseGenerationPreparationLease(lease)
    await flush()
    expect(h.runtime.isSessionStopRequested('session')).toBe(false)
    expect(idle).not.toHaveBeenCalled()
    finishDrain()
    await idlePromise
    expect(h.listeners.size).toBe(0)
  })

  it('replaces failed single-stop observers on retry', () => {
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
    await h.publish(state())
    expect(h.runtime.isSessionStopRequested('session', h.stopGate)).toBe(false)
    expect(h.runtime.isSessionStopRequested('session', next)).toBe(true)
  })

  it.each(['new-generation', 'pause'] as const)('preserves a target replaced by %s', async (replacement) => {
    const h = harness(false)
    h.recovery.recover()
    const active = h.runtime.start('session', 'reply')
    const next = replacement === 'new-generation' ? active : h.runtime.setPhase('session', 'reply', 'paused', active)
    await h.publish(state())
    expect(h.runtime.get('session', 'reply')).toBe(next)
    expect(h.listeners.size).toBe(0)
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

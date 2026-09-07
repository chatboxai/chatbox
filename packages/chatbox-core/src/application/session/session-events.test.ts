import { describe, expect, test, vi } from 'vitest'
import type { LoggerPort } from '../../ports'
import { SessionEventBus } from './session-events'

describe('SessionEventBus', () => {
  test('runs every listener and reports synchronous and asynchronous failures without rejecting', async () => {
    const log = vi.fn<LoggerPort['log']>()
    const events = new SessionEventBus({ log })
    const completed: string[] = []

    events.subscribe(() => {
      throw new Error('synchronous failure')
    })
    events.subscribe(() => Promise.reject(new Error('asynchronous failure')))
    events.subscribe(async () => {
      await Promise.resolve()
      completed.push('successful listener')
    })

    await expect(events.publish({ type: 'session-deleted', ids: ['session-1'] })).resolves.toBeUndefined()

    expect(completed).toEqual(['successful listener'])
    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(
      'error',
      'Session event listener failed',
      expect.objectContaining({
        eventType: 'session-deleted',
        listenerIndex: 0,
        error: expect.objectContaining({ message: 'synchronous failure' }),
      })
    )
    expect(log).toHaveBeenCalledWith(
      'error',
      'Session event listener failed',
      expect.objectContaining({ eventType: 'session-deleted', listenerIndex: 1 })
    )
  })

  test('isolates logger failures from the published operation', async () => {
    const events = new SessionEventBus({
      log: () => Promise.reject(new Error('logger failed')),
    })
    events.subscribe(() => Promise.reject(new Error('listener failed')))

    await expect(
      events.publish({ type: 'session-will-delete', ids: ['session-1'], operation: 'session deletion' })
    ).resolves.toBeUndefined()
  })
})

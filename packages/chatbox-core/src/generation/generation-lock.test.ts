import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasPendingSessionGeneration,
  resetSessionGenerationLocksForTests,
  waitForSessionGenerations,
  withSessionGenerationLock,
} from './generation-lock'

describe('session generation lock', () => {
  it('cancels the backup wait while accepted submission work keeps running', async () => {
    let finish = () => {}
    const active = withSessionGenerationLock(
      'active',
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await Promise.resolve()
    const controller = new AbortController()
    const waiting = waitForSessionGenerations(controller.signal)
    controller.abort()
    try {
      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      finish()
      await active
    }
  }, 1000)

  it('waits for accepted generation preparation and queued submissions across sessions', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: string[] = []
    const first = withSessionGenerationLock('first', async () => {
      await gate
      events.push('first')
    })
    const next = withSessionGenerationLock('first', async () => {
      events.push('queued')
    })
    const other = withSessionGenerationLock('second', async () => {
      await gate
      events.push('second')
    })
    const waiting = waitForSessionGenerations().then(() => {
      events.push('idle')
    })
    await Promise.resolve()
    expect(events).toEqual([])
    release()
    await Promise.all([first, next, other, waiting])
    expect(events.at(-1)).toBe('idle')
    expect(events).toContain('queued')
    expect(events).toContain('second')
  })

  afterEach(() => {
    resetSessionGenerationLocksForTests()
  })

  it('serializes work for the same session', async () => {
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const events: string[] = []

    const first = withSessionGenerationLock('session-1', async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
    })
    const secondTask = vi.fn(() => {
      events.push('second')
      return Promise.resolve()
    })
    const second = withSessionGenerationLock('session-1', secondTask)

    await Promise.resolve()
    expect(secondTask).not.toHaveBeenCalled()
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second'])
  })

  it('continues the queue after a task fails', async () => {
    const first = withSessionGenerationLock('session-1', () => Promise.reject(new Error('failure')))
    const secondTask = vi.fn(() => Promise.resolve('ok'))
    const second = withSessionGenerationLock('session-1', secondTask)

    await expect(first).rejects.toThrow('failure')
    await expect(second).resolves.toBe('ok')
    expect(secondTask).toHaveBeenCalledOnce()
  })

  it('does not serialize different sessions', async () => {
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondTask = vi.fn(() => Promise.resolve('second'))

    const first = withSessionGenerationLock('session-1', () => firstGate)
    const second = withSessionGenerationLock('session-2', secondTask)

    await expect(second).resolves.toBe('second')
    releaseFirst()
    await first
  })

  it('reports a pending generation turn until the last task releases it', async () => {
    expect(hasPendingSessionGeneration('session-1')).toBe(false)

    let releaseTask = () => {}
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve
    })
    const first = withSessionGenerationLock('session-1', () => taskGate)
    // A submission that has not produced a generating message yet still owns the turn.
    expect(hasPendingSessionGeneration('session-1')).toBe(true)
    expect(hasPendingSessionGeneration('session-2')).toBe(false)

    const secondTask = vi.fn(() => Promise.resolve('second'))
    const second = withSessionGenerationLock('session-1', secondTask)
    expect(hasPendingSessionGeneration('session-1')).toBe(true)

    releaseTask()
    await first
    // The queued task keeps the turn until it finishes too.
    expect(hasPendingSessionGeneration('session-1')).toBe(true)
    await expect(second).resolves.toBe('second')
    expect(hasPendingSessionGeneration('session-1')).toBe(false)
  })
})

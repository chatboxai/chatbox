import { describe, expect, it, vi } from 'vitest'
import { StreamingWriteCoordinator } from './streaming-write-coordinator'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('StreamingWriteCoordinator', () => {
  it('keeps one checkpoint in flight and only the latest pending checkpoint', async () => {
    const coordinator = new StreamingWriteCoordinator()
    const first = deferred()
    const writes: number[] = []
    const checkpoint = (value: number, gate?: Promise<void>) =>
      coordinator.scheduleCheckpoint('session:message', async () => {
        writes.push(value)
        await gate
      })

    const firstWrite = checkpoint(1, first.promise)
    const replacedWrite = checkpoint(2)
    const latestWrite = checkpoint(3)

    expect(writes).toEqual([1])
    await replacedWrite
    first.resolve()
    await Promise.all([firstWrite, latestWrite])

    expect(writes).toEqual([1, 3])
  })

  it('drops a pending generating checkpoint and writes terminal after the in-flight checkpoint', async () => {
    const coordinator = new StreamingWriteCoordinator()
    const first = deferred()
    const writes: Array<{ generating: boolean; value: number }> = []
    const firstWrite = coordinator.scheduleCheckpoint('session:message', async () => {
      writes.push({ generating: true, value: 1 })
      await first.promise
    })
    const droppedWrite = coordinator.scheduleCheckpoint('session:message', () => {
      writes.push({ generating: true, value: 2 })
      return Promise.resolve()
    })
    const terminalWrite = coordinator.persistTerminal('session:message', () => {
      writes.push({ generating: false, value: 3 })
      return Promise.resolve()
    })

    expect(writes).toEqual([{ generating: true, value: 1 }])
    await droppedWrite
    first.resolve()
    await Promise.all([firstWrite, terminalWrite])

    expect(writes).toEqual([
      { generating: true, value: 1 },
      { generating: false, value: 3 },
    ])
  })

  it('still attempts terminal persistence after an in-flight checkpoint fails', async () => {
    const coordinator = new StreamingWriteCoordinator()
    const checkpointError = new Error('checkpoint failed')
    const checkpoint = coordinator.scheduleCheckpoint('session:message', () => Promise.reject(checkpointError))
    const terminal = vi.fn().mockResolvedValue(undefined)

    await expect(checkpoint).rejects.toBe(checkpointError)
    await coordinator.persistTerminal('session:message', terminal)

    expect(terminal).toHaveBeenCalledOnce()
  })

  it('allows a failed terminal write to be retried', async () => {
    const coordinator = new StreamingWriteCoordinator()
    const terminalError = new Error('terminal failed')
    const first = vi.fn().mockRejectedValue(terminalError)
    const retry = vi.fn().mockResolvedValue(undefined)

    await expect(coordinator.persistTerminal('session:message', first)).rejects.toBe(terminalError)
    await coordinator.persistTerminal('session:message', retry)

    expect(first).toHaveBeenCalledOnce()
    expect(retry).toHaveBeenCalledOnce()
  })

  it('keeps late cache updates from overwriting a requested terminal state', async () => {
    const coordinator = new StreamingWriteCoordinator()
    const cacheGate = deferred()
    const cache = coordinator.runCacheUpdate('session:message', () => cacheGate.promise)

    expect(coordinator.isTerminalRequested('session:message')).toBe(false)
    await coordinator.persistTerminal('session:message', () => Promise.resolve())
    expect(coordinator.isTerminalRequested('session:message')).toBe(true)

    cacheGate.resolve()
    await cache
  })
})

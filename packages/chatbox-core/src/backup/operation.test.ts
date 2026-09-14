import { describe, expect, test } from 'vitest'
import { BackupOperationCoordinator } from './operation'

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('BackupOperationCoordinator', () => {
  test('surfaces cleanup failure to navigation while still releasing task ownership', async () => {
    const operations = new BackupOperationCoordinator()
    const end = deferred()
    operations.registerParticipant({
      pauseAndDrain: async () => {},
      resume: async () => {
        throw new Error('cleanup failed')
      },
    })
    const run = operations.run('import', async () => {
      await end.promise
    })
    const failed = expect(run).rejects.toThrow('cleanup failed')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const cancel = operations.cancelAndWait()
    const cancellationFailed = expect(cancel).rejects.toThrow('cleanup failed')
    end.resolve()
    await Promise.all([failed, cancellationFailed])
    expect(operations.getSnapshot()).toBeNull()
  })

  test('lets the same operation own both native file cleanup and the import service', async () => {
    const operations = new BackupOperationCoordinator()
    const events: string[] = []
    await operations.run('import', async (signal) => {
      await operations.run(
        'import',
        async (ownedSignal) => {
          expect(ownedSignal).toBe(signal)
          events.push('restored')
        },
        signal
      )
      expect(operations.getSnapshot()?.kind).toBe('import')
      events.push('file closed')
      await expect(operations.run('import', async () => {}, new AbortController().signal)).rejects.toMatchObject({
        name: 'BackupOperationBusyError',
      })
    })
    expect(events).toEqual(['restored', 'file closed'])
    expect(operations.getSnapshot()).toBeNull()
  })

  test('forwards a host cancellation signal to the owned operation', async () => {
    const operations = new BackupOperationCoordinator()
    const finish = deferred()
    const host = new AbortController()
    let ownedSignal: AbortSignal | undefined
    const run = operations.run(
      'export',
      async (signal) => {
        ownedSignal = signal
        await finish.promise
      },
      host.signal
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    host.abort()
    try {
      expect(ownedSignal?.aborted).toBe(true)
      expect(operations.getSnapshot()?.phase).toBe('cancelling')
    } finally {
      finish.resolve()
      await run
    }
    expect(operations.getSnapshot()).toBeNull()
  })

  test('drains accepted background work and skips new background work until the backup finishes', async () => {
    const operations = new BackupOperationCoordinator()
    const maintenance = deferred()
    const backup = deferred()
    const events: string[] = []
    const background = operations.runBackground(async () => {
      await maintenance.promise
      events.push('maintenance')
    })
    const result = operations.run('export', async () => {
      events.push('export')
      await backup.promise
    })
    await operations.runBackground(async () => {
      events.push('late maintenance')
    })
    expect(events).toEqual([])
    maintenance.resolve()
    await background
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['maintenance', 'export'])
    backup.resolve()
    await result
    await operations.runBackground(async () => {
      events.push('next maintenance')
    })
    expect(events).toEqual(['maintenance', 'export', 'next maintenance'])
  })

  test('an immediate cancellation from a state subscriber still waits for cleanup', async () => {
    const operations = new BackupOperationCoordinator()
    const cleanup = deferred()
    operations.registerParticipant({ pauseAndDrain: async () => {}, resume: () => cleanup.promise })
    let cancellationFinished = false
    operations.subscribe(() => {
      if (operations.getSnapshot()?.phase === 'preparing') {
        void operations.cancelAndWait().then(() => {
          cancellationFinished = true
        })
      }
    })
    const result = operations.run('export', async () => {})
    const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancellationFinished).toBe(false)
    cleanup.resolve()
    await failed
  })

  test('releases all participants and reports a cleanup failure before accepting another operation', async () => {
    const operations = new BackupOperationCoordinator()
    const events: string[] = []
    const failure = new Error('resume failed')
    const removeFirst = operations.registerParticipant({
      pauseAndDrain: async () => {},
      resume: () => {
        events.push('first resumed')
      },
    })
    const removeSecond = operations.registerParticipant({
      pauseAndDrain: async () => {},
      resume: () => {
        throw failure
      },
    })
    await expect(operations.run('export', async () => 'archive')).rejects.toBe(failure)
    expect(events).toEqual(['first resumed'])
    expect(operations.getSnapshot()).toBeNull()
    removeFirst()
    removeSecond()
    await expect(operations.run('export', async () => 'next archive')).resolves.toBe('next archive')
  })

  test('drains every participant before releasing protection when one preparation fails', async () => {
    const migration = deferred()
    const events: string[] = []
    const operations = new BackupOperationCoordinator()
    const failure = new Error('cannot pause maintenance')
    operations.registerParticipant({
      pauseAndDrain: async () => {
        throw failure
      },
      resume: () => {
        events.push('first resumed')
      },
    })
    operations.registerParticipant({
      pauseAndDrain: () => migration.promise,
      resume: () => {
        events.push('migration resumed')
      },
    })
    const result = operations.run('import', async () => {
      events.push('import')
    })
    const failed = expect(result).rejects.toBe(failure)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual([])
    expect(operations.getSnapshot()?.phase).toBe('preparing')
    migration.resolve()
    await failed
    expect(events).toEqual(['migration resumed', 'first resumed'])
    expect(operations.getSnapshot()).toBeNull()
  })

  test('owns cancellation until an active migration drains and participants resume', async () => {
    const migration = deferred()
    const resumed = deferred()
    const events: string[] = []
    const operations = new BackupOperationCoordinator()
    operations.registerParticipant({
      pauseAndDrain: () => {
        events.push('pause')
        return migration.promise
      },
      resume: async () => {
        events.push('resume')
        await resumed.promise
      },
    })
    const run = operations.run('export', async () => {
      events.push('export')
    })
    const failed = expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(operations.getSnapshot()).toEqual({ kind: 'export', phase: 'preparing' })
    await Promise.resolve()
    const cancellation = operations.cancelAndWait()
    expect(operations.getSnapshot()).toEqual({ kind: 'export', phase: 'cancelling' })
    await expect(operations.run('import', async () => {})).rejects.toMatchObject({ name: 'BackupOperationBusyError' })
    migration.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['pause', 'resume'])
    expect(operations.getSnapshot()?.phase).toBe('cancelling')
    resumed.resolve()
    await cancellation
    await failed
    expect(operations.getSnapshot()).toBeNull()
  })
})

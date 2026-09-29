import { BackupOperationBusyError } from '@chatbox/core/backup'
import type { SessionMigrationOutcome } from '@chatbox/core/application/session'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { type SessionMigrationTrickleOptions, startSessionMigrationTrickle } from './session-migration-trickle'

interface ScheduledTask {
  fn: () => void
  delayMs: number
}

interface FakeScheduler {
  schedule: (fn: () => void, delayMs: number) => () => void
  pending: () => ScheduledTask | null
  run: () => Promise<void>
}

/** Runs every microtask and promise continuation the fired callback queued. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createScheduler(): FakeScheduler {
  let task: ScheduledTask | null = null
  return {
    schedule(fn, delayMs) {
      task = { fn, delayMs }
      const scheduled = task
      return () => {
        if (task === scheduled) task = null
      }
    },
    pending: () => task,
    async run() {
      const current = task
      if (!current) throw new Error('nothing is scheduled')
      task = null
      current.fn()
      await flush()
    },
  }
}

function createLog() {
  return { info: vi.fn(), warn: vi.fn() }
}

function messages(log: ReturnType<typeof createLog>, level: 'info' | 'warn'): string {
  return log[level].mock.calls.map((call) => String(call[0])).join('\n')
}

function start(
  overrides: Omit<Partial<SessionMigrationTrickleOptions>, 'log'> & Pick<SessionMigrationTrickleOptions, 'repository'>,
  scheduler: FakeScheduler = createScheduler()
) {
  const log = createLog()
  const handle = startSessionMigrationTrickle({
    isBusy: () => false,
    schedule: scheduler.schedule,
    ...overrides,
    log,
  })
  return { handle, scheduler, log }
}

function createRepository(outcomes: Record<string, SessionMigrationOutcome | Error>) {
  const ids = Object.keys(outcomes)
  return {
    listUnmigratedSessionIds: vi.fn(() => Promise.resolve(ids)),
    migrateSession: vi.fn((id: string) => {
      const outcome = outcomes[id]
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
    }),
  }
}

describe('startSessionMigrationTrickle', () => {
  test('retries backup contention without completing or recording migration failures', async () => {
    const repository = createRepository({ a: new BackupOperationBusyError() })
    const { scheduler, handle, log } = start({ repository })
    let completed = false
    void handle.done.then(() => {
      completed = true
    })
    await scheduler.run()
    for (let attempt = 0; attempt < 5; attempt++) {
      await scheduler.run()
      expect(completed).toBe(false)
      expect(scheduler.pending()).not.toBeNull()
    }
    repository.migrateSession.mockResolvedValue('migrated')
    await scheduler.run()
    await expect(handle.readyForFullScan).resolves.toBe(true)
    expect(repository.migrateSession.mock.calls.map(([id]) => id)).toEqual(Array(6).fill('a'))
    expect(messages(log, 'warn')).not.toContain('failed')
  })

  test.each(['empty', 'failed'] as const)('defers completion of a paused %s scan until resumed', async (outcome) => {
    let finishScan = () => {}
    const scan = new Promise<void>((resolve) => {
      finishScan = resolve
    })
    const { scheduler, handle } = start({
      repository: {
        listUnmigratedSessionIds: async () => {
          await scan
          if (outcome === 'failed') throw new Error('scan failed')
          return []
        },
        migrateSession: async () => 'migrated',
      },
    })
    let completed = false
    void handle.done.then(() => {
      completed = true
    })
    await scheduler.run()
    const pause = handle.pauseAndDrain()
    finishScan()
    await pause
    expect(completed).toBe(false)
    handle.resume()
    await scheduler.run()
    await expect(handle.readyForFullScan).resolves.toBe(outcome === 'empty')
  })

  test('does not start a migration after an asynchronous protection check finishes while paused', async () => {
    let finishCheck = () => {}
    const check = new Promise<void>((resolve) => {
      finishCheck = resolve
    })
    const migrated: string[] = []
    const { scheduler, handle } = start({
      repository: {
        listUnmigratedSessionIds: async () => ['a'],
        migrateSession: async (id) => {
          migrated.push(id)
          return 'migrated'
        },
      },
      shouldSkipSession: async () => {
        await check
        return false
      },
    })
    await scheduler.run()
    await scheduler.run()
    const pause = handle.pauseAndDrain()
    finishCheck()
    await pause
    expect(migrated).toEqual([])

    handle.resume()
    await scheduler.run()
    await expect(handle.readyForFullScan).resolves.toBe(true)
    expect(migrated).toEqual(['a'])
  })

  test('pauses new migrations and drains the active migration without completing the run', async () => {
    let completeMigration = () => {}
    const activeMigration = new Promise<void>((resolve) => {
      completeMigration = resolve
    })
    const migrated: string[] = []
    const { scheduler, handle } = start({
      repository: {
        listUnmigratedSessionIds: async () => ['a', 'b'],
        migrateSession: async (id) => {
          if (id === 'a') await activeMigration
          migrated.push(id)
          return 'migrated'
        },
      },
    })
    let done = false
    let ready = false
    void handle.done.then(() => {
      done = true
    })
    void handle.readyForFullScan.then(() => {
      ready = true
    })
    await scheduler.run()
    await scheduler.run()

    let drained = false
    const pause = handle.pauseAndDrain().then(() => {
      drained = true
    })
    await flush()
    expect(drained).toBe(false)
    completeMigration()
    await pause
    expect(migrated).toEqual(['a'])
    expect(scheduler.pending()).toBeNull()
    expect({ done, ready }).toEqual({ done: false, ready: false })

    handle.resume()
    await scheduler.run()
    await expect(handle.readyForFullScan).resolves.toBe(true)
    expect(migrated).toEqual(['a', 'b'])
  })

  test('keeps protected sessions out of the initial scan and prevents full maintenance afterward', async () => {
    const repository = {
      listUnmigratedSessionIds: vi.fn(async (shouldSkip?: (id: string) => Promise<boolean>) =>
        (await shouldSkip?.('blocked')) ? [] : ['blocked']
      ),
      migrateSession: vi.fn(async (): Promise<SessionMigrationOutcome> => 'migrated'),
    }
    const { scheduler, handle } = start({ repository, shouldSkipSession: async () => true })

    await scheduler.run()

    expect(repository.migrateSession).not.toHaveBeenCalled()
    await expect(handle.readyForFullScan).resolves.toBe(false)
  })

  test('rechecks protection for a queued session immediately before its migration', async () => {
    const repository = createRepository({ blocked: 'migrated' })
    let blocked = false
    const { scheduler, handle } = start({ repository, shouldSkipSession: async () => blocked })
    await scheduler.run()
    blocked = true

    await scheduler.run()

    expect(repository.migrateSession).not.toHaveBeenCalled()
    await expect(handle.readyForFullScan).resolves.toBe(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('waits for the initial delay before it scans for work', async () => {
    const repository = createRepository({ a: 'migrated' })
    const { scheduler } = start({ repository, initialDelayMs: 15_000, intervalMs: 1000 })

    expect(scheduler.pending()?.delayMs).toBe(15_000)
    expect(repository.listUnmigratedSessionIds).not.toHaveBeenCalled()

    await scheduler.run()

    expect(repository.listUnmigratedSessionIds).toHaveBeenCalledOnce()
    expect(repository.migrateSession).not.toHaveBeenCalled()
    expect(scheduler.pending()?.delayMs).toBe(1000)
  })

  test('migrates one session per tick and scans only once', async () => {
    const repository = createRepository({ a: 'migrated', b: 'migrated' })
    const { scheduler } = start({ repository, intervalMs: 1000 })

    await scheduler.run()
    await scheduler.run()
    expect(repository.migrateSession.mock.calls.map((call) => call[0])).toEqual(['a'])

    await scheduler.run()
    expect(repository.migrateSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b'])
    expect(repository.listUnmigratedSessionIds).toHaveBeenCalledOnce()
    expect(scheduler.pending()).toBeNull()
  })

  test('stops without scheduling a tick when nothing is left to migrate', async () => {
    const repository = createRepository({})
    const { scheduler } = start({ repository })

    await scheduler.run()

    expect(scheduler.pending()).toBeNull()
    expect(repository.migrateSession).not.toHaveBeenCalled()
  })

  test('leaves the queue untouched while the app is busy', async () => {
    const repository = createRepository({ a: 'migrated' })
    let busy = true
    const { scheduler } = start({ repository, isBusy: () => busy })

    await scheduler.run()
    await scheduler.run()
    expect(repository.migrateSession).not.toHaveBeenCalled()
    expect(scheduler.pending()).not.toBeNull()

    busy = false
    await scheduler.run()
    expect(repository.migrateSession).toHaveBeenCalledWith('a')
  })

  test('paces the next session in proportion to the previous migration time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const durations: Record<string, number> = { a: 1500, b: 0, c: 8000, d: 0 }
    const repository = createRepository({ a: 'migrated', b: 'migrated', c: 'migrated', d: 'migrated' })
    repository.migrateSession.mockImplementation((id: string) => {
      vi.setSystemTime(Date.now() + durations[id])
      return Promise.resolve<SessionMigrationOutcome>('migrated')
    })
    const { scheduler } = start({ repository, intervalMs: 1000 })

    await scheduler.run()
    expect(scheduler.pending()?.delayMs).toBe(1000)

    await scheduler.run()
    expect(scheduler.pending()?.delayMs).toBe(3000)

    await scheduler.run()
    expect(scheduler.pending()?.delayMs).toBe(1000)

    await scheduler.run()
    expect(scheduler.pending()?.delayMs).toBe(10_000)
  })

  test('stops after consecutive failures and leaves the rest of the queue alone', async () => {
    const failure = new Error('row store unavailable')
    const repository = createRepository({ a: failure, b: failure, c: 'migrated' })
    const { scheduler, log } = start({ repository, maxConsecutiveFailures: 2 })

    await scheduler.run()
    await scheduler.run()
    await scheduler.run()

    expect(repository.migrateSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b'])
    expect(scheduler.pending()).toBeNull()
    expect(messages(log, 'warn')).toContain('2 consecutive failures')
  })

  test('keeps going when a failure is followed by a success', async () => {
    const repository = createRepository({ a: new Error('transient'), b: 'migrated' })
    const { scheduler } = start({ repository, maxConsecutiveFailures: 2 })

    await scheduler.run()
    await scheduler.run()
    await scheduler.run()

    expect(repository.migrateSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b'])
  })

  test('warns about a session that cannot be converted', async () => {
    const repository = createRepository({ a: 'skipped' })
    const { scheduler, log } = start({ repository })

    await scheduler.run()
    await scheduler.run()

    expect(messages(log, 'warn')).toContain('skipped session a')
  })

  test('stops when the scan fails', async () => {
    const repository = createRepository({ a: 'migrated' })
    repository.listUnmigratedSessionIds.mockRejectedValue(new Error('records unavailable'))
    const { scheduler, log } = start({ repository })

    await scheduler.run()

    expect(scheduler.pending()).toBeNull()
    expect(messages(log, 'warn')).toContain('could not list')
  })

  test('stop() cancels the pending tick', async () => {
    const repository = createRepository({ a: 'migrated', b: 'migrated' })
    const { scheduler, handle } = start({ repository })

    await scheduler.run()
    handle.stop()

    expect(scheduler.pending()).toBeNull()
    expect(repository.migrateSession).not.toHaveBeenCalled()
  })

  test('stop() prevents the tick a running migration would schedule', async () => {
    const repository = createRepository({ a: 'migrated', b: 'migrated' })
    let resolveMigration: (outcome: SessionMigrationOutcome) => void = () => {}
    repository.migrateSession.mockImplementation(
      () =>
        new Promise<SessionMigrationOutcome>((resolve) => {
          resolveMigration = resolve
        })
    )
    const { scheduler, handle } = start({ repository })

    await scheduler.run()
    await scheduler.run()
    handle.stop()
    resolveMigration('migrated')
    await flush()

    expect(repository.migrateSession).toHaveBeenCalledOnce()
    expect(scheduler.pending()).toBeNull()
  })

  describe('done', () => {
    /** Resolves to true when `done` settles before the next macrotask. */
    function settled(done: Promise<void>): Promise<boolean> {
      return Promise.race([done.then(() => true), flush().then(() => false)])
    }

    test('resolves when the queue is drained', async () => {
      const repository = createRepository({ a: 'migrated' })
      const { scheduler, handle } = start({ repository })

      await scheduler.run()
      await expect(settled(handle.done)).resolves.toBe(false)

      await scheduler.run()
      await expect(settled(handle.done)).resolves.toBe(true)
      await expect(handle.readyForFullScan).resolves.toBe(true)
    })

    test('resolves when there is nothing to migrate', async () => {
      const repository = createRepository({})
      const { scheduler, handle } = start({ repository })

      await scheduler.run()

      await expect(settled(handle.done)).resolves.toBe(true)
      await expect(handle.readyForFullScan).resolves.toBe(true)
    })

    test('resolves when the scan fails', async () => {
      const repository = createRepository({ a: 'migrated' })
      repository.listUnmigratedSessionIds.mockRejectedValue(new Error('records unavailable'))
      const { scheduler, handle } = start({ repository })

      await scheduler.run()

      await expect(settled(handle.done)).resolves.toBe(true)
      await expect(handle.readyForFullScan).resolves.toBe(false)
    })

    test('resolves when consecutive failures stop the run', async () => {
      const failure = new Error('row store unavailable')
      const repository = createRepository({ a: failure, b: failure, c: 'migrated' })
      const { scheduler, handle } = start({ repository, maxConsecutiveFailures: 2 })

      await scheduler.run()
      await scheduler.run()
      await scheduler.run()

      await expect(settled(handle.done)).resolves.toBe(true)
      await expect(handle.readyForFullScan).resolves.toBe(false)
    })

    test('resolves when the run is stopped', async () => {
      const repository = createRepository({ a: 'migrated', b: 'migrated' })
      const { scheduler, handle } = start({ repository })

      await scheduler.run()
      await expect(settled(handle.done)).resolves.toBe(false)

      handle.stop()

      await expect(settled(handle.done)).resolves.toBe(true)
      await expect(handle.readyForFullScan).resolves.toBe(false)
    })
  })

  test('summarizes the outcomes of the run', async () => {
    const repository = createRepository({
      a: 'migrated',
      b: 'skipped',
      c: 'already',
      d: 'missing',
      e: new Error('transient'),
    })
    const { scheduler, log } = start({ repository, maxConsecutiveFailures: 3 })

    await scheduler.run()
    for (let index = 0; index < 5; index += 1) {
      await scheduler.run()
    }

    expect(messages(log, 'info')).toContain('1 migrated, 1 skipped, 1 already migrated, 1 missing, 1 failed')
  })
})

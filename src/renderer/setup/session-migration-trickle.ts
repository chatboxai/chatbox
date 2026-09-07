import type { SessionMigrationOutcome } from '@chatbox/core/application/session'

/** Delay before the first session of a run is touched, keeping startup clear. */
const DEFAULT_INITIAL_DELAY_MS = 15 * 1000
/** Delay between two sessions while migration stays cheap. */
const DEFAULT_INTERVAL_MS = 1000
/** A migration slower than this makes the pass back off for the next session. */
const SLOW_MIGRATION_MS = 200
/** Upper bound of the backed-off delay. */
const MAX_INTERVAL_MS = 10 * 1000
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
/** How long an idle slot is waited for once the delay has elapsed. */
const IDLE_TIMEOUT_MS = 1000

export interface SessionMigrationTrickleRepository {
  listUnmigratedSessionIds(shouldSkip?: (id: string) => Promise<boolean>): Promise<string[]>
  migrateSession(id: string): Promise<SessionMigrationOutcome>
}

export interface SessionMigrationTrickleLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

/** Cancels a scheduled callback that has not run yet. */
export type CancelScheduled = () => void

export interface SessionMigrationTrickleOptions {
  repository: SessionMigrationTrickleRepository
  /** True while a generation is running or the user is interacting; the tick is then skipped. */
  isBusy: () => boolean
  /** Checked before reading a legacy record during enumeration and again before migration. */
  shouldSkipSession?: (id: string) => Promise<boolean>
  initialDelayMs?: number
  intervalMs?: number
  maxConsecutiveFailures?: number
  schedule?: (fn: () => void, delayMs: number) => CancelScheduled
  log?: SessionMigrationTrickleLogger
}

export interface SessionMigrationTrickleHandle {
  stop(): void
  /** Resolves once the run is over, whatever ended it: an empty or drained queue, a failed scan, too many failures, or `stop()`. */
  done: Promise<void>
  /** True only after a complete scan with no failed migration or recovery-protected session. */
  readyForFullScan: Promise<boolean>
}

type OutcomeCounts = Record<SessionMigrationOutcome | 'failed', number>

function createCounts(): OutcomeCounts {
  return { migrated: 0, skipped: 0, already: 0, missing: 0, failed: 0 }
}

function defaultSchedule(fn: () => void, delayMs: number): CancelScheduled {
  let idleHandle: number | null = null
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback !== 'function') {
      fn()
      return
    }
    idleHandle = requestIdleCallback(
      () => {
        idleHandle = null
        fn()
      },
      { timeout: IDLE_TIMEOUT_MS }
    )
  }, delayMs)
  return () => {
    clearTimeout(timer)
    if (idleHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleHandle)
    }
  }
}

/**
 * Converts the sessions still stored in their legacy whole-session form to
 * message rows, one session per tick, so no user ever waits for a bulk
 * migration. The queue is taken once per run: sessions created afterwards are
 * written as rows by the repository itself.
 */
export function startSessionMigrationTrickle(options: SessionMigrationTrickleOptions): SessionMigrationTrickleHandle {
  const { repository, isBusy } = options
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
  const schedule = options.schedule ?? defaultSchedule
  const log = options.log

  const counts = createCounts()
  const queue: string[] = []
  let settle: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  let settleReadyForFullScan: (ready: boolean) => void = () => {}
  const readyForFullScan = new Promise<boolean>((resolve) => {
    settleReadyForFullScan = resolve
  })
  let stopped = false
  let cancelPending: CancelScheduled | null = null
  let consecutiveFailures = 0
  let delayMs = intervalMs
  let startedAt = 0
  let skippedProtectedSession = false

  async function shouldSkip(id: string): Promise<boolean> {
    const skip = (await options.shouldSkipSession?.(id)) ?? false
    skippedProtectedSession ||= skip
    return skip
  }

  function scheduleNext(delay: number, run: () => Promise<void>): void {
    cancelPending = schedule(() => {
      cancelPending = null
      void run()
    }, delay)
  }

  function finish(): void {
    stopped = true
    settle()
    settleReadyForFullScan(counts.failed === 0 && !skippedProtectedSession)
    log?.info(
      `session row migration finished: ${counts.migrated} migrated, ${counts.skipped} skipped, ` +
        `${counts.already} already migrated, ${counts.missing} missing, ${counts.failed} failed ` +
        `in ${Date.now() - startedAt}ms`
    )
  }

  async function begin(): Promise<void> {
    if (stopped) return
    let pending: string[]
    try {
      pending = await repository.listUnmigratedSessionIds(options.shouldSkipSession ? shouldSkip : undefined)
    } catch (error) {
      log?.warn('session row migration could not list the sessions to migrate', error)
      stopped = true
      settle()
      settleReadyForFullScan(false)
      return
    }
    if (stopped) return
    if (pending.length === 0) {
      stopped = true
      settle()
      settleReadyForFullScan(!skippedProtectedSession)
      return
    }
    queue.push(...pending)
    startedAt = Date.now()
    log?.info(`session row migration started: ${queue.length} sessions to convert`)
    scheduleNext(delayMs, tick)
  }

  async function tick(): Promise<void> {
    if (stopped) return
    if (isBusy()) {
      scheduleNext(delayMs, tick)
      return
    }
    const id = queue.shift()
    if (id === undefined) {
      finish()
      return
    }

    const migrationStartedAt = Date.now()
    try {
      const outcome = (await shouldSkip(id)) ? 'skipped' : await repository.migrateSession(id)
      counts[outcome] += 1
      consecutiveFailures = 0
      if (outcome === 'skipped') {
        log?.warn(`session row migration skipped session ${id}`)
      }
    } catch (error) {
      counts.failed += 1
      consecutiveFailures += 1
      log?.warn(`session row migration failed for session ${id}`, error)
      if (consecutiveFailures >= maxConsecutiveFailures) {
        log?.warn(`session row migration stopped after ${consecutiveFailures} consecutive failures`)
        finish()
        return
      }
    }

    delayMs = Date.now() - migrationStartedAt > SLOW_MIGRATION_MS ? Math.min(delayMs * 2, MAX_INTERVAL_MS) : intervalMs
    if (stopped) return
    if (queue.length === 0) {
      finish()
      return
    }
    scheduleNext(delayMs, tick)
  }

  scheduleNext(initialDelayMs, begin)

  return {
    done,
    readyForFullScan,
    stop(): void {
      stopped = true
      settle()
      settleReadyForFullScan(false)
      cancelPending?.()
      cancelPending = null
    },
  }
}

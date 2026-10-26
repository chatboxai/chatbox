import { SessionStorageBusyError } from '@chatbox/core/ports'
import type { SessionMigrationCandidate, SessionMigrationOutcome } from '@/adapters/CurrentSessionRepository'

/** Delay before the first session of a run is touched, keeping startup clear. */
const DEFAULT_INITIAL_DELAY_MS = 15 * 1000
/** Minimum delay between two sessions. */
const DEFAULT_INTERVAL_MS = 1000
/** The delay after a session is this multiple of its migration time, keeping the pass mostly idle. */
const MIGRATION_TIME_TO_DELAY_RATIO = 2
/** Upper bound of the delay after a slow session. */
const MAX_INTERVAL_MS = 10 * 1000
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
/** How long an idle slot is waited for once the delay has elapsed. */
const IDLE_TIMEOUT_MS = 1000

export interface SessionMigrationTrickleRepository {
  listSessionMigrationCandidates(): Promise<SessionMigrationCandidate[]>
  requiresSessionMigration(candidate: SessionMigrationCandidate): Promise<boolean>
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
  /** Checked before inspecting or migrating each queued candidate. */
  shouldSkipSession?: (id: string) => Promise<boolean>
  initialDelayMs?: number
  intervalMs?: number
  maxConsecutiveFailures?: number
  schedule?: (fn: () => void, delayMs: number) => CancelScheduled
  log?: SessionMigrationTrickleLogger
}

export interface SessionMigrationTrickleHandle {
  stop(): void
  /** Prevents new work immediately and waits for the active scan or migration. */
  pauseAndDrain(): Promise<void>
  /** Continues a paused run. Call only after pauseAndDrain has resolved. */
  resume(): void
  /** Resolves once the run is over, whatever ended it: an empty or drained queue, a failed scan, too many failures, or `stop()`. */
  done: Promise<void>
  /** True only after a complete scan with no failed migration or recovery-protected session. */
  readyForFullScan: Promise<boolean>
}

type OutcomeCounts = Record<SessionMigrationOutcome | 'protected' | 'failed', number>

function createCounts(): OutcomeCounts {
  return { migrated: 0, protected: 0, already: 0, missing: 0, failed: 0 }
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
 * message rows, one session per tick. Foreground operations take priority
 * between candidates. The queue is taken once per run: sessions created
 * afterwards are written as rows by the repository itself.
 */
export function startSessionMigrationTrickle(options: SessionMigrationTrickleOptions): SessionMigrationTrickleHandle {
  const { repository, isBusy } = options
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
  const schedule = options.schedule ?? defaultSchedule
  const log = options.log

  const counts = createCounts()
  const queue: SessionMigrationCandidate[] = []
  let settle: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  let settleReadyForFullScan: (ready: boolean) => void = () => {}
  const readyForFullScan = new Promise<boolean>((resolve) => {
    settleReadyForFullScan = resolve
  })
  let stopped = false
  let paused = false
  let running: Promise<void> | null = null
  let continuation: (() => Promise<void>) | null = null
  let cancelPending: CancelScheduled | null = null
  let consecutiveFailures = 0
  let delayMs = intervalMs
  let startedAt = Date.now()
  let skippedProtectedSession = false

  async function shouldSkip(id: string): Promise<boolean> {
    const skip = (await options.shouldSkipSession?.(id)) ?? false
    skippedProtectedSession ||= skip
    return skip
  }

  function scheduleNext(delay: number, run: () => Promise<void>): void {
    continuation = run
    if (paused || stopped) return
    cancelPending = schedule(() => {
      cancelPending = null
      if (paused || stopped) return
      continuation = null
      running = run().finally(() => {
        running = null
      })
    }, delay)
  }

  function finish(): void {
    if (paused) {
      scheduleNext(delayMs, async () => {
        finish()
      })
      return
    }
    stopped = true
    settle()
    settleReadyForFullScan(counts.failed === 0 && !skippedProtectedSession)
    log?.info(
      `session row migration finished: ${counts.migrated} migrated, ${counts.protected} recovery-protected, ` +
        `${counts.already} already migrated, ${counts.missing} missing, ${counts.failed} failed ` +
        `in ${Date.now() - startedAt}ms`
    )
  }

  async function begin(): Promise<void> {
    if (stopped) return
    if (isBusy()) {
      scheduleNext(delayMs, begin)
      return
    }
    let pending: SessionMigrationCandidate[]
    try {
      pending = await repository.listSessionMigrationCandidates()
    } catch (error) {
      if (error instanceof SessionStorageBusyError) {
        scheduleNext(delayMs, begin)
        return
      }
      log?.warn('session row migration could not list the sessions to migrate', error)
      counts.failed += 1
      finish()
      return
    }
    if (stopped) return
    if (pending.length === 0) {
      finish()
      return
    }
    queue.push(...pending)
    startedAt = Date.now()
    log?.info(`session row migration started: ${queue.length} candidates to inspect`)
    scheduleNext(delayMs, tick)
  }

  async function tick(): Promise<void> {
    if (stopped) return
    if (isBusy()) {
      scheduleNext(delayMs, tick)
      return
    }
    const candidate = queue.shift()
    if (candidate === undefined) {
      finish()
      return
    }

    const { id } = candidate
    const migrationStartedAt = Date.now()
    try {
      const skip = await shouldSkip(id)
      if (stopped) return
      if (paused || isBusy()) {
        queue.unshift(candidate)
        scheduleNext(delayMs, tick)
        return
      }
      const required = !skip && (await repository.requiresSessionMigration(candidate))
      if (stopped) return
      if (paused || isBusy()) {
        queue.unshift(candidate)
        scheduleNext(delayMs, tick)
        return
      }
      const outcome = skip ? 'protected' : required ? await repository.migrateSession(id) : 'already'
      counts[outcome] += 1
      consecutiveFailures = 0
      if (outcome === 'protected') {
        log?.warn(`session row migration deferred recovery-protected session ${id}`)
      }
    } catch (error) {
      if (error instanceof SessionStorageBusyError) {
        queue.unshift(candidate)
        scheduleNext(delayMs, tick)
        return
      }
      counts.failed += 1
      consecutiveFailures += 1
      log?.warn(`session row migration failed for session ${id}`, error)
      if (consecutiveFailures >= maxConsecutiveFailures) {
        log?.warn(`session row migration stopped after ${consecutiveFailures} consecutive failures`)
        finish()
        return
      }
    }

    // Migration time is mostly native storage I/O; pacing proportionally avoids idling at the upper bound.
    delayMs = Math.min(
      MAX_INTERVAL_MS,
      Math.max(intervalMs, (Date.now() - migrationStartedAt) * MIGRATION_TIME_TO_DELAY_RATIO)
    )
    if (stopped) return
    if (paused) {
      scheduleNext(delayMs, tick)
      return
    }
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
    async pauseAndDrain(): Promise<void> {
      paused = true
      cancelPending?.()
      cancelPending = null
      await running
    },
    resume(): void {
      if (!paused || stopped) return
      paused = false
      if (continuation) scheduleNext(delayMs, continuation)
    },
    stop(): void {
      stopped = true
      settle()
      settleReadyForFullScan(false)
      cancelPending?.()
      cancelPending = null
    },
  }
}

import { classifySessionMigrationSkip, describeSessionMigrationSkip } from '@chatbox/core/application/session'

interface MigrationSkipScope {
  setLevel(level: 'warning'): void
  setFingerprint(fingerprint: string[]): void
  setTag(key: string, value: string): void
}

export interface MigrationSkipSentry {
  withScope(callback: (scope: MigrationSkipScope) => void): void
  captureMessage(message: string): unknown
}

/**
 * Reports each session that stays in V1 form once per cause, tagged with a
 * stable `session_migration.skip_reason` category that Sentry can filter and count.
 */
export function createMigrationSkipReporter(sentry: MigrationSkipSentry) {
  // A V1 session reports again on every write; one event per session and cause keeps counts meaningful.
  const reported = new Set<string>()
  return (sessionId: string, reason: string): void => {
    const category = classifySessionMigrationSkip(reason)
    const key = `${sessionId}:${category}`
    if (reported.has(key)) return
    reported.add(key)
    sentry.withScope((scope) => {
      scope.setLevel('warning')
      scope.setFingerprint(['session-row-migration-skipped', category])
      scope.setTag('component', 'session-storage')
      scope.setTag('error_domain', 'session-storage')
      scope.setTag('error_operation', 'session-row-migration')
      // Rare and deduplicated, so every report is kept instead of sampled like other warnings.
      scope.setTag('error_priority', 'high')
      scope.setTag('session_migration.skip_reason', category)
      scope.setTag('session_migration.skip_detail', describeSessionMigrationSkip(reason))
      sentry.captureMessage(`Session row migration skipped: ${category}`)
    })
  }
}

import { describe, expect, test, vi } from 'vitest'
import { createMigrationSkipReporter, type MigrationSkipSentry } from './session-migration-skip-report'

function fakeSentry() {
  const events: { message: string; tags: Record<string, string>; fingerprint?: string[]; level?: string }[] = []
  let scope: { tags: Record<string, string>; fingerprint?: string[]; level?: string } = { tags: {} }
  const sentry: MigrationSkipSentry = {
    withScope: (callback) => {
      scope = { tags: {} }
      callback({
        setLevel: (level) => {
          scope.level = level
        },
        setFingerprint: (fingerprint) => {
          scope.fingerprint = fingerprint
        },
        setTag: (key, value) => {
          scope.tags[key] = value
        },
      })
    },
    captureMessage: vi.fn((message: string) => events.push({ message, ...scope })),
  }
  return { sentry, events }
}

describe('createMigrationSkipReporter', () => {
  test('reports one categorized, unsampled event per session and cause', () => {
    const { sentry, events } = fakeSentry()
    const report = createMigrationSkipReporter(sentry)
    report('session-1', 'fork u1 has out-of-range position 3')
    report('session-1', 'fork u2 has out-of-range position 9')
    report('session-1', 'row-backed publish failed; kept the complete V1 session record')
    report('session-2', 'fork u1 has out-of-range position 3')

    expect(events.map((event) => [event.tags['session_migration.skip_reason'], event.fingerprint])).toEqual([
      ['fork-position', ['session-row-migration-skipped', 'fork-position']],
      ['publish-failed', ['session-row-migration-skipped', 'publish-failed']],
      ['fork-position', ['session-row-migration-skipped', 'fork-position']],
    ])
    expect(events[0]).toMatchObject({
      message: 'Session row migration skipped: fork-position',
      level: 'warning',
      tags: {
        error_priority: 'high',
        error_operation: 'session-row-migration',
        'session_migration.skip_detail': 'fork <id> has out-of-range position 3',
      },
    })
    expect(JSON.stringify(events)).not.toContain('session-1')
  })
})

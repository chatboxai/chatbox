import { describe, expect, test } from 'vitest'
import { classifySessionMigrationSkip, describeSessionMigrationSkip } from './migration-skip-reason'

describe('classifySessionMigrationSkip', () => {
  test.each([
    ['row-backed publish failed; kept the complete V1 session record', 'publish-failed'],
    ['content written by an earlier version was kept: duplicate message id u1', 'released-client-content'],
    ['rows without a record were kept: corrupt rows', 'orphaned-rows'],
    ['duplicate message id 3f1a5aee-0000-4000-8000-000000000000', 'duplicate-message-id'],
    ['fork pivot s1 is a summary message', 'summary-pivot'],
    ['fork u1 has out-of-range position 3', 'fork-position'],
    ['fork u1 stores messages in its active branch', 'active-branch-messages'],
    ['unreachable fork gone contains messages', 'unreachable-fork'],
    ['archived thread session-1 collides with the active thread id', 'thread-id-collision'],
    ['duplicate thread row t0', 'thread-id-collision'],
    ['archived thread t0 has no name', 'thread-name'],
    ['archived thread t0 is named x, expected y', 'round-trip-mismatch'],
    ['session holds 1 archived threads, expected 2', 'round-trip-mismatch'],
    ['fork u1 branch #0 holds 1 messages, expected 2', 'round-trip-mismatch'],
    ['archived thread t0 prompt context snapshot differs', 'round-trip-mismatch'],
    ['thread t0 has 2 roots, expected 1', 'tree-invariant'],
    ['active thread t0 has seq 0, expected -1', 'tree-invariant'],
    ['message m2 has seq 1, which does not follow its parent seq 3', 'tree-invariant'],
    ['session field title differs', 'round-trip-mismatch'],
    ['fork u1 was created at 0, expected undefined', 'round-trip-mismatch'],
    ['active thread message m1 differs', 'round-trip-mismatch'],
    ['archived thread t0 compaction points differ', 'round-trip-mismatch'],
    ['fork pivots are u1, expected s1', 'round-trip-mismatch'],
    ['message m1 sits on a parent cycle', 'tree-invariant'],
    ['branch point s1 has no non-summary ancestor', 'tree-invariant'],
  ])('%s → %s', (reason, category) => {
    expect(classifySessionMigrationSkip(reason)).toBe(category)
  })
})

describe('describeSessionMigrationSkip', () => {
  test('removes message, fork and thread ids', () => {
    expect(describeSessionMigrationSkip('fork 3f1a5aee-0000-4000-8000-000000000000 has out-of-range position 3')).toBe(
      'fork <id> has out-of-range position 3'
    )
    expect(describeSessionMigrationSkip('session field title differs')).toBe('session field title differs')
    expect(describeSessionMigrationSkip('duplicate message row msg-abc')).toBe('duplicate message row <id>')
    expect(describeSessionMigrationSkip('fork pivot p_123 is claimed by two branch points')).toBe(
      'fork pivot <id> is claimed by two branch points'
    )
    expect(describeSessionMigrationSkip('branch point m_77 has no non-summary ancestor')).toBe(
      'branch point <id> has no non-summary ancestor'
    )
    expect(describeSessionMigrationSkip('message m2 has seq 1, which does not follow its parent seq 3')).toBe(
      'message <id> has seq 1, which does not follow its parent seq 3'
    )
    expect(describeSessionMigrationSkip('compaction summary s1 is not a summary message')).toBe(
      'compaction summary <id> is not a summary message'
    )
  })
})

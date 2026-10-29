import type { CompactionPoint, Message } from '../types'

/**
 * Find the latest compaction point that is applicable to the given message
 * path: both its boundary message and its summary message must exist in the
 * list.
 *
 * A compaction point is a paired contract — "everything up to the boundary is
 * covered by the summary". With message forks (#948) the boundary and summary
 * can end up on different branches (fork tails, deleted messages, legacy
 * copied-session data). Applying half a contract silently drops history
 * without a summary standing in, so an inapplicable point must be skipped.
 *
 * Skipping inapplicable points also restores older, still-intact points:
 * after multiple compactions, a branch switch may tear apart only the latest
 * point while an earlier one (covering the shared prefix) remains fully
 * usable on the current path.
 */
export function findLatestApplicableCompactionPoint(
  messages: Pick<Message, 'id'>[],
  compactionPoints?: CompactionPoint[]
): CompactionPoint | undefined {
  if (!compactionPoints || compactionPoints.length === 0) {
    return undefined
  }

  const messageIds = new Set(messages.map((m) => m.id))

  let latest: CompactionPoint | undefined
  for (const point of compactionPoints) {
    if (!messageIds.has(point.boundaryMessageId) || !messageIds.has(point.summaryMessageId)) {
      continue
    }
    if (!latest || point.createdAt > latest.createdAt) {
      latest = point
    }
  }

  return latest
}

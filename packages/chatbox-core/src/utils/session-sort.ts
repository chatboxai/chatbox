import type { SessionMeta, SessionMetaRecord } from '../types/session'

export function areSessionsInSamePinGroup(
  first: Pick<SessionMeta, 'starred'> | undefined,
  second: Pick<SessionMeta, 'starred'> | undefined
): boolean {
  return first !== undefined && second !== undefined && (first.starred === true) === (second.starred === true)
}

export function uniqueSessionRecords<T extends { id: string }>(records: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const record of records) {
    if (seen.has(record.id)) {
      continue
    }
    seen.add(record.id)
    unique.push(record)
  }
  return unique
}

/**
 * Session list ordering shared by the renderer sidebar and the native mobile
 * drawer: hidden sessions are dropped, starred sessions pin to the top, the
 * rest reverse to newest-first.
 */
export function sortSessions<T extends Pick<SessionMeta, 'hidden' | 'starred'>>(sessions: T[]): T[] {
  const reversed: T[] = []
  const pinned: T[] = []
  for (const sess of sessions) {
    // Skip hidden sessions (e.g., migrated picture sessions)
    if (sess.hidden) {
      continue
    }
    if (sess.starred) {
      pinned.push(sess)
      continue
    }
    reversed.unshift(sess)
  }
  return pinned.concat(reversed)
}

/**
 * Sort session meta records: starred first, then by sortOrder descending.
 * Filters out hidden sessions. Shared by the renderer SessionMetaStorage and
 * the native SQLite session repository.
 *
 * Not interchangeable with `sortSessions` above: that one orders legacy
 * in-memory session arrays by insertion order (no sortOrder field); this one
 * is for persisted SessionMetaRecord lists where drag-reorder writes
 * sortOrder. Using sortSessions on meta records silently ignores sortOrder.
 */
export function sortSessionRecords(sessions: SessionMetaRecord[]): SessionMetaRecord[] {
  return sessions
    .filter((s) => !s.hidden)
    .sort((a, b) => {
      if (a.starred && !b.starred) return -1
      if (!a.starred && b.starred) return 1
      return b.sortOrder - a.sortOrder
    })
}

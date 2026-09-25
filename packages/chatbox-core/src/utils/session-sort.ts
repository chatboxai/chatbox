import type { SessionMeta, SessionMetaRecord } from '../types/session'

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
 * Display group of a session in the list: pinned sessions first, then one group
 * per folder in folder order, then unfiled sessions. A `folderId` that names no
 * current folder (the folder was deleted) falls back to the unfiled group, so
 * deleting a folder never has to rewrite the sessions it contained.
 */
export type SessionListGroup = { kind: 'pinned' } | { kind: 'folder'; folderId: string } | { kind: 'unfiled' }

export function getSessionListGroup(
  session: Pick<SessionMeta, 'starred' | 'folderId'>,
  folderIds: readonly string[]
): SessionListGroup {
  if (session.starred) return { kind: 'pinned' }
  if (session.folderId && folderIds.includes(session.folderId)) return { kind: 'folder', folderId: session.folderId }
  return { kind: 'unfiled' }
}

/** Position of the session's display group; lower ranks are listed first. */
export function getSessionListGroupRank(
  session: Pick<SessionMeta, 'starred' | 'folderId'>,
  folderIds: readonly string[]
): number {
  if (session.starred) return 0
  const folderIndex = session.folderId ? folderIds.indexOf(session.folderId) : -1
  return folderIndex >= 0 ? folderIndex + 1 : folderIds.length + 1
}

export function areSessionsInSameListGroup(
  first: Pick<SessionMeta, 'starred' | 'folderId'> | undefined,
  second: Pick<SessionMeta, 'starred' | 'folderId'> | undefined,
  folderIds: readonly string[]
): boolean {
  return (
    first !== undefined &&
    second !== undefined &&
    getSessionListGroupRank(first, folderIds) === getSessionListGroupRank(second, folderIds)
  )
}

/** Sessions a collapsed folder hides from view, dropped from a display-ordered list. */
export function excludeCollapsedFolderSessions<T extends Pick<SessionMeta, 'starred' | 'folderId'>>(
  sessions: T[],
  folderIds: readonly string[],
  collapsedFolderIds: readonly string[]
): T[] {
  if (collapsedFolderIds.length === 0) return sessions
  return sessions.filter((session) => {
    const group = getSessionListGroup(session, folderIds)
    return group.kind !== 'folder' || !collapsedFolderIds.includes(group.folderId)
  })
}

/**
 * Sort session meta records in display order: grouped by `getSessionListGroupRank`
 * (pinned, folders in the given order, unfiled), then by sortOrder descending.
 * Filters out hidden sessions. Shared by the renderer SessionMetaStorage, the
 * native SQLite session repository and the list cache, so paginated storage
 * reads and cache patches agree on one order.
 *
 * Not interchangeable with `sortSessions` above: that one orders legacy
 * in-memory session arrays by insertion order (no sortOrder field); this one
 * is for persisted SessionMetaRecord lists where drag-reorder writes
 * sortOrder. Using sortSessions on meta records silently ignores sortOrder.
 */
export function sortSessionRecords(
  sessions: SessionMetaRecord[],
  folderIds: readonly string[] = []
): SessionMetaRecord[] {
  return sessions
    .filter((s) => !s.hidden)
    .sort((a, b) => {
      const rankDelta = getSessionListGroupRank(a, folderIds) - getSessionListGroupRank(b, folderIds)
      if (rankDelta !== 0) return rankDelta
      return b.sortOrder - a.sortOrder
    })
}

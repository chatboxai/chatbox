import { migrateSession, recoverSessionOnLoad } from '@chatbox/core'
import { sortSessions } from '@chatbox/core/utils/session-sort'
import type { SessionMeta, SessionMetaRecord } from '@shared/types'

export { migrateSession, recoverSessionOnLoad, sortSessions }

export function createSessionMetaRecordsFromLegacyList(sessions: SessionMeta[], now = Date.now()): SessionMetaRecord[] {
  const sortedVisibleSessions = sortSessions(sessions)
  const sortOrderById = new Map(sortedVisibleSessions.map((session, i) => [session.id, now - i * 1000]))
  const hiddenSortOrderStart = now - sortedVisibleSessions.length * 1000

  return sessions.map((session, i) => ({
    ...session,
    sortOrder: sortOrderById.get(session.id) ?? hiddenSortOrderStart - i * 1000,
    createdAt: now - i * 1000,
  }))
}

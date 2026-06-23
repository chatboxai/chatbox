import { RESERVED_SESSION_IDS } from '@shared/defaults'
import type { Session, SessionMeta, SessionMetaRecord } from '@shared/types'
import { mapValues } from 'lodash'
import { migrateMessage } from '../../shared/utils/message'

export function migrateSession(session: Session): Session {
  return {
    ...session,
    settings: {
      // temperature未设置的时候使用默认值undefined，这样才能覆盖全局设置
      temperature: undefined,
      ...session.settings,
    },
    messages: session.messages?.map((m) => migrateMessage(m)) || [],
    threads: session.threads?.map((t) => ({
      ...t,
      messages: t.messages.map((m) => migrateMessage(m)) || [],
    })),
    messageForksHash: mapValues(session.messageForksHash || {}, (forks) => ({
      ...forks,
      lists:
        forks.lists?.map((list) => ({
          ...list,
          messages: list.messages?.map((m) => migrateMessage(m)) || [],
        })) || [],
    })),
  }
}

export function isSystemSession(session: Pick<SessionMeta, 'id'> & { system?: boolean }): boolean {
  return Boolean(session.system) || RESERVED_SESSION_IDS.has(session.id)
}

export function sortSessions(sessions: SessionMeta[]): SessionMeta[] {
  const reversed: SessionMeta[] = []
  const pinned: SessionMeta[] = []
  for (const sess of sessions) {
    // Skip hidden sessions (e.g., migrated picture sessions)
    if (sess.hidden) {
      continue
    }
    if (isSystemSession(sess)) {
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

export function createSessionMetaRecordsFromLegacyList(
  sessions: SessionMeta[],
  now = Date.now()
): SessionMetaRecord[] {
  const sortedVisibleSessions = sortSessions(sessions)
  const sortOrderById = new Map(sortedVisibleSessions.map((session, i) => [session.id, now - i * 1000]))
  const hiddenSortOrderStart = now - sortedVisibleSessions.length * 1000

  return sessions.map((session, i) => ({
    ...session,
    sortOrder: sortOrderById.get(session.id) ?? hiddenSortOrderStart - i * 1000,
    createdAt: now - i * 1000,
  }))
}

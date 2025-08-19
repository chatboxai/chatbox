import { mapValues } from 'lodash'
import type { Session, SessionMeta } from 'src/shared/types'
import { migrateMessage } from './message'

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

export function sortSessions(sessions: SessionMeta[]): SessionMeta[] {
  if (!Array.isArray(sessions)) return [] as SessionMeta[] 
  const reversed: SessionMeta[] = []
  const pinned: SessionMeta[] = []
  for (const sess of sessions) {
    if (sess.starred) {
      pinned.push(sess)
      continue
    }
    reversed.unshift(sess)
  }
  return pinned.concat(reversed)
}

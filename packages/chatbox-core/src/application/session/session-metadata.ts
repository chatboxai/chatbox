import type { SessionHeader, SessionMeta, SessionMetaRecord } from '../../types'

export function projectSessionMeta(session: SessionMeta): SessionMeta {
  return {
    id: session.id,
    name: session.name,
    ...(Object.hasOwn(session, 'folderId') ? { folderId: session.folderId } : {}),
    ...(Object.hasOwn(session, 'starred') ? { starred: session.starred } : {}),
    ...(Object.hasOwn(session, 'hidden') ? { hidden: session.hidden } : {}),
    ...(Object.hasOwn(session, 'archivedAt') ? { archivedAt: session.archivedAt } : {}),
    ...(Object.hasOwn(session, 'assistantAvatarKey') ? { assistantAvatarKey: session.assistantAvatarKey } : {}),
    ...(Object.hasOwn(session, 'picUrl') ? { picUrl: session.picUrl } : {}),
    ...(Object.hasOwn(session, 'backgroundImage') ? { backgroundImage: session.backgroundImage } : {}),
    ...(Object.hasOwn(session, 'type') ? { type: session.type } : {}),
  }
}

/** The full derived metadata patch a session write must project alongside itself. */
export function projectSessionMetaUpdate(session: SessionHeader, paused: boolean): SessionMeta {
  return {
    ...projectSessionMeta(session),
    hasPausedToolCall: paused,
    recoveryArchived: undefined,
  }
}

export function createSessionMetaRecord(
  session: SessionHeader,
  sortOrder: number,
  createdAt: number,
  paused = false
): SessionMetaRecord {
  return {
    ...projectSessionMetaUpdate(session, paused),
    sortOrder,
    createdAt,
  }
}

import type { Session, SessionMeta, SessionMetaRecord } from '../../types'

const sessionMetaKeys = [
  'id',
  'name',
  'starred',
  'hidden',
  'archivedAt',
  'assistantAvatarKey',
  'picUrl',
  'backgroundImage',
  'type',
] as const satisfies ReadonlyArray<keyof SessionMeta>

const sessionMessageDataKeys = ['messages', 'threads', 'messageForksHash', 'compactionPoints'] as const

export type SessionMetadataUpdate = Omit<Session, (typeof sessionMessageDataKeys)[number]>

export function projectSessionMeta(session: SessionMeta): SessionMeta {
  return {
    id: session.id,
    name: session.name,
    ...(Object.hasOwn(session, 'starred') ? { starred: session.starred } : {}),
    ...(Object.hasOwn(session, 'hidden') ? { hidden: session.hidden } : {}),
    ...(Object.hasOwn(session, 'archivedAt') ? { archivedAt: session.archivedAt } : {}),
    ...(Object.hasOwn(session, 'assistantAvatarKey') ? { assistantAvatarKey: session.assistantAvatarKey } : {}),
    ...(Object.hasOwn(session, 'picUrl') ? { picUrl: session.picUrl } : {}),
    ...(Object.hasOwn(session, 'backgroundImage') ? { backgroundImage: session.backgroundImage } : {}),
    ...(Object.hasOwn(session, 'type') ? { type: session.type } : {}),
  }
}

export function createSessionMetaRecord(session: Session, sortOrder: number, createdAt: number): SessionMetaRecord {
  return {
    ...projectSessionMeta(session),
    sortOrder,
    createdAt,
  }
}

export function hasSessionMetaFields(update: Partial<Session>): boolean {
  return sessionMetaKeys.some((key) => Object.hasOwn(update, key))
}

export function getSessionMetadataSnapshot(session: Session): SessionMetadataUpdate {
  const {
    messages: _messages,
    threads: _threads,
    messageForksHash: _messageForksHash,
    compactionPoints: _compactionPoints,
    ...metadata
  } = session
  return metadata
}

export function assertNoMessageDataUpdate(update: object): void {
  const updateRecord = update as Record<string, unknown>
  const key = sessionMessageDataKeys.find((item) => Object.hasOwn(updateRecord, item))
  if (key) {
    throw new Error(`updateSession cannot update "${key}". Use updateSessionWithMessages for message data.`)
  }
}

import { isChatSession, type Session, type SessionMetaRecord } from '@shared/types'
import type { MergeRemoteSnapshotInput, MergeRemoteSnapshotResult, SyncSnapshot } from './types'

function isChatSessionMetaLike(item: Pick<SessionMetaRecord, 'type'>): boolean {
  return item.type === 'chat' || !item.type
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sessionsEqual(left: Session, right: Session): boolean {
  return stableStringify(left) === stableStringify(right)
}

function copyName(name: string): string {
  return `${name} (Synced copy)`
}

function metaForSession(
  session: Session,
  remoteMeta: SessionMetaRecord | undefined,
  now: number
): SessionMetaRecord {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
    starred: session.starred ?? remoteMeta?.starred,
    hidden: session.hidden ?? remoteMeta?.hidden,
    assistantAvatarKey: session.assistantAvatarKey ?? remoteMeta?.assistantAvatarKey,
    picUrl: session.picUrl ?? remoteMeta?.picUrl,
    backgroundImage: session.backgroundImage ?? remoteMeta?.backgroundImage,
    sortOrder: remoteMeta?.sortOrder ?? now,
    createdAt: remoteMeta?.createdAt ?? now,
  }
}

function metaForCopiedSession(
  session: Session,
  remoteMeta: SessionMetaRecord | undefined,
  now: number
): SessionMetaRecord {
  return {
    id: session.id,
    name: session.name,
    type: session.type,
    starred: session.starred ?? remoteMeta?.starred,
    hidden: session.hidden ?? remoteMeta?.hidden,
    assistantAvatarKey: session.assistantAvatarKey ?? remoteMeta?.assistantAvatarKey,
    picUrl: session.picUrl ?? remoteMeta?.picUrl,
    backgroundImage: session.backgroundImage ?? remoteMeta?.backgroundImage,
    sortOrder: now,
    createdAt: now,
  }
}

export function createSyncSnapshot(input: {
  sessions: Session[]
  metas: SessionMetaRecord[]
  deviceName: string
  exportedAt?: string
}): SyncSnapshot {
  const sessions = input.sessions.filter(isChatSession)
  const sessionIds = new Set(sessions.map((session) => session.id))

  return {
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    deviceName: input.deviceName,
    sessions,
    metas: input.metas.filter((meta) => sessionIds.has(meta.id) && isChatSessionMetaLike(meta)),
  }
}

export function mergeRemoteSnapshot(input: MergeRemoteSnapshotInput): MergeRemoteSnapshotResult {
  const localSessionById = new Map(input.localSessions.filter(isChatSession).map((session) => [session.id, session]))
  const localMetaById = new Map(input.localMetas.filter(isChatSessionMetaLike).map((meta) => [meta.id, meta]))
  const remoteMetaById = new Map(input.remote.metas.map((meta) => [meta.id, meta]))
  const seenRemoteSessionIds = new Set<string>()

  const sessionsToSave: Session[] = []
  const metasToSave: SessionMetaRecord[] = []
  let imported = 0
  let conflicts = 0

  for (const remoteSession of input.remote.sessions) {
    if (!isChatSession(remoteSession) || seenRemoteSessionIds.has(remoteSession.id)) {
      continue
    }
    seenRemoteSessionIds.add(remoteSession.id)

    const localSession = localSessionById.get(remoteSession.id)
    const remoteMeta = remoteMetaById.get(remoteSession.id)

    if (!localSession) {
      sessionsToSave.push(remoteSession)
      metasToSave.push(metaForSession(remoteSession, remoteMeta, input.now))
      imported += 1
      continue
    }

    if (sessionsEqual(localSession, remoteSession)) {
      if (!localMetaById.has(remoteSession.id) && remoteMeta) {
        metasToSave.push(metaForSession(remoteSession, remoteMeta, input.now))
      }
      continue
    }

    const copiedName = copyName(remoteSession.name)
    const copiedSession: Session = {
      ...remoteSession,
      id: input.createId(),
      name: copiedName,
    }
    sessionsToSave.push(copiedSession)
    metasToSave.push({
      ...metaForCopiedSession(copiedSession, remoteMeta, input.now),
      name: copiedName,
    })
    conflicts += 1
  }

  return {
    sessionsToSave,
    metasToSave,
    imported,
    conflicts,
  }
}

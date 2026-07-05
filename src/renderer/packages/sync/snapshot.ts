import {
  isChatSession,
  type Message,
  type MessageFile,
  type MessageLink,
  type Session,
  type SessionMetaRecord,
} from '@shared/types'
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

function shouldNormalizeFileAttachmentId(file: MessageFile): boolean {
  return file.id === file.storageKey || file.id === file.localPath || file.id.startsWith('file:')
}

function stripLocalFileReferences(file: MessageFile, index: number): MessageFile {
  const {
    id,
    storageKey: _storageKey,
    localPath: _localPath,
    ragMode: _ragMode,
    sessionAttachmentId: _sessionAttachmentId,
    sessionAttachmentAvailability: _sessionAttachmentAvailability,
    sessionAttachmentIndexStatus: _sessionAttachmentIndexStatus,
    sessionAttachmentBlockedReason: _sessionAttachmentBlockedReason,
    sessionAttachmentWarningReason: _sessionAttachmentWarningReason,
    sessionAttachmentStatus: _sessionAttachmentStatus,
    sessionAttachmentChunkCount: _sessionAttachmentChunkCount,
    sessionAttachmentIndexingStage: _sessionAttachmentIndexingStage,
    sessionAttachmentTotalChunks: _sessionAttachmentTotalChunks,
    sessionAttachmentEmbeddedChunks: _sessionAttachmentEmbeddedChunks,
    tokenCountMap: _tokenCountMap,
    tokenCalculatedAt: _tokenCalculatedAt,
    lineCount: _lineCount,
    byteLength: _byteLength,
    ...rest
  } = file
  return {
    id: shouldNormalizeFileAttachmentId(file) ? `synced-file:${index}:${file.name}` : id,
    ...rest,
  }
}

function stripLocalLinkReferences(link: MessageLink): MessageLink {
  const {
    storageKey: _storageKey,
    tokenCountMap: _tokenCountMap,
    tokenCalculatedAt: _tokenCalculatedAt,
    lineCount: _lineCount,
    byteLength: _byteLength,
    ...rest
  } = link
  return rest
}

function stripLocalMessageReferences(message: Message): Message {
  const { pictures: _pictures, ...messageWithoutLegacyPictures } = message as Message & { pictures?: unknown }
  const result: Message = {
    ...messageWithoutLegacyPictures,
    contentParts: message.contentParts.filter((part) => part.type !== 'image'),
  }

  if (message.files) {
    result.files = message.files.map(stripLocalFileReferences)
  }
  if (message.links) {
    result.links = message.links.map(stripLocalLinkReferences)
  }

  return result
}

function stripLocalSessionReferences(session: Session): Session {
  const {
    assistantAvatarKey: _assistantAvatarKey,
    backgroundImage: _backgroundImage,
    ...sessionWithoutLocalImages
  } = session

  return {
    ...sessionWithoutLocalImages,
    backgroundImage: session.backgroundImage?.type === 'url' ? session.backgroundImage : undefined,
    messages: session.messages.map(stripLocalMessageReferences),
    threads: session.threads?.map((thread) => ({
      ...thread,
      messages: thread.messages.map(stripLocalMessageReferences),
    })),
    messageForksHash: session.messageForksHash
      ? Object.fromEntries(
          Object.entries(session.messageForksHash).map(([key, fork]) => [
            key,
            {
              ...fork,
              lists: fork.lists.map((list) => ({
                ...list,
                messages: list.messages.map(stripLocalMessageReferences),
              })),
            },
          ])
        )
      : undefined,
  }
}

function stripLocalMetaReferences(meta: SessionMetaRecord): SessionMetaRecord {
  const { assistantAvatarKey: _assistantAvatarKey, backgroundImage: _backgroundImage, ...metaWithoutLocalImages } = meta

  return {
    ...metaWithoutLocalImages,
    backgroundImage: meta.backgroundImage?.type === 'url' ? meta.backgroundImage : undefined,
  }
}

function copyName(name: string): string {
  return `${name} (Synced copy)`
}

function metaForSession(session: Session, remoteMeta: SessionMetaRecord | undefined, now: number): SessionMetaRecord {
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
  const sessions = input.sessions.filter(isChatSession).map(stripLocalSessionReferences)
  const sessionIds = new Set(sessions.map((session) => session.id))

  return {
    version: 1,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    deviceName: input.deviceName,
    sessions,
    metas: input.metas
      .filter((meta) => sessionIds.has(meta.id) && isChatSessionMetaLike(meta))
      .map(stripLocalMetaReferences),
  }
}

export function mergeRemoteSnapshot(input: MergeRemoteSnapshotInput): MergeRemoteSnapshotResult {
  const localSessionById = new Map(
    input.localSessions.filter(isChatSession).map((session) => {
      const sanitizedSession = stripLocalSessionReferences(session)
      return [sanitizedSession.id, sanitizedSession]
    })
  )
  const localMetaById = new Map(
    input.localMetas.filter(isChatSessionMetaLike).map((meta) => {
      const sanitizedMeta = stripLocalMetaReferences(meta)
      return [sanitizedMeta.id, sanitizedMeta]
    })
  )
  const remoteMetas = input.remote.metas.map(stripLocalMetaReferences)
  const remoteMetaById = new Map(remoteMetas.map((meta) => [meta.id, meta]))
  const seenRemoteSessionIds = new Set<string>()

  const sessionsToSave: Session[] = []
  const metasToSave: SessionMetaRecord[] = []
  let imported = 0
  let conflicts = 0

  for (const remoteSession of input.remote.sessions.map(stripLocalSessionReferences)) {
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

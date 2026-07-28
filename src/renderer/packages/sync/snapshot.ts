import {
  isChatSession,
  type Message,
  type MessageFile,
  type MessageLink,
  type Session,
  type SessionMeta,
  type SessionMetaRecord,
} from '@shared/types'
import { validate as uuidValidate, version as uuidVersion, v5 as uuidv5 } from 'uuid'
import type { MergeRemoteSnapshotInput, MergeRemoteSnapshotResult, SyncSnapshot } from './types'

function isChatSessionMetaLike(item: Pick<SessionMetaRecord, 'type'>): boolean {
  return item.type === 'chat' || !item.type
}

export function sessionHasActiveGeneration(session: Session): boolean {
  if (session.messages.some((message) => message.generating)) {
    return true
  }
  if (session.threads?.some((thread) => thread.messages.some((message) => message.generating))) {
    return true
  }
  return Object.values(session.messageForksHash ?? {}).some((fork) =>
    fork.lists.some((list) => list.messages.some((message) => message.generating))
  )
}

function compareStableKeys(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareStableKeys(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sessionContentFingerprint(session: Session): string {
  const {
    id: _id,
    name: _name,
    starred: _starred,
    hidden: _hidden,
    assistantAvatarKey: _assistantAvatarKey,
    picUrl: _picUrl,
    backgroundImage: _backgroundImage,
    syncConflictSourceId: _syncConflictSourceId,
    ...content
  } = session
  return stableStringify(content)
}

function sessionContentEqual(left: Session, right: Session): boolean {
  return sessionContentFingerprint(left) === sessionContentFingerprint(right)
}

function metasEqual(left: SessionMetaRecord, right: SessionMetaRecord): boolean {
  const normalize = (meta: SessionMetaRecord) => ({
    id: meta.id,
    name: meta.name,
    type: meta.type,
    starred: meta.starred,
    hidden: meta.hidden,
    assistantAvatarKey: meta.assistantAvatarKey,
    picUrl: meta.picUrl,
    backgroundImage: meta.backgroundImage,
    sortOrder: meta.sortOrder,
    createdAt: meta.createdAt,
  })
  return stableStringify(normalize(left)) === stableStringify(normalize(right))
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
  const {
    pictures: _pictures,
    cancel: _cancel,
    generating: _generating,
    status: _status,
    isStreamingMode: _isStreamingMode,
    tokenCountMap: _tokenCountMap,
    tokenCalculatedAt: _tokenCalculatedAt,
    wordCount: _wordCount,
    tokenCount: _tokenCount,
    ...messageWithoutRuntimeState
  } = message as Message & { pictures?: unknown }
  const result: Message = {
    ...messageWithoutRuntimeState,
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
  const messageForkEntries = Object.entries(session.messageForksHash ?? {})
  const messageForksHash =
    messageForkEntries.length > 0
      ? Object.fromEntries(
          messageForkEntries.map(([key, fork]) => [
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
      : undefined

  return {
    ...sessionWithoutLocalImages,
    backgroundImage: session.backgroundImage?.type === 'url' ? session.backgroundImage : undefined,
    messages: session.messages.map(stripLocalMessageReferences),
    threads: session.threads?.map((thread) => ({
      ...thread,
      messages: thread.messages.map(stripLocalMessageReferences),
    })),
    messageForksHash,
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

function metaForExistingSession(
  session: Session,
  localMeta: SessionMetaRecord | undefined,
  remoteMeta: SessionMetaRecord | undefined,
  now: number,
  preferRemoteOrder: boolean
): SessionMetaRecord {
  const primaryOrderMeta = preferRemoteOrder ? remoteMeta : localMeta
  const fallbackOrderMeta = preferRemoteOrder ? localMeta : remoteMeta
  const localBackground =
    session.backgroundImage?.type === 'storage-key'
      ? session.backgroundImage
      : localMeta?.backgroundImage?.type === 'storage-key'
        ? localMeta.backgroundImage
        : session.backgroundImage

  return {
    id: session.id,
    name: session.name,
    type: session.type,
    starred: session.starred,
    hidden: session.hidden,
    assistantAvatarKey: session.assistantAvatarKey ?? localMeta?.assistantAvatarKey,
    picUrl: session.picUrl,
    backgroundImage: localBackground,
    sortOrder: primaryOrderMeta?.sortOrder ?? fallbackOrderMeta?.sortOrder ?? now,
    createdAt: primaryOrderMeta?.createdAt ?? fallbackOrderMeta?.createdAt ?? now,
  }
}

function applyMetaToSession(session: Session, meta: SessionMetaRecord | undefined): Session {
  if (!meta) {
    return session
  }
  return {
    ...session,
    name: meta.name,
    type: session.type,
    starred: meta.starred,
    hidden: meta.hidden,
    assistantAvatarKey: meta.assistantAvatarKey,
    picUrl: meta.picUrl,
    backgroundImage: meta.backgroundImage,
  }
}

function sessionMetadata(session: Session): Omit<SessionMeta, 'id'> {
  return {
    name: session.name,
    type: session.type,
    starred: session.starred,
    hidden: session.hidden,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
    backgroundImage: session.backgroundImage,
  }
}

function remoteMetadataPatch(localSession: Session, remoteSession: Session): Omit<SessionMeta, 'id'> {
  const patch: Omit<SessionMeta, 'id'> = {
    name: remoteSession.name,
    type: remoteSession.type,
    starred: remoteSession.starred,
    hidden: remoteSession.hidden,
    picUrl: remoteSession.picUrl,
  }

  // A storage-key background and assistant avatar refer to blobs that exist
  // only on this device. Remote snapshots cannot meaningfully replace them.
  if (localSession.backgroundImage?.type !== 'storage-key') {
    patch.backgroundImage = remoteSession.backgroundImage
  }
  return patch
}

function sessionMetadataEqual(left: Session, right: Session): boolean {
  return stableStringify(sessionMetadata(left)) === stableStringify(sessionMetadata(right))
}

function defaultCreateConflictId(sourceSessionId: string, contentFingerprint: string): string {
  return uuidv5(`chatbox:webdav-sync:v1:${sourceSessionId}:${contentFingerprint}`, uuidv5.URL)
}

function isPossibleLegacyConflictId(id: string): boolean {
  return uuidValidate(id) && uuidVersion(id) === 5
}

function conflictSourceIdForRemoteCopy(
  remoteSession: Session,
  localSessionById: Map<string, Session>
): string | undefined {
  if (remoteSession.syncConflictSourceId) {
    return remoteSession.syncConflictSourceId
  }

  // Only UUIDv5 IDs can be conflict copies created by the pre-provenance format.
  // Normal UUIDv4 sessions should not pay the compatibility scan cost.
  if (!isPossibleLegacyConflictId(remoteSession.id)) {
    return undefined
  }

  const fingerprint = sessionContentFingerprint(remoteSession)
  for (const sourceSessionId of localSessionById.keys()) {
    if (defaultCreateConflictId(sourceSessionId, fingerprint) === remoteSession.id) {
      return sourceSessionId
    }
  }
  return undefined
}

export function createSyncSnapshot(input: {
  sessions: Session[]
  metas: SessionMetaRecord[]
  deviceName: string
  exportedAt?: string
}): SyncSnapshot {
  const sessions = input.sessions.filter(isChatSession).map(stripLocalSessionReferences)
  const sessionIds = new Set(sessions.map((session) => session.id))
  const exportedAt = input.exportedAt ?? new Date().toISOString()

  return {
    version: 1,
    exportedAt,
    deviceName: input.deviceName,
    sessions,
    metas: input.metas
      .filter((meta) => sessionIds.has(meta.id) && isChatSessionMetaLike(meta))
      .map(stripLocalMetaReferences),
  }
}

export function mergeRemoteSnapshot(input: MergeRemoteSnapshotInput): MergeRemoteSnapshotResult {
  const localSessions = input.localSessions.filter(isChatSession)
  const localSessionById = new Map(localSessions.map((session) => [session.id, session] as const))
  const comparableLocalSessionById = new Map(
    localSessions.map((session) => {
      const comparableSession = stripLocalSessionReferences(session)
      return [comparableSession.id, comparableSession] as const
    })
  )
  const localMetaById = new Map(
    input.localMetas.filter(isChatSessionMetaLike).map((meta) => [meta.id, meta] as const)
  )
  const remoteMetas = input.remote.metas.map(stripLocalMetaReferences)
  const remoteMetaById = new Map(remoteMetas.map((meta) => [meta.id, meta]))
  const seenRemoteSessionIds = new Set<string>()

  const sessionChanges: MergeRemoteSnapshotResult['sessionChanges'] = []
  const metasToSaveById = new Map<string, SessionMetaRecord>()
  let imported = 0
  let conflicts = 0

  for (const remoteSession of input.remote.sessions.map(stripLocalSessionReferences)) {
    if (!isChatSession(remoteSession) || seenRemoteSessionIds.has(remoteSession.id)) {
      continue
    }
    seenRemoteSessionIds.add(remoteSession.id)

    const localSession = localSessionById.get(remoteSession.id)
    const comparableLocalSession = comparableLocalSessionById.get(remoteSession.id)
    const remoteMeta = remoteMetaById.get(remoteSession.id)
    const remoteSessionWithMeta = applyMetaToSession(remoteSession, remoteMeta)

    if (!localSession) {
      const conflictSourceId = conflictSourceIdForRemoteCopy(remoteSession, comparableLocalSessionById)
      const localConflictSource = conflictSourceId ? comparableLocalSessionById.get(conflictSourceId) : undefined
      if (localConflictSource && sessionContentEqual(localConflictSource, remoteSession)) {
        continue
      }
      const meta = metaForSession(remoteSessionWithMeta, remoteMeta, input.now)
      sessionChanges.push({ kind: 'create', session: remoteSessionWithMeta })
      metasToSaveById.set(meta.id, meta)
      localSessionById.set(remoteSessionWithMeta.id, remoteSessionWithMeta)
      comparableLocalSessionById.set(remoteSessionWithMeta.id, remoteSessionWithMeta)
      localMetaById.set(meta.id, meta)
      imported += 1
      continue
    }

    if (comparableLocalSession && sessionContentEqual(comparableLocalSession, remoteSession)) {
      if (input.preferRemoteMetadata) {
        const patch = remoteMetadataPatch(localSession, remoteSessionWithMeta)
        const updatedSession = { ...localSession, ...patch }
        if (!sessionMetadataEqual(localSession, updatedSession)) {
          sessionChanges.push({
            kind: 'update-metadata',
            sessionId: remoteSession.id,
            patch,
          })
          localSessionById.set(remoteSession.id, updatedSession)
          comparableLocalSessionById.set(remoteSession.id, stripLocalSessionReferences(updatedSession))
        }
        const localMeta = localMetaById.get(remoteSession.id)
        const meta = metaForExistingSession(updatedSession, localMeta, remoteMeta, input.now, true)
        if (remoteMeta && (!localMeta || !metasEqual(localMeta, meta))) {
          metasToSaveById.set(meta.id, meta)
          localMetaById.set(meta.id, meta)
        }
      } else if (!localMetaById.has(remoteSession.id) && remoteMeta) {
        const meta = metaForExistingSession(localSession, undefined, remoteMeta, input.now, true)
        metasToSaveById.set(meta.id, meta)
        localMetaById.set(meta.id, meta)
      }
      continue
    }

    const contentFingerprint = sessionContentFingerprint(remoteSessionWithMeta)
    const conflictId = (input.createConflictId ?? defaultCreateConflictId)(remoteSession.id, contentFingerprint)
    const copiedName = copyName(remoteSessionWithMeta.name)
    const copiedSession: Session = {
      ...remoteSessionWithMeta,
      id: conflictId,
      name: copiedName,
      syncConflictSourceId: remoteSession.id,
    }
    const copiedMeta = {
      ...metaForCopiedSession(copiedSession, remoteMeta, input.now),
      name: copiedName,
    }
    const existingCopy = localSessionById.get(conflictId)
    const comparableExistingCopy = comparableLocalSessionById.get(conflictId)

    if (existingCopy) {
      if (!comparableExistingCopy || !sessionContentEqual(comparableExistingCopy, copiedSession)) {
        // The synced copy is a normal mutable session: the user may have kept
        // chatting in it after import. A content mismatch here means the copy
        // is now user-owned local data, not an ID collision (the stable ID is
        // derived from the source session ID and the remote content
        // fingerprint, so an identical ID always refers to the same import).
        // Preserve the edited copy untouched and never abort the sync over it.
        continue
      }
      let updatedCopy = existingCopy
      if (input.preferRemoteMetadata) {
        const patch = remoteMetadataPatch(existingCopy, copiedSession)
        updatedCopy = { ...existingCopy, ...patch }
        if (!sessionMetadataEqual(existingCopy, updatedCopy)) {
          sessionChanges.push({
            kind: 'update-metadata',
            sessionId: conflictId,
            patch,
          })
          localSessionById.set(conflictId, updatedCopy)
          comparableLocalSessionById.set(conflictId, stripLocalSessionReferences(updatedCopy))
        }
      }
      const existingCopyMeta = localMetaById.get(conflictId)
      const updatedCopyMeta = metaForExistingSession(
        updatedCopy,
        existingCopyMeta,
        copiedMeta,
        input.now,
        false
      )
      if (input.preferRemoteMetadata && (!existingCopyMeta || !metasEqual(existingCopyMeta, updatedCopyMeta))) {
        metasToSaveById.set(conflictId, updatedCopyMeta)
        localMetaById.set(conflictId, updatedCopyMeta)
      }
      continue
    }

    sessionChanges.push({ kind: 'create', session: copiedSession })
    metasToSaveById.set(conflictId, copiedMeta)
    localSessionById.set(conflictId, copiedSession)
    comparableLocalSessionById.set(conflictId, copiedSession)
    localMetaById.set(conflictId, copiedMeta)
    conflicts += 1
  }

  return {
    sessionChanges,
    metasToSave: [...metasToSaveById.values()],
    imported,
    conflicts,
  }
}

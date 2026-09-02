import { isTextFilePath } from '@shared/file-extensions'
import { getToolResultImageReference } from '@shared/tool-result-image'
import type { CopilotDetail, Message, MessageFile, Session, SessionMetaRecord, Settings } from '@shared/types'
import type { BackupResourceEntry, BackupWarning } from './types'

export interface ResourceReference {
  storageKey: string
  kind: BackupResourceEntry['kind']
  sessionId?: string
  mimeType?: string
  filename?: string
}

type LegacyMessage = Message & { pictures?: Array<{ storageKey?: string; url?: string; loading?: boolean }> }

function addReference(references: ResourceReference[], reference: ResourceReference | undefined) {
  if (reference?.storageKey) references.push(reference)
}

function collectMessageReferences(
  message: Message,
  sessionId: string,
  references: ResourceReference[],
  warnings: BackupWarning[]
) {
  for (const picture of (message as LegacyMessage).pictures ?? []) {
    addReference(
      references,
      picture.storageKey ? { storageKey: picture.storageKey, kind: 'image', sessionId } : undefined
    )
  }
  for (const file of message.files ?? []) {
    addReference(
      references,
      file.storageKey
        ? {
            storageKey: file.storageKey,
            kind: 'parsed-attachment',
            sessionId,
            mimeType: 'text/plain',
            filename: file.name,
          }
        : undefined
    )
    addReference(
      references,
      file.rawStorageKey
        ? {
            storageKey: file.rawStorageKey,
            kind: 'raw-attachment',
            sessionId,
            mimeType: file.fileType,
            filename: file.name,
          }
        : undefined
    )
    const parsedTextIsCompleteAttachment = isTextFilePath(file.name) && Boolean(file.storageKey)
    if (file.localPath && !file.rawStorageKey && !parsedTextIsCompleteAttachment) {
      warnings.push({
        code: 'external-resource-skipped',
        itemType: 'resource',
        itemId: file.name,
        message: `External file was not included because it is not managed by Chatbox: ${file.name}`,
      })
    }
  }
  for (const link of message.links ?? []) {
    addReference(
      references,
      link.storageKey
        ? { storageKey: link.storageKey, kind: 'parsed-link', sessionId, mimeType: 'text/plain' }
        : undefined
    )
  }
  for (const part of message.contentParts ?? []) {
    if (part.type === 'image') {
      addReference(references, { storageKey: part.storageKey, kind: 'image', sessionId })
    } else if (part.type === 'tool-call') {
      if (part.resultStorageKey) {
        addReference(references, {
          storageKey: part.resultStorageKey,
          kind: 'tool-result',
          sessionId,
          mimeType: 'text/plain',
        })
      }
      const imageReference = getToolResultImageReference(part)
      if (imageReference) {
        addReference(references, {
          storageKey: imageReference.storageKey,
          kind: 'image',
          sessionId,
          mimeType: imageReference.mediaType,
        })
      }
    }
  }
}

function visitSessionMessages(session: Session, callback: (message: Message) => void) {
  for (const message of session.messages) callback(message)
  for (const thread of session.threads ?? []) {
    for (const message of thread.messages) callback(message)
  }
  for (const fork of Object.values(session.messageForksHash ?? {})) {
    for (const list of fork.lists) {
      for (const message of list.messages) callback(message)
    }
  }
}

export function collectSessionResourceReferences(session: Session): {
  references: ResourceReference[]
  warnings: BackupWarning[]
} {
  const references: ResourceReference[] = []
  const warnings: BackupWarning[] = []
  visitSessionMessages(session, (message) => collectMessageReferences(message, session.id, references, warnings))
  addReference(
    references,
    session.assistantAvatarKey
      ? { storageKey: session.assistantAvatarKey, kind: 'avatar', sessionId: session.id }
      : undefined
  )
  if (session.backgroundImage?.type === 'storage-key') {
    addReference(references, {
      storageKey: session.backgroundImage.storageKey,
      kind: 'background',
      sessionId: session.id,
    })
  }
  return { references, warnings }
}

export function collectGlobalResourceReferences(settings?: Partial<Settings>, copilots?: CopilotDetail[]) {
  const references: ResourceReference[] = []
  for (const storageKey of [
    settings?.userAvatarKey,
    settings?.defaultAssistantAvatarKey,
    settings?.backgroundImageKey,
  ]) {
    addReference(references, storageKey ? { storageKey, kind: 'background' } : undefined)
  }
  for (const copilot of copilots ?? []) {
    for (const source of [copilot.avatar, copilot.backgroundImage, ...(copilot.screenshots ?? [])]) {
      if (source?.type === 'storage-key') {
        addReference(references, { storageKey: source.storageKey, kind: 'copilot-image' })
      }
    }
  }
  return references
}

function restoreResourceKey(
  value: string | undefined,
  resourceKeyMap: ReadonlyMap<string, string>
): string | undefined {
  if (value === undefined || !resourceKeyMap.has(value)) return undefined
  return resourceKeyMap.get(value)
}

function resetRagState(file: MessageFile) {
  delete file.sessionAttachmentId
  delete file.sessionAttachmentAvailability
  delete file.sessionAttachmentIndexStatus
  delete file.sessionAttachmentBlockedReason
  delete file.sessionAttachmentWarningReason
  delete file.sessionAttachmentStatus
  delete file.sessionAttachmentChunkCount
  delete file.sessionAttachmentTotalChunks
  delete file.sessionAttachmentEmbeddedChunks
  delete file.sessionAttachmentIndexingStage
}

export function prepareSessionForBackup(session: Session): Session {
  const prepared = JSON.parse(JSON.stringify(session)) as Session
  visitSessionFiles(prepared, (file) => {
    delete file.localPath
    if (file.ragMode === 'session-retrieval') resetRagState(file)
  })
  return prepared
}

function restoreMessageResourceKeys(message: Message, resourceKeyMap: ReadonlyMap<string, string>) {
  const legacyMessage = message as LegacyMessage
  if (legacyMessage.pictures) {
    legacyMessage.pictures = legacyMessage.pictures.flatMap((picture) => {
      if (picture.storageKey === undefined) return picture.url ? [picture] : []
      const restoredStorageKey = restoreResourceKey(picture.storageKey, resourceKeyMap)
      if (restoredStorageKey !== undefined) return [{ ...picture, storageKey: restoredStorageKey }]
      const { storageKey: _storageKey, ...fallback } = picture
      return fallback.url ? [fallback] : []
    })
  }
  for (const file of message.files ?? []) {
    if (file.storageKey !== undefined) {
      const restoredStorageKey = restoreResourceKey(file.storageKey, resourceKeyMap)
      if (restoredStorageKey === undefined) delete file.storageKey
      else file.storageKey = restoredStorageKey
    }
    if (file.rawStorageKey !== undefined) {
      const restoredStorageKey = restoreResourceKey(file.rawStorageKey, resourceKeyMap)
      if (restoredStorageKey === undefined) delete file.rawStorageKey
      else file.rawStorageKey = restoredStorageKey
    }
    if (file.ragMode === 'session-retrieval') resetRagState(file)
  }
  for (const link of message.links ?? []) {
    if (link.storageKey === undefined) continue
    const restoredStorageKey = restoreResourceKey(link.storageKey, resourceKeyMap)
    if (restoredStorageKey === undefined) delete link.storageKey
    else link.storageKey = restoredStorageKey
  }
  message.contentParts = (message.contentParts ?? []).flatMap((part) => {
    if (part.type === 'image') {
      const restoredStorageKey = restoreResourceKey(part.storageKey, resourceKeyMap)
      if (restoredStorageKey === undefined) return []
      part.storageKey = restoredStorageKey
    } else if (part.type === 'tool-call') {
      if (part.resultStorageKey !== undefined) {
        const restoredStorageKey = restoreResourceKey(part.resultStorageKey, resourceKeyMap)
        if (restoredStorageKey === undefined) delete part.resultStorageKey
        else part.resultStorageKey = restoredStorageKey
      }
      const imageReference = getToolResultImageReference(part)
      if (imageReference) {
        const restoredStorageKey = restoreResourceKey(imageReference.storageKey, resourceKeyMap)
        if (part.resultImageStorageKey !== undefined) {
          // A missing blob degrades gracefully: converter and UI fall back to the JSON result.
          if (restoredStorageKey === undefined) {
            delete part.resultImageStorageKey
            delete part.resultImageMediaType
          } else {
            part.resultImageStorageKey = restoredStorageKey
          }
        } else {
          // Compatibility with backups created before image references became first-class fields.
          const resultRecord = part.result as Record<string, unknown>
          if (restoredStorageKey === undefined) delete resultRecord.image_storage_key
          else resultRecord.image_storage_key = restoredStorageKey
        }
      }
    }
    return [part]
  })
}

export function restoreSessionResourceKeys(session: Session, resourceKeyMap: ReadonlyMap<string, string>): Session {
  const restored = JSON.parse(JSON.stringify(session)) as Session
  if (restored.assistantAvatarKey !== undefined) {
    const restoredStorageKey = restoreResourceKey(restored.assistantAvatarKey, resourceKeyMap)
    if (restoredStorageKey === undefined) delete restored.assistantAvatarKey
    else restored.assistantAvatarKey = restoredStorageKey
  }
  if (restored.backgroundImage?.type === 'storage-key') {
    const restoredStorageKey = restoreResourceKey(restored.backgroundImage.storageKey, resourceKeyMap)
    if (restoredStorageKey === undefined) delete restored.backgroundImage
    else restored.backgroundImage.storageKey = restoredStorageKey
  }
  visitSessionMessages(restored, (message) => restoreMessageResourceKeys(message, resourceKeyMap))
  return restored
}

export function restoreSessionMetaResourceKeys(
  meta: SessionMetaRecord,
  resourceKeyMap: ReadonlyMap<string, string>
): SessionMetaRecord {
  const restored = { ...meta }
  if (restored.assistantAvatarKey !== undefined) {
    const restoredStorageKey = restoreResourceKey(restored.assistantAvatarKey, resourceKeyMap)
    if (restoredStorageKey === undefined) delete restored.assistantAvatarKey
    else restored.assistantAvatarKey = restoredStorageKey
  }
  if (restored.backgroundImage?.type === 'storage-key') {
    const restoredStorageKey = restoreResourceKey(restored.backgroundImage.storageKey, resourceKeyMap)
    if (restoredStorageKey === undefined) delete restored.backgroundImage
    else restored.backgroundImage = { ...restored.backgroundImage, storageKey: restoredStorageKey }
  }
  return restored
}

export function restoreSettingsResourceKeys(
  settings: Partial<Settings>,
  resourceKeyMap: ReadonlyMap<string, string>
): Partial<Settings> {
  const restored = { ...settings }
  for (const key of ['userAvatarKey', 'defaultAssistantAvatarKey', 'backgroundImageKey'] as const) {
    const storageKey = restored[key]
    if (storageKey === undefined) continue
    const restoredStorageKey = restoreResourceKey(storageKey, resourceKeyMap)
    if (restoredStorageKey === undefined) delete restored[key]
    else restored[key] = restoredStorageKey
  }
  return restored
}

function restoreImageSource<T extends CopilotDetail['avatar']>(
  source: T,
  resourceKeyMap: ReadonlyMap<string, string>
): T | undefined {
  if (source?.type !== 'storage-key') return source
  const restoredStorageKey = restoreResourceKey(source.storageKey, resourceKeyMap)
  return restoredStorageKey === undefined ? undefined : ({ ...source, storageKey: restoredStorageKey } as T)
}

export function restoreCopilotResourceKeys(
  copilots: CopilotDetail[],
  resourceKeyMap: ReadonlyMap<string, string>
): CopilotDetail[] {
  return copilots.map((copilot) => ({
    ...copilot,
    avatar: restoreImageSource(copilot.avatar, resourceKeyMap),
    backgroundImage: restoreImageSource(copilot.backgroundImage, resourceKeyMap),
    screenshots: copilot.screenshots?.flatMap((source) => {
      const restored = restoreImageSource(source, resourceKeyMap)
      return restored === undefined ? [] : [restored]
    }),
  }))
}

export function visitSessionFiles(session: Session, callback: (file: MessageFile, message: Message) => void) {
  visitSessionMessages(session, (message) => {
    for (const file of message.files ?? []) callback(file, message)
  })
}

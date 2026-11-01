import { getToolResultImageReference } from '@shared/tool-result-image'
import { getWorkArtifacts } from '@shared/work-artifacts'
import type { CopilotDetail, Message, SessionHeader, Settings } from '@shared/types'

export interface ResourceReference {
  storageKey: string
  kind:
    | 'image'
    | 'parsed-attachment'
    | 'raw-attachment'
    | 'parsed-link'
    | 'tool-result'
    | 'avatar'
    | 'background'
    | 'copilot-image'
  sessionId?: string
  mimeType?: string
  filename?: string
}

type LegacyMessage = Message & { pictures?: Array<{ storageKey?: string; url?: string; loading?: boolean }> }

function addReference(references: ResourceReference[], reference: ResourceReference | undefined) {
  if (reference?.storageKey) references.push(reference)
}

export function collectMessageReferences(message: Message, sessionId: string, references: ResourceReference[]) {
  for (const picture of (message as LegacyMessage).pictures ?? []) {
    addReference(
      references,
      picture.storageKey ? { storageKey: picture.storageKey, kind: 'image', sessionId } : undefined
    )
  }
  for (const file of [...(message.files ?? []), ...(message.compactedFiles ?? [])]) {
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
  }
  for (const link of [...(message.links ?? []), ...(message.compactedLinks ?? [])]) {
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
      for (const artifact of getWorkArtifacts(part)) {
        if (artifact.storageKey)
          addReference(references, {
            storageKey: artifact.storageKey,
            kind: 'raw-attachment',
            sessionId,
            mimeType: artifact.mimeType,
            filename: artifact.name,
          })
      }
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

export function collectHeaderResourceReferences(session: SessionHeader): ResourceReference[] {
  const references: ResourceReference[] = []
  addReference(
    references,
    session.assistantAvatarKey
      ? { storageKey: session.assistantAvatarKey, kind: 'avatar', sessionId: session.id }
      : undefined
  )
  if (session.backgroundImage?.type === 'storage-key')
    references.push({
      storageKey: session.backgroundImage.storageKey,
      kind: 'background',
      sessionId: session.id,
    })
  return references
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

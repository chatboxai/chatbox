import type { BlobStoragePort, Message } from '@chatbox/core'
import {
  MAX_WORKSPACE_BYTES,
  MAX_WORKSPACE_FILES,
  sessionDirectoryName,
  textToBase64,
  validateWorkspaceFiles,
  type WorkspaceFiles,
} from './workspace-path'

export class WorkspaceAttachmentCapacityError extends Error {
  constructor() {
    super('Workspace attachment capacity exceeded')
  }
}

type WorkspaceAttachment = { id?: string; name: string; storageKey?: string; rawStorageKey?: string }

export type AttachmentMessage = {
  files?: ReadonlyArray<WorkspaceAttachment>
  /** A compaction summary's references to covered files, which stay readable in the workspace. */
  compactedFiles?: ReadonlyArray<WorkspaceAttachment>
  contentParts: readonly Message['contentParts'][number][]
}
export type AttachmentMessages = Iterable<AttachmentMessage> | AsyncIterable<AttachmentMessage>

/** The workspace path an uploaded file is copied to, or undefined for a file without stored content. */
export function workspaceInputPath(attachment: WorkspaceAttachment): string | undefined {
  const key = attachment.rawStorageKey ?? attachment.storageKey
  if (!key) return undefined
  const name = attachment.name.replace(/[\\/:%\u0000-\u001f]/g, '_').slice(-100) || 'attachment'
  return `input/${sessionDirectoryName(attachment.id ?? key).slice(0, 80)}-${name}`
}

/** Collect all new attachments before writes so an oversized batch leaves the workspace intact. */
export async function collectWorkspaceInputs(
  existing: WorkspaceFiles,
  messages: AttachmentMessages,
  blobs: BlobStoragePort,
  hash: (value: string) => Promise<string>
): Promise<WorkspaceFiles> {
  const pending: WorkspaceFiles = Object.create(null)
  const byteLength = (base64: string) =>
    (base64.length * 3) / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  let bytes = Object.values(existing).reduce((total, file) => total + byteLength(file.base64), 0)
  let count = Object.keys(existing).length
  const addInput = (path: string, base64: string) => {
    if (path in existing || path in pending) return
    bytes += byteLength(base64)
    count += 1
    if (count > MAX_WORKSPACE_FILES || bytes > MAX_WORKSPACE_BYTES) throw new WorkspaceAttachmentCapacityError()
    validateWorkspaceFiles({ [path]: { base64 } })
    pending[path] = { base64 }
  }
  for await (const message of messages) {
    for (const attachment of [...(message.files ?? []), ...(message.compactedFiles ?? [])]) {
      const key = attachment.rawStorageKey ?? attachment.storageKey
      const path = workspaceInputPath(attachment)
      if (!key || !path) continue
      if (path in existing || path in pending) continue
      const value = await blobs.get(key)
      if (value === null) continue
      const data = /^data:[^,]*;base64,([\s\S]*)$/.exec(value)
      addInput(path, data ? data[1] : textToBase64(value))
    }
    for (const part of message.contentParts) {
      if (part.type !== 'image') continue
      const identity = await hash(part.storageKey)
      if (
        [...Object.keys(existing), ...Object.keys(pending)].some((path) => path.startsWith(`input/image-${identity}.`))
      )
        continue
      const value = await blobs.get(part.storageKey)
      if (value === null) continue
      const data = /^data:(image\/[^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(value)
      if (!data) throw new Error('Image attachment is not a local encoded image')
      const extension =
        (
          {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/heic': 'heic',
          } as Record<string, string>
        )[data[1].toLowerCase()] ?? 'img'
      addInput(`input/image-${identity}.${extension}`, data[2])
    }
  }
  return pending
}

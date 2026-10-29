import type { SessionMessageFacts } from '../session/session-tree/types'

export interface SessionAttachmentFactsRequest {
  sessionId: string
  scope: 'active-path' | 'session'
  signal?: AbortSignal
}

export interface SessionAttachmentFacts {
  sessionId: string
  threadId: string
  messageId: string
  revision: number
  files: NonNullable<SessionMessageFacts['seedAttachments']>
  imageStorageKeys: string[]
  attachmentOwnershipIds: number[]
}

export interface SessionAttachmentRepositoryPort {
  /** Metadata pages from one revision; completion is required before destructive cleanup. */
  iterateSessionAttachmentFacts(request: SessionAttachmentFactsRequest): AsyncIterable<SessionAttachmentFacts>
}

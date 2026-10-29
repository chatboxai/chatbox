import type { SessionPresentationSummary } from '../session/session-tree/types'
import type { SessionMessageDerivedPatch } from '../application/session/message-derived-data'
import type { Message } from '../types/session'
import type { SessionHeader } from './session-read-model'
import type { SessionMessagesRequest } from './session-row-store'

export interface SessionMessagesSource {
  textTokens?: SessionTextTokenRead
  presentation?: SessionPresentationSummary
  header: SessionHeader
  revision: number | null
  messages: Message[]
}

/** Only accepted derived fields, suitable for replay onto another cached copy. */
export interface SessionMessageDerivedWriteResult {
  sessionId: string
  previousRevision: number | null
  revision: number | null
  patches: SessionMessageDerivedPatch[]
}

export interface SessionMessageRepositoryPort {
  readSessionMessages(request: SessionMessagesRequest): Promise<SessionMessagesSource | null>
  patchSessionMessageDerivedData(
    sessionId: string,
    patches: SessionMessageDerivedPatch[]
  ): Promise<SessionMessageDerivedWriteResult>
}

export type {
  SessionAttachmentDerivedPatch,
  SessionMessageDerivedPatch,
  SessionMessageTextDerivedPatch,
} from '../application/session/message-derived-data'

import type { SessionTextTokenRead } from './session-text-tokens'

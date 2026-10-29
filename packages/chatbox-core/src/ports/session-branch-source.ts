import type { Message } from '../types/session'
import type { MessageRow } from '../session/session-tree/types'
import type { SessionRowCommit } from './session-row-store'

/** Continuation of one branch's local selected path at a fixed commit. */
export interface SessionBranchMessagesCursor {
  sessionId: string
  threadId: string
  firstMessageId: string
  revision: number
  limit: number
  maxBytes: number
  /** Last row included in the preceding page. */
  messageId: string
}

export interface SessionBranchMessagesRequest {
  sessionId: string
  firstMessageId: string
  limit: number
  maxBytes?: number
  cursor?: SessionBranchMessagesCursor
  expectedRevision?: number
}

export interface SessionBranchMessagesPage extends SessionRowCommit {
  threadId: string
  firstMessageId: string
  messages: MessageRow[]
  payloadBytes: number
  nextCursor: SessionBranchMessagesCursor | null
}

export interface SessionBranchStorePort {
  /** Returns compact preview identities and counts from one committed local selected path. */
  readBranchPreview(request: SessionBranchPreviewRequest): Promise<SessionBranchPreview | null>
  readBranchMessagesPage(request: SessionBranchMessagesRequest): Promise<SessionBranchMessagesPage | null>
}

export interface SessionBranchPreviewRequest {
  sessionId: string
  firstMessageId: string
  expectedRevision?: number
  /** Candidate message identities to match against this branch path. */
  revealedMessageIds?: readonly string[]
}

/** Metadata for a saved branch's compact message preview. */
export interface SessionBranchPreview {
  sessionId: string
  revision: number
  threadId: string
  headMessageId: string | null
  headRole: Message['role'] | null
  pairedReplyMessageId: string | null
  /** Local selected-path rows after the head, excluding its paired reply. */
  followupCount: number
  /** Matching candidate identities in local selected-path order. */
  revealedMessageIds?: string[]
}

import type {
  MessageRowMetadata,
  SessionMessageFacts,
  SessionThreadSummary,
  ThreadRow,
} from '../session/session-tree/types'
import type { SessionRowCommit, SessionThreadPageCursor, SessionThreadPageRequest } from './session-row-store'
import type { SessionTranscriptThread } from './session-transcript-source'

export type SessionKnownMessageMetadata = MessageRowMetadata & { facts: SessionMessageFacts; selected: boolean }
export interface SessionProjectionUnavailable extends SessionRowCommit {
  status: 'projection-unavailable'
  messageIds: string[]
  threadIds: string[]
}

export interface SessionMessageMetadataRequest {
  sessionId: string
  messageIds: string[]
  expectedRevision: number
}
export type SessionMessageMetadataRead =
  | (SessionRowCommit & { status: 'ready'; rows: SessionKnownMessageMetadata[]; missingMessageIds: string[] })
  | SessionProjectionUnavailable

export type SessionMessageRelationsSelector =
  | {
      kind: 'children'
      parentMessageId: string | null
      reverse?: boolean
      boundary?: { siblingOrder: number; messageId: string }
      branchId?: string
    }
  | { kind: 'ancestors'; messageId: string }
  | { kind: 'selected-path'; messageId: string; includeStart?: boolean }
  | { kind: 'subtree'; rootMessageId: string }
  | { kind: 'selected-facts'; paused: true }
  | { kind: 'status'; status: 'generating' }

/** Opaque continuation fixed to one selector, page size, thread, and commit. */
export interface SessionMessageRelationsCursor {
  sessionId: string
  threadId: string
  revision: number
  selectorKey: string
  limit: number
  position: string
}
export interface SessionMessageRelationsRequest {
  sessionId: string
  threadId: string
  selector: SessionMessageRelationsSelector
  limit: number
  cursor?: SessionMessageRelationsCursor
  expectedRevision: number
}
export type SessionMessageRelationsPage =
  | (SessionRowCommit & {
      status: 'ready'
      rows: SessionKnownMessageMetadata[]
      nextCursor: SessionMessageRelationsCursor | null
    })
  | (SessionRowCommit & { status: 'target-missing'; messageId: string })
  | SessionProjectionUnavailable

export interface SessionThreadStateRequest {
  sessionId: string
  threadId?: string
  expectedRevision: number
}
export type SessionThreadStateRead =
  | (SessionRowCommit & { status: 'ready'; thread: ThreadRow & { summary: SessionThreadSummary } })
  | SessionProjectionUnavailable

export interface SessionThreadSummariesRead extends SessionRowCommit {
  threads: SessionTranscriptThread[]
  nextCursor: SessionThreadPageCursor | null
}

export interface SessionRowRelationsPort {
  readMessageMetadata(request: SessionMessageMetadataRequest): Promise<SessionMessageMetadataRead | null>
  readMessageRelationsPage(request: SessionMessageRelationsRequest): Promise<SessionMessageRelationsPage | null>
  readThreadState(request: SessionThreadStateRequest): Promise<SessionThreadStateRead | null>
  readThreadSummariesPage(request: SessionThreadPageRequest): Promise<SessionThreadSummariesRead | null>
}

/** Range operations use the old committed relationships and run before explicit upserts. */
export interface SessionRowRangeMutations {
  siblingShifts?: Array<{ threadId: string; parentMessageId: string | null; afterSiblingOrder: number; delta: number }>
  /** Collapse a deleted pivot into its existing parent, preserving its children's order and subtrees. */
  insertParents?: Array<{ threadId: string; parentMessageId: string; newParentMessageId: string }>
  reparentChildren?: Array<{
    threadId: string
    parentMessageId: string
    newParentMessageId: string
    siblingOrderOffset: number
    branchId?: string | null
  }>
  /** Replace a deleted pivot with a new row at the same parent, sibling position, and branch identity. */
  replaceMessagePivots?: Array<{ threadId: string; messageId: string; replacementMessageId: string }>
  expandForks?: Array<{ threadId: string; branchPointId: string }>
  deleteArchivedThreads?: boolean
  deleteSubtrees?: Array<{ threadId: string; rootMessageId: string }>
  deleteThreadMessages?: string[]
  /** Explicit clear-all operation; retained rows are supplied by the same transaction's upserts. */
  deleteSessionMessages?: boolean
}

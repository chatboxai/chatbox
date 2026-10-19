import type { SessionSearchRepositoryPort } from './session-search-source'
import type { SessionArtifactRepositoryPort } from './session-artifact-source'
import type { SessionPromptCacheRepositoryPort } from './session-prompt-cache-source'
import type { SessionAttachmentRepositoryPort } from './session-attachment-source'
import type {
  SessionBranchMessagesRequest,
  SessionBranchMessagesPage,
  SessionBranchPreviewRequest,
  SessionBranchPreview,
} from './session-branch-source'
import type { SessionTokenRepositoryPort } from './session-token-source'
import type { CurrentThreadIdentity } from './session-structure-command'
import type { SessionHeader, Message } from '../types/session'
import type { SessionThreadSummary } from '../session/session-tree/types'
import type { SessionContextRepositoryPort } from './session-context-source'
import type { SessionMessagesSource, SessionMessageRepositoryPort } from './session-message-source'
import type { SessionCommand, SessionCommandDelta } from './session-repository'
import type { SessionThreadPageRequest, SessionThreadPageCursor } from './session-row-store'
import type { SessionTextTokenRepositoryPort } from './session-text-tokens'
import type {
  SessionNavigationPage,
  SessionNavigationRepairRequest,
  SessionThreadRead,
  SessionThreadRequest,
  SessionTranscriptPage,
  SessionTranscriptRequest,
  SessionTranscriptThread,
} from './session-transcript-source'

export interface SessionHeaderRead {
  header: SessionHeader
  revision: number
  activeThreadId: string
  summary: SessionThreadSummary
  control: { generatingAssistantCount: number }
}

export interface SessionThreadSummariesPage {
  sessionId: string
  revision: number
  activeThreadId: string
  threads: SessionTranscriptThread[]
  nextCursor: SessionThreadPageCursor | null
}

export interface SessionForkOptionsRequest {
  sessionId: string
  pivotId: string
  limit: number
  expectedRevision?: number
  cursor?: { revision: number; pivotId: string; afterSeq: number; afterBranchId: string }
}

export interface SessionForkOptionsPage {
  sessionId: string
  revision: number
  threadId: string
  pivotId: string
  branchPointId: string
  createdAt: number
  selectedBranchId: string
  branches: Array<{ branchId: string; firstMessageId: string | null; seq: number; selected: boolean }>
  nextCursor: SessionForkOptionsRequest['cursor'] | null
}

export interface SessionCopyRequest {
  sessionId: string
  expectedRevision: number
  targetSessionId: string
  createdAt: number
  scope: { type: 'session' } | { type: 'thread'; threadId: string }
  /** Replace source markers on the copied active path and append this new marker identity. */
  appendForkMarkerId?: string
}
export interface SessionThreadCopyRequest extends Omit<SessionCopyRequest, 'scope' | 'appendForkMarkerId'> {
  threadId: string
}

export interface SessionConversationStateRequest {
  sessionId: string
  messageIds?: readonly string[]
  expectedRevision?: number
}

export interface SessionConversationState {
  header: SessionHeader
  revision: number
  activeThreadId: string
  matchedMessageIds: string[]
  tailMessages: Message[]
  lastAssistantMessage?: Message
  lastSettledMessageId?: string
}

export interface SessionGenerationControlRequest {
  sessionId: string
  activeGenerationMessageIds: readonly string[]
  /** Stop/recovery may also collect stored generating references without reading message bodies. */
  includePersisted?: boolean
  expectedRevision?: number
}

export interface SessionGenerationControl {
  sessionId: string
  revision: number
  activeThreadId: string
  generatingReplyCount: number
  anyReplyGenerating: boolean
  awaitingPauseDecision: boolean
  pausedMessageIds: string[]
  latestMessageHasWebSearchSignInError: boolean
  cancellableMessageIds: string[]
  cancellableMessages: Array<{ messageId: string; threadId: string; branchId: string | null; forkPivotId?: string }>
}

/** Required row reads and commands shared by every application host. */
export interface SessionRowRepositoryPort
  extends SessionSearchRepositoryPort,
    SessionArtifactRepositoryPort,
    SessionPromptCacheRepositoryPort,
    SessionAttachmentRepositoryPort,
    SessionTokenRepositoryPort,
    SessionContextRepositoryPort,
    SessionMessageRepositoryPort,
    SessionTextTokenRepositoryPort {
  readSessionConversationState(request: SessionConversationStateRequest): Promise<SessionConversationState | null>
  initialize(): Promise<void>
  readPreviousUserMessage(sessionId: string, targetMessageId: string): Promise<Message | null>
  /** Status-index references across active, archived and inactive paths. */
  iterateSessionResourceReferences(
    sessionId: string,
    signal?: AbortSignal
  ): AsyncIterable<import('../backup/resources').ResourceReference>
  readSessionGeneratingMessageIds(sessionId: string): Promise<string[]>
  readSessionGenerationControl(request: SessionGenerationControlRequest): Promise<SessionGenerationControl | null>
  readSessionNamingMessages(request: {
    sessionId: string
    expectedRevision: number
  }): Promise<SessionMessagesSource | null>
  getCurrentThreadIdentity(sessionId: string): Promise<CurrentThreadIdentity | null>
  getSessionHeader(sessionId: string): Promise<SessionHeaderRead | null>
  /** Serialize a repairable external projection with commands and deletion; the callback must not reenter this owner. */
  projectLatestSession<T>(sessionId: string, project: (current: SessionHeaderRead | null) => Promise<T>): Promise<T>
  /** Metadata-only recovery must serialize without reading or migrating unreadable content. */
  projectSessionMetadata<T>(sessionId: string, project: () => Promise<T>): Promise<T>
  repairSessionRecordProjection(sessionId: string): Promise<void>
  readSessionBranchPreview(request: SessionBranchPreviewRequest): Promise<SessionBranchPreview | null>
  readSessionBranchMessagesPage(request: SessionBranchMessagesRequest): Promise<SessionBranchMessagesPage | null>
  readSessionTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null>
  readSessionNavigationPage(request: SessionTranscriptRequest): Promise<SessionNavigationPage | null>
  repairSessionNavigationProjections(request: SessionNavigationRepairRequest): Promise<void>
  readSessionThread(request: SessionThreadRequest): Promise<SessionThreadRead | null>
  readSessionThreadSummariesPage(request: SessionThreadPageRequest): Promise<SessionThreadSummariesPage | null>
  readSessionForkOptionsPage(request: SessionForkOptionsRequest): Promise<SessionForkOptionsPage | null>
  copySessionRows(request: SessionCopyRequest): Promise<SessionCommandDelta>
  copySessionThreadRows(request: SessionThreadCopyRequest): Promise<SessionCommandDelta>
  createSessionRows(header: SessionHeader, messages: readonly Message[]): Promise<SessionCommandDelta>
  executeSessionCommand(
    sessionId: string,
    command: SessionCommand,
    expectedRevision?: number
  ): Promise<{ kind: 'rows'; delta: SessionCommandDelta }>
  deleteSession(sessionId: string, projectDeletion?: () => Promise<void>): Promise<void>
  getAllSessionIds(): Promise<string[]>
}

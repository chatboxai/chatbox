import type { CompactionPoint, Message, SessionHeader, SessionThread } from '../../types/session'
import type { SessionContextReadProjection } from './context-read-projection'

export type MessageRowStatus = 'generating' | 'settled'
export type MessageRowKind = 'message' | 'summary'

/** Bounded facts derived when a message payload is written. */
export interface SessionMessageFacts {
  autoTitleEligible: boolean
  role: Message['role']
  contextEligible: boolean
  /** Capped at the prompt-cache confirmation threshold. */
  promptCacheChars: number
  hasToolCall: boolean
  isForkMarker?: boolean
  hasFiles: boolean
  fileResourceKeys?: string[]
  paused: boolean
  webSearchSignInError: boolean
  hasLegacyCommand: boolean
  steered: boolean
  hasError?: boolean
  finishReason?: Message['finishReason']
  timestamp?: number
  seedAttachments?: Array<{ name: string; storageKey: string; rawStorageKey?: string; id?: string }>
  imageStorageKeys: string[]
  attachmentOwnershipIds: number[]
}

/** Statistics of all rows on one thread's selected path, including summary rows. */
export interface SessionThreadSummary {
  firstNamingUserMessageId?: string
  lastNamingAssistantMessageId?: string
  hasAutoTitleContent: boolean
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  fileMessageCount: number
  generatingMessageCount: number
  pausedMessageCount: number
  webSearchSignInErrorCount: number
  legacyCommandMessageCount: number
  steeredMessageCount: number
  lastUserMessageId?: string
  lastNonSummaryMessageId?: string
  lastConversationMessageId?: string
  lastSummaryMessageId?: string
  firstSystemMessageId?: string
}

export interface MessageRow {
  sessionId: string
  threadId: string
  messageId: string
  /** null marks the thread root. */
  parentMessageId: string | null
  /**
   * Selected child at a branch point. Must name one of the row's children
   * unless the selected branch holds no messages, in which case it is null.
   * Leaves are null.
   */
  activeChildId: string | null
  /** Sibling order in row format 3. Legacy rows use a thread-wide DFS label. */
  seq: number
  kind: MessageRowKind
  status: MessageRowStatus
  createdAt: number
  updatedAt: number
  /** V1 fork list id, carried by branch heads only. */
  branchId: string | null
  forkCreatedAt?: number
  /** User pivot associated with this branch connection, including summary connections. */
  forkPivotId?: string
  /** Lightweight branch navigation projection stored on the user pivot. */
  fork?: {
    pivotId: string
    branchPointId: string
    selectedBranchId: string
    count: number
    position: number
  }
  /** Identity and sibling position of an empty selected branch, stored at its connection point. */
  pendingBranchId?: string
  pendingBranchSeq?: number
  /** Missing projection means unknown, never unselected. */
  selected?: boolean
  facts?: SessionMessageFacts
  /** Whole message, parts inlined; the structural fields above are not repeated inside it. */
  message: Message
}

export type MessageRowMetadata = Omit<MessageRow, 'message'>

export interface ThreadRow {
  sessionId: string
  threadId: string
  /** Position in `session.threads` for archived threads; -1 for the active thread. */
  seq: number
  /** null is reserved for an active V1 session whose threadName was absent. */
  name: string | null
  createdAt: number
  rootMessageId: string | null
  /** Leaf reached by following `activeChildId` from the root; decode checks it against the rows. */
  activeLeafMessageId: string | null
  compactionPoints: CompactionPoint[]
  sessionPromptContextSnapshot?: SessionThread['sessionPromptContextSnapshot']
  summary?: SessionThreadSummary
  /** All branches in this thread; selected-path presentation counts remain in summary. */
  control?: { generatingAssistantCount: number }
}

export type SessionRecordV2 = Omit<SessionHeader, 'threadName'> & {
  activeThreadId: string
  storageFormat: 'rows'
  rowFormatVersion?: 3
  /** Published with the rows and revision; the external record is a repairable projection. */
  rowAuthority?: 1
  /** Fork creation timestamps keyed by pivot message id. */
  forkCreatedAt?: Record<string, number>
  /** Derived read projection; absent projections require a complete-session read. */
  presentation?: SessionPresentationSummary
  contextReadProjection?: SessionContextReadProjection
  topologyFingerprint?: string
}

/** The business record contains header data and commit identity, never a session-wide topology map. */
export type SessionRowRecord = Omit<SessionHeader, 'threadName'> & {
  activeThreadId: string
  storageFormat: 'rows'
  rowFormatVersion: 3
  rowAuthority: 1
}

export interface SessionPresentationSummary {
  messageCount: number
  userMessageCount: number
  fileMessageCount: number
  generatingMessageCount: number
  pausedMessageCount: number
  hasThreads: boolean
  hasForks: boolean
  /** Rebuildable active-conversation facts used by the search sign-in warning. */
  webSearchSignInErrorCount?: number
  latestMessageHasWebSearchSignInError?: boolean
}

export interface SessionTree {
  session: SessionRecordV2
  threads: ThreadRow[]
  messages: MessageRow[]
}

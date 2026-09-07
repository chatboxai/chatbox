import type { CompactionPoint, Message, Session, SessionThread } from '../../types/session'
import type { SessionContextReadProjection } from './context-read-projection'

export type MessageRowStatus = 'generating' | 'settled'
export type MessageRowKind = 'message' | 'summary'

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
  /** DFS pre-order index inside the thread; strictly increasing on any root-to-leaf path. */
  seq: number
  kind: MessageRowKind
  status: MessageRowStatus
  createdAt: number
  updatedAt: number
  /** V1 fork list id, carried by branch heads only. */
  branchId: string | null
  /** Whole message, parts inlined; the structural fields above are not repeated inside it. */
  message: Message
}

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
}

export type SessionRecordV2 = Omit<
  Session,
  'messages' | 'threads' | 'threadName' | 'messageForksHash' | 'compactionPoints'
> & {
  activeThreadId: string
  storageFormat: 'rows'
  /** Fork creation timestamps keyed by pivot message id. */
  forkCreatedAt?: Record<string, number>
  /** Derived read projection; absent projections require a complete-session read. */
  presentation?: SessionPresentationSummary
  contextReadProjection?: SessionContextReadProjection
  topologyFingerprint?: string
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

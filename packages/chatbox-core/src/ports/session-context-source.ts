import type { MessageRow, ThreadRow } from '../session/session-tree/types'
import type { CompactionPoint, Message } from '../types/session'
import type { SessionHeader } from './session-read-model'
import type { SessionRowCommit } from './session-row-store'
import type { SessionTextTokenRead } from './session-text-tokens'

export interface SessionContextRequest {
  sessionId: string
  threadId?: string
  /** Selects this message's causal path. Omission selects the thread's active path. */
  targetMessageId?: string
  /** A specified target is excluded by default, as required for retry/generation. */
  includeTarget?: boolean
  expectedRevision?: number
  /** Apply the resolved send history limit before reading message bodies. Omission means unlimited. */
  maxContextMessageCount?: number
  /** Reserve the current-input slot when the caller will append a pending user turn. */
  reserveCurrentInput?: boolean
  /** Freeze the target's isolated conversation identities for generation steering. */
  includeConversationIds?: boolean
}

export interface SessionContextSeedAttachment {
  name: string
  storageKey: string
  rawStorageKey?: string
  id?: string
}

/** Facts about the real path before the target, including messages omitted by compaction. */
export interface SessionContextBeforeTarget {
  firstMessageTimestamp?: number
  userMessageCount: number
  hasAssistantMessage: boolean
  hasLegacyCommandHistory: boolean
  lastUserMessageId?: string
  sandboxSeedAttachments: SessionContextSeedAttachment[]
  fileResourceKeys: string[]
}

/** Validated causal identity and complete content for reading, not a writable row. */
export type SessionContextMessage = Pick<
  MessageRow,
  'sessionId' | 'threadId' | 'messageId' | 'parentMessageId' | 'siblingOrder' | 'message'
>

export interface SessionContextRows extends SessionRowCommit {
  textTokens?: SessionTextTokenRead
  thread: ThreadRow
  activeThreadName?: string
  messages: SessionContextMessage[]
  targetMessage?: Message
  mode: 'compacted' | 'full-path'
  beforeTarget: SessionContextBeforeTarget
  effectiveCompactionPoint?: CompactionPoint
}

/** A read-only context input. It is never a complete Session or a write snapshot. */
export interface SessionContextSource {
  textTokens?: SessionTextTokenRead
  header: SessionHeader
  thread: ThreadRow
  revision: number | null
  candidateMessages: Message[]
  compactionPoints: CompactionPoint[]
  targetMessage?: Message
  mode: 'compacted' | 'full-path'
  beforeTarget: SessionContextBeforeTarget
  effectiveCompactionPoint?: CompactionPoint
  /** Identities of the causal path, including entries omitted by compaction. */
  pathMessageIds: readonly string[]
  conversationMessageIds?: readonly string[]
}

export interface SessionContextRepositoryPort {
  getSessionContextSource(request: SessionContextRequest): Promise<SessionContextSource | null>
}

import type { SessionAction } from '../session/action-gates'
import type { ForkCommandIdentity, SessionForkOperation } from './session-fork-command'
import type { Message } from '../types'
import type { CompactionCoverage } from '../application/context/compaction-types'

export interface CurrentThreadIdentity {
  sessionId: string
  firstMessageId: string | undefined
  lastArchivedThreadId: string | undefined
}

export type SessionThreadOperation =
  | {
      action: 'thread-title-commit'
      threadId: string
      expectedFirstNamingUserMessageId: string | null
      name: string
      mode: 'name-and-thread' | 'thread'
      onlyPending?: boolean
    }
  | { action: 'thread-rename'; threadId: string; name: string | undefined }
  | {
      action: 'thread-create'
      archiveId: string
      now: number
      systemMessageId: string
      defaultSystemPrompt: string
      summary?: { messageId: string; text: string }
    }
  | { action: 'thread-switch'; threadId: string; archiveId: string; now: number }
  | {
      action: 'thread-delete'
      threadId: string
      expectedRevision?: number
      expectedCurrent?: CurrentThreadIdentity
      onlyEmpty?: boolean
    }

export interface SessionMessageStructureGuard {
  action: SessionAction
  compactionRunning?: boolean
  activeGenerationMessageIds?: ReadonlySet<string>
}

export type SessionMessageStructureOperation = { guard?: SessionMessageStructureGuard } & (
  | {
      action: 'generation-segment-split'
      prefix: Message
      continuation: Message
      afterMessageId: string
      abortSignal?: AbortSignal
    }
  | {
      action: 'background-follow-up'
      originMessageId: string
      originToolCallId: string
      userMessage: Message
      assistantMessage: Message
      now: number
    }
  | { action: 'message-retry'; messageId: string; reply: Message; identity: ForkCommandIdentity }
  | { action: 'message-recover'; messageId: string; replacementPivotId: string; bootTime: number; now: number }
  | { action: 'message-remove'; messageId: string; replacementPivotId: string }
  | { action: 'message-insert-after'; message: Message; previousId: string; requireAnchor?: boolean }
  | { action: 'session-clear'; scope: 'active' | 'all' }
  | { action: 'set-system-prompt'; text: string; messageId: string; replacementPivotId: string; now: number }
)

export interface SessionCompactionOperation {
  action: 'compaction-commit'
  threadId: string
  summary: Message
  coverage: CompactionCoverage
  pathMessageIds: readonly string[]
  createdAt: number
  /** Cancellation is checked inside the command owner, before publishing rows. */
  abortSignal?: AbortSignal
}

export type SessionStructureOperation = (
  | SessionThreadOperation
  | SessionForkOperation
  | SessionMessageStructureOperation
  | SessionCompactionOperation
) & { activeGenerationMessageIds?: readonly string[] }

/** Facts whose side effects become eligible only after the content commit. */
export interface SessionStructureResult {
  applied: boolean
  backgroundFollowUpStatus?: 'inserted' | 'deferred' | 'target-missing'
  replyMessageId?: string
  affectedScopes?: Array<
    | { type: 'session' }
    | { type: 'thread'; threadId: string }
    | { type: 'subtree'; threadId: string; rootMessageId: string }
  >
  currentThreadTarget?: CurrentThreadIdentity
  cancelMessageIds: string[]
  /** Message ids whose live runtimes must be checked when the content commit completes. */
  affectedMessageIds?: string[]
  navigation?:
    | {
        type: 'branch'
        mode: 'create' | 'select'
        sharedPrefixEnd: { threadId: string; messageId: string }
        firstMessageId: string | null
      }
    | { type: 'thread-switch'; threadId: string }
}

import type { SessionAction } from '../session/action-gates'
import type { SessionForkOperation } from './session-fork-command'
import type { Message } from '../types'

export interface CurrentThreadIdentity {
  sessionId: string
  firstMessageId: string | undefined
  lastArchivedThreadId: string | undefined
}

export type SessionThreadOperation =
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
  | { action: 'thread-delete'; threadId: string; expectedCurrent?: CurrentThreadIdentity; onlyEmpty?: boolean }

export interface SessionMessageStructureGuard {
  action: SessionAction
  compactionRunning?: boolean
  activeGenerationMessageIds?: ReadonlySet<string>
}

export type SessionMessageStructureOperation = { guard?: SessionMessageStructureGuard } & (
  | { action: 'message-remove'; messageId: string; replacementPivotId: string }
  | { action: 'message-insert-after'; message: Message; previousId: string; requireAnchor?: boolean }
  | { action: 'session-clear'; scope: 'active' | 'all' }
)

export type SessionStructureOperation = SessionThreadOperation | SessionForkOperation | SessionMessageStructureOperation

/** Facts whose side effects become eligible only after the content commit. */
export interface SessionStructureResult {
  applied: boolean
  currentThreadTarget?: CurrentThreadIdentity
  cancelMessageIds: string[]
  /** Message ids whose live runtimes must be checked when the content commit completes. */
  affectedMessageIds?: string[]
  removedMessages?: Message[]
  survivingMessages?: Message[]
}

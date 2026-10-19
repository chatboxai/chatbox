export const DEFAULT_TRANSCRIPT_PAGE_BYTES = 2 * 1024 * 1024

import type { MessageRow, ThreadRow } from '../session/session-tree/types'
import type { SessionRowCommit } from './session-row-store'

export type SessionTranscriptThread = Pick<
  ThreadRow,
  | 'sessionId'
  | 'threadId'
  | 'seq'
  | 'name'
  | 'createdAt'
  | 'rootMessageId'
  | 'activeLeafMessageId'
  | 'summary'
  | 'control'
>

export type SessionTranscriptOrigin =
  | 'head'
  | 'tail'
  | { messageId: string; align?: 'center' }
  | { threadId: string; edge: 'head' | 'tail'; align?: 'center' }

export interface SessionTranscriptCursor {
  sessionId: string
  revision: number
  threadId: string
  threadSeq: number
  /** Null anchors an explicitly selected empty thread. */
  messageId: string | null
  direction: 'before' | 'after'
  limit: number
  maxBytes: number
  scope: 'transcript' | 'navigation'
}

export interface SessionTranscriptRequest {
  sessionId: string
  /** Host page size; 20 on RN/Capacitor, 50 on Electron/Web. */
  limit: number
  /** Shared page budget; one oversized message may occupy a page by itself. */
  maxBytes?: number
  origin?: SessionTranscriptOrigin
  cursor?: SessionTranscriptCursor
  expectedRevision?: number
}

export interface SessionTranscriptAnchor {
  threadId: string
  messageId: string | null
}

export interface SessionTranscriptPage extends SessionRowCommit {
  messages: MessageRow[]
  forks?: Array<NonNullable<MessageRow['fork']>>
  payloadBytes: number
  threads: SessionTranscriptThread[]
  anchor: SessionTranscriptAnchor
  older: SessionTranscriptCursor | null
  newer: SessionTranscriptCursor | null
}

export interface SessionThreadRequest {
  sessionId: string
  /** Omission selects the active thread. */
  threadId?: string
  expectedRevision?: number
}

export interface SessionThreadRead extends SessionRowCommit {
  thread: SessionTranscriptThread
}

/** Rebuildable bounded text derived when the payload is written. */
export interface SessionMessageNavigationProjection {
  role: MessageRow['message']['role']
  eligible: boolean
  preview: string
}

export interface SessionNavigationEntry extends SessionTranscriptAnchor {
  messageId: string
  preview: string
  assistantMessageId?: string
  assistantPreview?: string
  /** The next selected messages are outside this navigation page. */
  assistantPending?: boolean
}

export interface SessionNavigationPage extends SessionRowCommit {
  entries: SessionNavigationEntry[]
  /** First eligible assistant before a page's first user; links an adjacent page's pending user. */
  leadingAssistant?: { threadId: string; messageId: string; preview: string }
  threads: SessionTranscriptThread[]
  anchor: SessionTranscriptAnchor
  older: SessionTranscriptCursor | null
  newer: SessionTranscriptCursor | null
  /** Selected payloads needing a separate, source-bound projection repair. */
  needsProjection: string[]
}

export interface SessionNavigationRepairRequest {
  sessionId: string
  messageIds: string[]
  expectedRevision: number
}

export interface SessionTranscriptStorePort {
  repairNavigationProjections(request: SessionNavigationRepairRequest): Promise<void>
  readCommit(sessionId: string): Promise<SessionRowCommit | null>
  readThread(request: SessionThreadRequest): Promise<SessionThreadRead | null>
  readTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null>
  /** Reads bounded metadata/projections only; never hydrates message payloads. */
  readNavigationPage(request: SessionTranscriptRequest): Promise<SessionNavigationPage | null>
}

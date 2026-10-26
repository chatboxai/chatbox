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
  scope: 'transcript'
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

export interface SessionTranscriptStorePort {
  readCommit(sessionId: string): Promise<SessionRowCommit | null>
  readThread(request: SessionThreadRequest): Promise<SessionThreadRead | null>
  readTranscriptWindow(request: SessionTranscriptRequest): Promise<SessionTranscriptPage | null>
}

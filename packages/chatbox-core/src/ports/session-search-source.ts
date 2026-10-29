import type { SessionHeaderRead } from './session-row-repository'
import type { SessionTranscriptCursor, SessionTranscriptPage } from './session-transcript-source'

export interface SessionSearchWindowRequest {
  sessionId: string
  /** An older continuation is revalidated against the current selected path. */
  cursor?: SessionTranscriptCursor
  /** Revalidate one candidate body; missing or unselected candidates return no page. */
  messageId?: string
  signal?: AbortSignal
}

export interface SessionSearchWindow {
  current: SessionHeaderRead
  page: SessionTranscriptPage | null
}

export interface SessionSearchCandidatesRequest {
  sessionId: string
  messageIds: readonly string[]
  signal?: AbortSignal
}

export interface SessionSearchCandidates {
  current: SessionHeaderRead
  selectedMessageIds: string[]
}

export interface SessionSearchRepositoryPort {
  /** One serialized read batch: at most 50 bodies / 2 MiB, or one oversized body. */
  readSessionSearchWindow(request: SessionSearchWindowRequest): Promise<SessionSearchWindow | null>
  /** Current header and selected identities for at most 100 result candidates; no bodies. */
  readSessionSearchCandidates(request: SessionSearchCandidatesRequest): Promise<SessionSearchCandidates | null>
}

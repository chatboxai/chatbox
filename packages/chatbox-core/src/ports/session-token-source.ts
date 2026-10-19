import type { SessionTokenCacheEntry, SessionTokenCacheResult } from './session-token-cache'
import type { Message, SessionHeader } from '../types/session'
import type { ThreadRow } from '../session/session-tree/types'
import type { SessionContextBeforeTarget } from './session-context-source'
import type { SessionTextTokenRead } from './session-text-tokens'

export interface SessionTokenPlanRequest {
  sessionId: string
  threadId?: string
  maxContextMessageCount?: number
  expectedRevision?: number
}

/** Private estimation job input, held separately from the transcript and released when the job finishes. */
export interface SessionTokenPlan {
  sessionId: string
  revision: number
  header: SessionHeader
  thread: ThreadRow
  beforeTarget: SessionContextBeforeTarget
  messageIds: string[]
  canManualCompact: boolean
}

export interface SessionTokenPageRequest {
  plan: SessionTokenPlan
  offset: number
  limit: number
  cacheKey: string
  maxBytes?: number
}

export interface SessionTokenPage {
  sessionId: string
  revision: number
  messages: Message[]
  entries: SessionTokenCacheEntry[]
  textTokens?: SessionTextTokenRead
  nextOffset: number | null
}

export interface SessionTokenRepositoryPort {
  acceptSessionTokenCacheResults(sessionId: string, results: readonly SessionTokenCacheResult[]): Promise<void>
  createSessionTokenPlan(request: SessionTokenPlanRequest): Promise<SessionTokenPlan | null>
  readSessionTokenPage(request: SessionTokenPageRequest): Promise<SessionTokenPage>
}

import type { SessionPresentationSummary } from '../session/session-tree/types'
import type { Message, Session } from '../types/session'
import type {
  SessionMessageWindow,
  SessionMessageWindowRequest,
  SessionThreadPageRequest,
  SessionThreadPageCursor,
} from './session-row-store'
import type { SessionTextTokenRead } from './session-text-tokens'

export interface CompleteSessionSource {
  session: Session
  textTokens?: SessionTextTokenRead
  /** Identity of the same atomic row snapshot as session. */
  topologyFingerprint?: string
  revision?: number
}

/** Metadata cannot be mistaken for a complete session by mutation consumers. */
export type SessionHeader = Omit<Session, 'messages' | 'threads' | 'messageForksHash' | 'compactionPoints'>

export type SessionReadModel =
  | { kind: 'full'; session: Session; textTokens?: SessionTextTokenRead; revision?: number }
  | { kind: 'window'; header: SessionHeader; summary: SessionPresentationSummary; window: SessionMessageWindow }

export type SessionSearchThreadsPageRequest = SessionThreadPageRequest

/** Stores with thread paging return only search metadata; other stores retain their complete-session fallback. */
export type SessionSearchThreadsPage =
  | { kind: 'full'; session: Session }
  | {
      kind: 'rows'
      header: SessionHeader
      revision: number
      threadIds: string[]
      nextCursor: SessionThreadPageCursor | null
    }

export interface SessionReadRepositoryPort {
  getCompleteSessionSource?(id: string): Promise<CompleteSessionSource | null>
  readSessionSearchThreadsPage(request: SessionSearchThreadsPageRequest): Promise<SessionSearchThreadsPage | null>
  getSessionReadModel(id: string): Promise<SessionReadModel | null>
  readSessionMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null>
}

export function sessionReadModelHeader(model: SessionReadModel): SessionHeader {
  if (model.kind === 'window') return model.header
  const {
    messages: _messages,
    threads: _threads,
    messageForksHash: _forks,
    compactionPoints: _points,
    ...header
  } = model.session
  return header
}

/** Only this transcript projection may contain a partial message array. */
export interface SessionTranscript {
  header: SessionHeader
  messages: Message[]
}

import type { SessionService } from './SessionService'
import type { SessionRowRepositoryPort } from '../../ports/session-row-repository'

/** Row-oriented application surface used by thread and naming use cases. */
export type SessionUseCasePort = Pick<
  SessionService,
  | 'getCurrentThreadIdentity'
  | 'executeStructureCommand'
  | 'getSessionHeader'
  | 'readSessionThread'
  | 'readSessionTranscriptWindow'
  | 'readSessionMessages'
  | 'updateSessionHeader'
> &
  Pick<SessionRowRepositoryPort, 'readSessionNamingMessages'>

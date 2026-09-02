import type { Session, Updater } from '../../types'
import type { SessionMetadataUpdate } from './session-metadata'

/**
 * Minimal Session application surface used by the surrounding session use
 * cases. The current Renderer adapts its existing chatStore facade, while a
 * native host can provide the same operations from its SessionService.
 */
export interface SessionUseCasePort {
  getSession(sessionId: string): Promise<Session | null>
  updateSession(sessionId: string, updater: Updater<SessionMetadataUpdate>): Promise<Session>
  updateSessionWithMessages(sessionId: string, updater: Updater<Session>): Promise<Session>
}

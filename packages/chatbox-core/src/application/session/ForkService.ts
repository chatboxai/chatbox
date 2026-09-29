import { assertSessionActionAllowed, deriveSessionLockState } from '../../session/action-gates'
import { resolveSessionMode } from '../../session/mode-policy'
import type { ForkIdentityPort } from '../../session/message-forks'
import {
  buildCreateForkPatch,
  buildDeleteForkPatch,
  buildExpandForkPatch,
  buildSwitchForkPatch,
} from '../../session/message-forks'
import type { Session } from '../../types'
import type { SessionService, UpdateSessionOptions } from './SessionService'

/**
 * Application service for message-fork use cases.
 *
 * Pure branch transforms remain in the Session domain; this service owns the
 * atomic read-modify-write orchestration through the Session application port.
 */
export class ForkService {
  constructor(
    private readonly sessions: Pick<SessionService, 'updateSessionWithMessages'>,
    private readonly identity: ForkIdentityPort,
    private readonly runtime: (sessionId: string) => Parameters<typeof deriveSessionLockState>[1] = () => ({})
  ) {}

  create(sessionId: string, forkMessageId: string): Promise<void> {
    return this.apply(sessionId, (session) => buildCreateForkPatch(session, forkMessageId, this.identity))
  }

  switch(sessionId: string, forkMessageId: string, direction: 'next' | 'prev'): Promise<void> {
    return this.apply(
      sessionId,
      (session) => {
        assertSessionActionAllowed('switch-fork', deriveSessionLockState(session, this.runtime(sessionId)), {
          sessionMode: resolveSessionMode(session.settings?.agentMode?.value),
        })
        return buildSwitchForkPatch(session, forkMessageId, direction)
      },
      { preserveCachedGeneratingMessages: true }
    )
  }

  delete(sessionId: string, forkMessageId: string): Promise<void> {
    return this.apply(sessionId, (session) => buildDeleteForkPatch(session, forkMessageId))
  }

  expand(sessionId: string, forkMessageId: string): Promise<void> {
    return this.apply(sessionId, (session) => buildExpandForkPatch(session, forkMessageId))
  }

  private async apply(
    sessionId: string,
    transform: (session: Session) => Partial<Session> | null,
    options: UpdateSessionOptions = {}
  ): Promise<void> {
    await this.sessions.updateSessionWithMessages(
      sessionId,
      (session) => {
        if (!session) {
          throw new Error('Session not found')
        }
        const patch = transform(session)
        return patch ? { ...session, ...patch } : session
      },
      options
    )
  }
}

import type { SessionForkOperation, ForkCommandIdentity } from '../../ports/session-fork-command'
import type { SessionStructureResult } from '../../ports/session-structure-command'
import type { deriveSessionLockState } from '../../session/action-gates'
import type { ForkIdentityPort } from '../../session/message-forks'
import type { Message } from '../../types'
import type { SessionService } from './SessionService'
import { applyForkStructure } from './session-fork-command'

export function createForkCommandIdentity(identity: ForkIdentityPort): ForkCommandIdentity {
  return {
    seedListId: identity.createId(),
    storedListId: identity.createId(),
    newListId: identity.createId(),
    createdAt: identity.now(),
  }
}

/** Coordinates durable fork edits and their post-commit side effects. */
export class ForkService {
  constructor(
    private readonly sessions: Pick<SessionService, 'updateSessionWithMessages'> &
      Partial<Pick<SessionService, 'executeStructureCommand'>>,
    private readonly identity: ForkIdentityPort,
    private readonly runtime: (sessionId: string) => Parameters<typeof deriveSessionLockState>[1] = () => ({})
  ) {}

  async create(sessionId: string, pivotId: string): Promise<void> {
    await this.apply(sessionId, { action: 'fork-create', pivotId, identity: createForkCommandIdentity(this.identity) })
  }

  async switch(sessionId: string, pivotId: string, target: 'next' | 'prev' | number): Promise<void> {
    await this.apply(sessionId, {
      action: 'fork-switch',
      pivotId,
      target,
      guard: { action: 'switch-fork', ...this.runtime(sessionId) },
    })
  }

  async delete(
    sessionId: string,
    pivotId: string,
    onCommitted?: (result: SessionStructureResult) => void
  ): Promise<void> {
    await this.apply(sessionId, { action: 'fork-delete', pivotId }, onCommitted)
  }

  async saveAndResend(
    sessionId: string,
    targetMessageId: string,
    replacement: Message,
    onCommitted?: (result: SessionStructureResult) => void
  ): Promise<SessionStructureResult> {
    return this.apply(
      sessionId,
      { action: 'fork-save-resend', targetMessageId, replacement, identity: createForkCommandIdentity(this.identity) },
      onCommitted
    )
  }

  async expand(sessionId: string, pivotId: string): Promise<void> {
    await this.apply(sessionId, { action: 'fork-expand', pivotId })
  }

  private async apply(
    sessionId: string,
    operation: SessionForkOperation,
    onCommitted?: (result: SessionStructureResult) => void
  ): Promise<SessionStructureResult> {
    const committed = await this.sessions.executeStructureCommand?.(sessionId, operation, onCommitted)
    if (committed) return committed
    let result: SessionStructureResult = { applied: false, cancelMessageIds: [] }
    await this.sessions.updateSessionWithMessages(
      sessionId,
      (session) => {
        if (!session) throw new Error('Session not found')
        const transformed = applyForkStructure(session, operation)
        result = transformed.result
        return transformed.session
      },
      { preserveCachedGeneratingMessages: true, onFullSessionPersisted: () => onCommitted?.(result) }
    )
    return result
  }
}

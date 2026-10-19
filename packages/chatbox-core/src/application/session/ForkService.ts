import type { SessionForkOperation, ForkCommandIdentity } from '../../ports/session-fork-command'
import type { SessionStructureResult } from '../../ports/session-structure-command'
import type { ForkIdentityPort } from '../../session/message-forks'
import type { Message } from '../../types'
import type { SessionService } from './SessionService'

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
    private readonly sessions: Pick<SessionService, 'executeStructureCommand'>,
    private readonly identity: ForkIdentityPort,
    private readonly runtime: (sessionId: string) => {
      compactionRunning?: boolean
      activeGenerationMessageIds?: ReadonlySet<string>
    } = () => ({})
  ) {}

  async create(sessionId: string, pivotId: string): Promise<void> {
    await this.apply(sessionId, { action: 'fork-create', pivotId, identity: createForkCommandIdentity(this.identity) })
  }

  async switch(sessionId: string, pivotId: string, target: 'next' | 'prev' | { branchId: string }): Promise<void> {
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
    const committed = await this.sessions.executeStructureCommand(
      sessionId,
      {
        ...operation,
        activeGenerationMessageIds: [...(this.runtime(sessionId)?.activeGenerationMessageIds ?? [])],
      },
      onCommitted
    )
    if (!committed) throw new Error('Structure command did not return a result')
    return committed
  }
}

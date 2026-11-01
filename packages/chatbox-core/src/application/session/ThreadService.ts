import type { SessionHeader, SessionThread } from '../../types'
import type { SessionStructureResult, SessionThreadOperation } from '../../ports/session-structure-command'
import type { SessionUseCasePort } from './session-use-case-port'

/** Identity of the visible conversation, independent of the reusable session ID. */
export interface CurrentThreadTarget {
  sessionId: string
  firstMessageId: string | undefined
  lastArchivedThreadId: string | undefined
}

export interface ThreadServiceDependencies {
  sessions: Pick<
    SessionUseCasePort,
    'getCurrentThreadIdentity' | 'executeStructureCommand' | 'getSessionHeader' | 'readSessionThread'
  >
  createId(): string
  now(): number
  getDefaultSystemPrompt(): string
  getLiveMessageIds?(sessionId: string): ReadonlySet<string>
  subscribeGenerationRuntime?(listener: () => void): () => void
  cancelMessageIds?(sessionId: string, messageIds: string[]): void
  copyThread(source: { sessionId: string; threadId: string; expectedRevision: number }): Promise<SessionHeader>
}

/**
 * Host-neutral orchestration for thread/history use cases. UI effects such as
 * scrolling, focusing and route changes are intentionally returned to the
 * caller instead of being performed here.
 */
export class ThreadService {
  constructor(private readonly dependencies: ThreadServiceDependencies) {}

  private cancellationIds(
    sessionId: string,
    result: SessionStructureResult,
    everLiveIds: ReadonlySet<string>
  ): Set<string> {
    const liveIds = this.dependencies.getLiveMessageIds?.(sessionId)
    const ids = new Set(result.cancelMessageIds.filter((id) => !everLiveIds.has(id) || liveIds?.has(id)))
    for (const id of result.affectedMessageIds ?? []) if (liveIds?.has(id)) ids.add(id)
    return ids
  }

  private cancelCommitted(sessionId: string, result: SessionStructureResult, everLiveIds: ReadonlySet<string>): void {
    const ids = this.cancellationIds(sessionId, result, everLiveIds)
    if (ids.size) this.dependencies.cancelMessageIds?.(sessionId, [...ids])
  }

  private async execute(sessionId: string, operation: SessionThreadOperation): Promise<SessionStructureResult> {
    const liveAtStart = new Set(this.dependencies.getLiveMessageIds?.(sessionId) ?? [])
    const everLiveIds = new Set(liveAtStart)
    const unsubscribe = this.dependencies.subscribeGenerationRuntime?.(() => {
      for (const id of this.dependencies.getLiveMessageIds?.(sessionId) ?? []) everLiveIds.add(id)
    })
    try {
      const committed = await this.dependencies.sessions.executeStructureCommand(
        sessionId,
        {
          ...operation,
          activeGenerationMessageIds: [...liveAtStart],
        },
        (result) => this.cancelCommitted(sessionId, result, everLiveIds)
      )
      if (!committed) throw new Error('Structure command did not return a result')
      return committed
    } finally {
      unsubscribe?.()
    }
  }

  private identity(sessionId: string): Promise<CurrentThreadTarget | null> {
    return this.dependencies.sessions.getCurrentThreadIdentity(sessionId)
  }

  async edit(sessionId: string, threadId: string, update: Pick<Partial<SessionThread>, 'name'>): Promise<boolean> {
    if (!(await this.identity(sessionId))) return false
    return (await this.execute(sessionId, { action: 'thread-rename', threadId, name: update.name })).applied
  }

  async remove(sessionId: string, threadId: string, expectedCurrent?: CurrentThreadTarget): Promise<boolean> {
    const current = await this.identity(sessionId)
    if (!current) return false
    return (
      await this.execute(sessionId, {
        action: 'thread-delete',
        threadId,
        expectedCurrent,
      })
    ).applied
  }

  async switch(sessionId: string, threadId: string): Promise<boolean> {
    if (!(await this.identity(sessionId))) return false
    return (
      await this.execute(sessionId, {
        action: 'thread-switch',
        threadId,
        archiveId: this.dependencies.createId(),
        now: this.dependencies.now(),
      })
    ).applied
  }

  async refreshContextAndCreateNew(sessionId: string): Promise<boolean> {
    return (await this.createWithRollback(sessionId)) !== null
  }

  async createWithRollback(sessionId: string): Promise<CurrentThreadTarget | null> {
    if (!(await this.identity(sessionId))) return null
    const archiveId = this.dependencies.createId()
    const result = await this.execute(sessionId, {
      action: 'thread-create',
      archiveId,
      now: this.dependencies.now(),
      systemMessageId: this.dependencies.createId(),
      defaultSystemPrompt: this.dependencies.getDefaultSystemPrompt(),
    })
    return result.currentThreadTarget ?? null
  }

  async removeCurrent(sessionId: string, expectedCurrent?: CurrentThreadTarget): Promise<boolean> {
    const source = await this.dependencies.sessions.getSessionHeader(sessionId)
    const identity = expectedCurrent ?? (await this.identity(sessionId))
    if (!source || !identity) return false
    return this.remove(sessionId, source.activeThreadId, identity)
  }

  async rollbackCreated(target: CurrentThreadTarget): Promise<boolean> {
    const source = await this.dependencies.sessions.getSessionHeader(target.sessionId)
    if (!source) return false
    return (
      await this.execute(target.sessionId, {
        action: 'thread-delete',
        threadId: source.activeThreadId,
        expectedCurrent: target,
        onlyEmpty: true,
      })
    ).applied
  }

  async compressAndCreate(sessionId: string, summary: string): Promise<boolean> {
    if (!(await this.identity(sessionId))) return false
    const archiveId = this.dependencies.createId()
    return (
      await this.execute(sessionId, {
        action: 'thread-create',
        archiveId,
        now: this.dependencies.now(),
        systemMessageId: this.dependencies.createId(),
        defaultSystemPrompt: this.dependencies.getDefaultSystemPrompt(),
        summary: { messageId: this.dependencies.createId(), text: summary },
      })
    ).applied
  }

  async moveToConversation(sessionId: string, threadId: string): Promise<string | null> {
    const source = await this.dependencies.sessions.getSessionHeader(sessionId)
    if (!source) return null
    const targetThreadId = threadId
    const target = await this.dependencies.sessions.readSessionThread({
      sessionId,
      threadId: targetThreadId,
      expectedRevision: source.revision,
    })
    if (!target) return null
    const copied = await this.dependencies.copyThread({
      sessionId,
      threadId: targetThreadId,
      expectedRevision: source.revision,
    })
    await this.execute(sessionId, {
      action: 'thread-delete',
      threadId: targetThreadId,
      expectedRevision: source.revision,
    })
    return copied.id
  }

  async moveCurrentToConversation(sessionId: string): Promise<string | null> {
    const source = await this.dependencies.sessions.getSessionHeader(sessionId)
    return source ? this.moveToConversation(sessionId, source.activeThreadId) : null
  }
}

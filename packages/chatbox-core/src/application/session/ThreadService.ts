import { getReachableSessionMessages } from '../../session/generation-state'
import type { Message, Session, SessionThread } from '../../types'
import type { SessionStructureResult, SessionThreadOperation } from '../../ports/session-structure-command'
import { applyThreadStructure } from './session-thread-command'
import type { SessionUseCasePort } from './session-use-case-port'

/** Identity of the visible conversation, independent of the reusable session ID. */
export interface CurrentThreadTarget {
  sessionId: string
  firstMessageId: string | undefined
  lastArchivedThreadId: string | undefined
}

export function getCurrentThreadTarget(session: Session): CurrentThreadTarget {
  return {
    sessionId: session.id,
    firstMessageId: session.messages[0]?.id,
    lastArchivedThreadId: session.threads?.at(-1)?.id,
  }
}

export interface ThreadServiceDependencies {
  sessions: SessionUseCasePort
  createId(): string
  now(): number
  getDefaultSystemPrompt(): string
  getLiveMessageIds?(sessionId: string): ReadonlySet<string>
  cancelMessageIds?(sessionId: string, messageIds: string[]): void
  cancelMessages(sessionId: string, messages: Message[]): void
  copySession(source: Session): Promise<Session>
}

/**
 * Host-neutral orchestration for thread/history use cases. UI effects such as
 * scrolling, focusing and route changes are intentionally returned to the
 * caller instead of being performed here.
 */
export class ThreadService {
  constructor(private readonly dependencies: ThreadServiceDependencies) {}

  private cancellationIds(sessionId: string, result: SessionStructureResult): Set<string> {
    const ids = new Set(result.cancelMessageIds)
    const liveIds = this.dependencies.getLiveMessageIds?.(sessionId)
    for (const id of result.affectedMessageIds ?? []) if (liveIds?.has(id)) ids.add(id)
    return ids
  }

  private cancelCommitted(sessionId: string, result: SessionStructureResult): void {
    const ids = this.cancellationIds(sessionId, result)
    if (ids.size) this.dependencies.cancelMessageIds?.(sessionId, [...ids])
  }

  private async execute(sessionId: string, operation: SessionThreadOperation): Promise<SessionStructureResult> {
    const committed = this.dependencies.cancelMessageIds
      ? await this.dependencies.sessions.executeStructureCommand?.(sessionId, operation, (result) =>
          this.cancelCommitted(sessionId, result)
        )
      : null
    if (committed) return committed
    let result: SessionStructureResult = { applied: false, cancelMessageIds: [] }
    await this.dependencies.sessions.updateSessionWithMessages(sessionId, (current) => {
      if (!current) throw new Error(`Session ${sessionId} not found`)
      const transformed = applyThreadStructure(current, operation)
      result = transformed.result
      const ids = this.cancellationIds(sessionId, result)
      if (ids.size)
        this.dependencies.cancelMessages(
          sessionId,
          getReachableSessionMessages(current).filter((message) => ids.has(message.id))
        )
      return transformed.session
    })
    return result
  }

  private async identity(sessionId: string): Promise<CurrentThreadTarget | null> {
    if (this.dependencies.sessions.getCurrentThreadIdentity)
      return this.dependencies.sessions.getCurrentThreadIdentity(sessionId)
    const session = await this.dependencies.sessions.getSession(sessionId)
    return session ? getCurrentThreadTarget(session) : null
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
        expectedCurrent: threadId === sessionId ? (expectedCurrent ?? current) : undefined,
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
    return this.remove(sessionId, sessionId, expectedCurrent)
  }

  async rollbackCreated(target: CurrentThreadTarget): Promise<boolean> {
    return (
      await this.execute(target.sessionId, {
        action: 'thread-delete',
        threadId: target.sessionId,
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
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session) return null
    if (session.id === threadId) {
      return this.moveCurrentToConversationFromSession(session)
    }

    const target = session.threads?.find((thread) => thread.id === threadId)
    if (!target) return null
    const copied = await this.dependencies.copySession({
      ...session,
      name: target.name,
      messages: target.messages,
      threads: [],
      threadName: target.name,
      messageForksHash: session.messageForksHash,
      compactionPoints: target.compactionPoints,
      settings: session.settings
        ? { ...session.settings, sessionPromptContextSnapshot: target.sessionPromptContextSnapshot }
        : session.settings,
    })
    await this.remove(sessionId, threadId)
    return copied.id
  }

  async moveCurrentToConversation(sessionId: string): Promise<string | null> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    return session ? this.moveCurrentToConversationFromSession(session) : null
  }

  private async moveCurrentToConversationFromSession(session: Session): Promise<string> {
    const copied = await this.dependencies.copySession({
      ...session,
      name: session.threadName || session.name,
      messages: session.messages,
      threads: [],
      // A still-pending thread ('') stays pending in the promoted copy so it
      // keeps its first-reply AI naming instead of freezing the session name.
      threadName: session.threadName ?? '',
      messageForksHash: session.messageForksHash,
    })
    await this.removeCurrent(session.id, getCurrentThreadTarget(session))
    return copied.id
  }
}

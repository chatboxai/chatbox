import { getConversationMessages, getCurrentConversationMessages } from '../../session/generation-state'
import type { Message, Session, SessionThread } from '../../types'
import { getMessageText } from '../../utils/message'
import type { SessionUseCasePort } from './session-use-case-port'

export interface ThreadServiceDependencies {
  sessions: SessionUseCasePort
  createId(): string
  now(): number
  getDefaultSystemPrompt(): string
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

  async edit(sessionId: string, threadId: string, update: Pick<Partial<SessionThread>, 'name'>): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session?.threads) return false

    if (threadId === sessionId) {
      await this.dependencies.sessions.updateSession(sessionId, { threadName: update.name })
      return true
    }

    if (!session.threads.some((thread) => thread.id === threadId)) return false
    await this.dependencies.sessions.updateSessionWithMessages(sessionId, {
      threads: session.threads.map((thread) => (thread.id === threadId ? { ...thread, ...update } : thread)),
    })
    return true
  }

  async remove(sessionId: string, threadId: string): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session) return false
    if (sessionId === threadId) {
      return this.removeCurrentFromSession(session.id)
    }

    const target = session.threads?.find((thread) => thread.id === threadId)
    if (target) this.dependencies.cancelMessages(sessionId, getConversationMessages(session, target.messages))
    await this.dependencies.sessions.updateSessionWithMessages(sessionId, {
      threads: session.threads?.filter((thread) => thread.id !== threadId),
    })
    return true
  }

  async switch(sessionId: string, threadId: string): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    const target = session?.threads?.find((thread) => thread.id === threadId)
    if (!session?.threads || !target) return false

    this.dependencies.cancelMessages(sessionId, getCurrentConversationMessages(session))
    // Build the transfer from the queue's current Session, not the snapshot
    // above: a compaction commit may still be persisting, and a stale full
    // object would overwrite its summary and compaction point.
    await this.dependencies.sessions.updateSessionWithMessages(session.id, (current) => {
      if (!current?.threads) throw new Error(`Session ${sessionId} not found during thread switch`)
      const currentTarget = current.threads.find((thread) => thread.id === threadId)
      if (!currentTarget) return current

      return {
        ...current,
        threads: [...current.threads.filter((thread) => thread.id !== threadId), this.createThreadSnapshot(current)],
        messages: currentTarget.messages,
        threadName: currentTarget.name,
        compactionPoints: currentTarget.compactionPoints,
        settings: current.settings
          ? { ...current.settings, sessionPromptContextSnapshot: currentTarget.sessionPromptContextSnapshot }
          : current.settings,
      }
    })
    return true
  }

  async refreshContextAndCreateNew(sessionId: string): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session) return false

    this.dependencies.cancelMessages(sessionId, getCurrentConversationMessages(session))
    // Archive from the queue's current Session so an overlapping compaction
    // commit remains attached to the conversation being archived.
    await this.dependencies.sessions.updateSessionWithMessages(session.id, (current) => {
      if (!current) throw new Error(`Session ${sessionId} not found during thread creation`)
      const systemPrompt = current.messages.find((message) => message.role === 'system')
      return {
        ...current,
        threads: [...(current.threads ?? []), this.createThreadSnapshot(current)],
        messages: [
          systemPrompt
            ? this.createMessage('system', getMessageText(systemPrompt))
            : this.createMessage('system', this.dependencies.getDefaultSystemPrompt()),
        ],
        threadName: '',
        compactionPoints: undefined,
        settings: current.settings
          ? { ...current.settings, sessionPromptContextSnapshot: undefined }
          : current.settings,
      }
    })
    return true
  }

  async removeCurrent(sessionId: string): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    return session ? this.removeCurrentFromSession(session.id) : false
  }

  async compressAndCreate(sessionId: string, summary: string): Promise<boolean> {
    const session = await this.dependencies.sessions.getSession(sessionId)
    if (!session) return false

    this.dependencies.cancelMessages(sessionId, getCurrentConversationMessages(session))
    // Archive from the queue's current Session, not the earlier eligibility
    // snapshot, so concurrent compaction data cannot be lost.
    await this.dependencies.sessions.updateSessionWithMessages(session.id, (current) => {
      if (!current) throw new Error(`Session ${sessionId} not found during compression`)
      const systemPrompt = current.messages.find((message) => message.role === 'system')
      const messages: Message[] = []
      if (systemPrompt) {
        const text = getMessageText(systemPrompt)
        if (text) messages.push(this.createMessage('system', text))
      }
      messages.push(this.createMessage('user', `Previous conversation summary:\n\n${summary}`))

      return {
        ...current,
        threads: [...(current.threads ?? []), this.createThreadSnapshot(current)],
        messages,
        threadName: '',
        compactionPoints: undefined,
        settings: current.settings
          ? { ...current.settings, sessionPromptContextSnapshot: undefined }
          : current.settings,
      }
    })
    return true
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

  private createThreadSnapshot(session: Session): SessionThread {
    // Messages and compaction points describe the same conversation history;
    // snapshot and restore them as one unit whenever a thread is archived.
    return {
      id: this.dependencies.createId(),
      name: session.threadName || session.name,
      messages: session.messages,
      createdAt: this.dependencies.now(),
      compactionPoints: session.compactionPoints,
      sessionPromptContextSnapshot: session.settings?.sessionPromptContextSnapshot,
    }
  }

  private createMessage(role: Message['role'], content: string): Message {
    return {
      id: this.dependencies.createId(),
      role,
      contentParts: content ? [{ type: 'text', text: content }] : [],
      timestamp: this.dependencies.now(),
    }
  }

  private async removeCurrentFromSession(sessionId: string): Promise<boolean> {
    await this.dependencies.sessions.updateSessionWithMessages(sessionId, (current) => {
      if (!current) throw new Error(`Session ${sessionId} not found during thread removal`)
      this.dependencies.cancelMessages(sessionId, getCurrentConversationMessages(current))
      // Discard the current conversation's compaction points with its messages;
      // when restoring a thread, restore that thread's points with its messages.
      const update: Session = {
        ...current,
        messages: current.messages.filter((message) => message.role === 'system').slice(0, 1),
        // Pending title for the next conversation — not `undefined`, which
        // means "historical field missing" and would be backfilled to `name`.
        threadName: '',
        compactionPoints: undefined,
        settings: current.settings
          ? { ...current.settings, sessionPromptContextSnapshot: undefined }
          : current.settings,
      }
      if (current.threads?.length) {
        const lastThread = current.threads[current.threads.length - 1]
        update.messages = lastThread.messages
        update.threads = current.threads.slice(0, -1)
        update.threadName = lastThread.name
        update.compactionPoints = lastThread.compactionPoints
        update.settings = current.settings
          ? { ...current.settings, sessionPromptContextSnapshot: lastThread.sessionPromptContextSnapshot }
          : current.settings
      }
      return update
    })
    return true
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
    await this.removeCurrentFromSession(session.id)
    return copied.id
  }
}

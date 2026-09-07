import {
  type GeneratingMessageRef,
  type SessionMessageWindow,
  type SessionMessageWindowRequest,
  type SessionMessagesRequest,
  type SessionMessagesSnapshot,
  SessionRowConflictError,
  type SessionRowCommit,
  type SessionRowSnapshot,
  SessionRowStoreError,
  type SessionRowStorePort,
  type SessionRows,
  type SessionRowsDiff,
} from '../ports/session-row-store'
import type { MessageRow, MessageRowStatus, ThreadRow } from '../session/session-tree/types'
import { assertSessionReadRevision, validateSessionMessagesRequest } from '../persistence/session-message-selection'
import type { SessionContextRequest, SessionContextRows } from '../ports/session-context-source'
import {
  finishSessionContextRead,
  planSessionContextRead,
  SessionContextPathTraversal,
  validateSessionContextRequest,
  type SessionContextReadPlan,
} from '../persistence/session-context-read'
import {
  assertMessageWindowRevision,
  SessionMessageWindowTraversal,
  validateMessageWindowRequest,
} from '../persistence/session-message-window'

interface SessionRowState {
  threads: Map<string, ThreadRow>
  messages: Map<string, MessageRow>
  record: SessionRowCommit['record']
  revision: number
}

type SessionRowCollections = Pick<SessionRowState, 'threads' | 'messages'>

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item))
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    copy[key] = cloneValue(source[key])
  }
  return copy
}

function clone<Value>(value: Value): Value {
  return cloneValue(value) as Value
}

function requireIdentity(sessionId: string, threadId: string, messageId?: string): void {
  if (!sessionId) {
    throw new Error('row is missing a sessionId')
  }
  if (!threadId) {
    throw new Error('row is missing a threadId')
  }
  if (messageId !== undefined && !messageId) {
    throw new Error('row is missing a messageId')
  }
}

function buildState(threads: ThreadRow[], messages: MessageRow[], sessionId: string): SessionRowCollections {
  const state: SessionRowCollections = { threads: new Map(), messages: new Map() }
  for (const thread of threads) {
    requireIdentity(thread.sessionId, thread.threadId)
    if (thread.sessionId !== sessionId) {
      throw new Error(`thread ${thread.threadId} belongs to session ${thread.sessionId}`)
    }
    state.threads.set(thread.threadId, clone(thread))
  }
  for (const message of messages) {
    requireIdentity(message.sessionId, message.threadId, message.messageId)
    if (message.sessionId !== sessionId) {
      throw new Error(`message ${message.messageId} belongs to session ${message.sessionId}`)
    }
    state.messages.set(message.messageId, clone(message))
  }
  return state
}

function validateCommit(sessionId: string, threads: ThreadRow[], commit: SessionRowCommit): void {
  const active = threads.filter((thread) => thread.seq === -1)
  if (
    !Number.isSafeInteger(commit.revision) ||
    commit.revision <= 0 ||
    active.length !== 1 ||
    commit.record.id !== sessionId ||
    commit.record.activeThreadId !== active[0].threadId
  ) {
    throw new Error(`session ${sessionId} has invalid commit metadata`)
  }
}

/**
 * Reference `SessionRowStorePort` for tests. Every operation builds the next
 * state before publishing it, so a rejected row leaves the store untouched the
 * way an aborted transaction would.
 */
export class InMemorySessionRowStore implements SessionRowStorePort {
  private readonly sessions = new Map<string, SessionRowState>()
  private readonly revisions = new Map<string, number>()
  initializeCount = 0

  initialize(): Promise<void> {
    this.initializeCount += 1
    return Promise.resolve()
  }

  readSnapshot(sessionId: string): Promise<SessionRowSnapshot | null> {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return Promise.resolve(null)
    }
    return Promise.resolve({
      rows: {
        sessionId,
        threads: [...state.threads.values()].map((thread) => clone(thread)),
        messages: [...state.messages.values()].map((message) => clone(message)),
      },
      record: clone(state.record),
      revision: state.revision,
    })
  }

  async readMessageWindow(request: SessionMessageWindowRequest): Promise<SessionMessageWindow | null> {
    try {
      validateMessageWindowRequest(request)
      const state = this.sessions.get(request.sessionId)
      assertMessageWindowRevision(request, this.revisions.get(request.sessionId) ?? null)
      if (!state) return null
      const thread = state.threads.get(request.threadId ?? request.cursor?.threadId ?? state.record.activeThreadId)
      if (!thread) throw new Error('Message window thread is missing')
      const traversal = new SessionMessageWindowTraversal(
        request,
        { record: state.record, revision: state.revision },
        thread
      )
      const messages: MessageRow[] = []
      while (traversal.nextMessageId !== null && traversal.remaining > 0) {
        const row = state.messages.get(traversal.nextMessageId)
        if (traversal.accept(row) && row) messages.push(clone(row))
      }
      return clone(traversal.finish(messages))
    } catch (error) {
      if (error instanceof SessionRowConflictError) throw error
      throw new SessionRowStoreError('read-message-window', error, request.sessionId)
    }
  }

  async readMessages(request: SessionMessagesRequest): Promise<SessionMessagesSnapshot | null> {
    try {
      validateSessionMessagesRequest(request)
      const state = this.sessions.get(request.sessionId)
      assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
      if (!state) return null
      return clone({
        record: state.record,
        revision: state.revision,
        messages: [...new Set(request.messageIds)].flatMap((id) => {
          const row = state.messages.get(id)
          return row ? [row] : []
        }),
      })
    } catch (error) {
      if (error instanceof SessionRowConflictError) throw error
      throw new SessionRowStoreError('read-messages', error, request.sessionId)
    }
  }

  async readContext(request: SessionContextRequest): Promise<SessionContextRows | null> {
    try {
      validateSessionContextRequest(request)
      const state = this.sessions.get(request.sessionId)
      assertSessionReadRevision(request, this.revisions.get(request.sessionId) ?? null)
      if (!state) return null
      const commit = { record: state.record, revision: state.revision }
      const thread = state.threads.get(request.threadId ?? state.record.activeThreadId)
      const targetId = request.targetMessageId ?? thread?.activeLeafMessageId
      const target = targetId ? state.messages.get(targetId) : undefined
      const plan = planSessionContextRead(request, commit, [...state.threads.values()], target)
      const readPlan = (current: SessionContextReadPlan) => {
        const traversal = new SessionContextPathTraversal(request.sessionId, current)
        const path: MessageRow[] = []
        while (traversal.nextMessageId !== null) {
          const row = state.messages.get(traversal.nextMessageId)
          traversal.accept(row)
          if (row) path.push(row)
        }
        const extra = current.checkpoint
          ? [current.checkpoint.point.summaryMessageId, current.checkpoint.systemMessageId].flatMap((id) => {
              const row = id ? state.messages.get(id) : undefined
              return row ? [row] : []
            })
          : []
        return finishSessionContextRead(request, commit, current, path.reverse(), extra)
      }
      return clone(readPlan(plan) ?? readPlan({ ...plan, checkpoint: undefined }))
    } catch (error) {
      if (error instanceof SessionRowConflictError) throw error
      throw new SessionRowStoreError('read-context', error, request.sessionId)
    }
  }

  writeRows(snapshot: SessionRowSnapshot, expectedRevision?: number | null): Promise<void> {
    const { rows, record, revision } = snapshot
    if (!rows.sessionId) {
      return Promise.reject(new SessionRowStoreError('write-rows', new Error('rows are missing a sessionId')))
    }
    const actualRevision = this.revisions.get(rows.sessionId) ?? null
    if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
      return Promise.reject(new SessionRowConflictError(rows.sessionId, expectedRevision, actualRevision))
    }
    let next: SessionRowCollections
    try {
      validateCommit(rows.sessionId, rows.threads, { record, revision })
      next = buildState(rows.threads, rows.messages, rows.sessionId)
    } catch (error) {
      return Promise.reject(new SessionRowStoreError('write-rows', error, rows.sessionId))
    }
    this.publish(rows.sessionId, { ...next, record: clone(record), revision })
    return Promise.resolve()
  }

  applyDiff(diff: SessionRowsDiff, commit: SessionRowCommit, expectedRevision?: number): Promise<void> {
    if (!diff.sessionId) {
      return Promise.reject(new SessionRowStoreError('apply-diff', new Error('diff is missing a sessionId')))
    }
    const current = this.sessions.get(diff.sessionId)
    if (expectedRevision !== undefined) {
      const actualRevision = this.revisions.get(diff.sessionId) ?? null
      if (actualRevision !== expectedRevision) {
        return Promise.reject(new SessionRowConflictError(diff.sessionId, expectedRevision, actualRevision))
      }
    }
    const next: SessionRowState = {
      threads: new Map(current?.threads),
      messages: new Map(current?.messages),
      record: clone(commit.record),
      revision: commit.revision,
    }
    try {
      for (const thread of diff.threads.upsert) {
        requireIdentity(thread.sessionId, thread.threadId)
        if (thread.sessionId !== diff.sessionId) {
          throw new Error(`thread ${thread.threadId} belongs to session ${thread.sessionId}`)
        }
        next.threads.set(thread.threadId, clone(thread))
      }
      for (const message of diff.messages.upsert) {
        requireIdentity(message.sessionId, message.threadId, message.messageId)
        if (message.sessionId !== diff.sessionId) {
          throw new Error(`message ${message.messageId} belongs to session ${message.sessionId}`)
        }
        next.messages.set(message.messageId, clone(message))
      }
    } catch (error) {
      return Promise.reject(new SessionRowStoreError('apply-diff', error, diff.sessionId))
    }
    for (const threadId of diff.threads.delete) {
      next.threads.delete(threadId)
    }
    for (const messageId of diff.messages.delete) {
      next.messages.delete(messageId)
    }
    if (next.threads.size > 0 || next.messages.size > 0) {
      try {
        validateCommit(diff.sessionId, [...next.threads.values()], commit)
      } catch (error) {
        return Promise.reject(new SessionRowStoreError('apply-diff', error, diff.sessionId))
      }
    }
    this.publish(diff.sessionId, next)
    return Promise.resolve()
  }

  deleteRows(sessionId: string, expectedRevision?: number | null): Promise<void> {
    const actualRevision = this.revisions.get(sessionId) ?? null
    if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
      return Promise.reject(new SessionRowConflictError(sessionId, expectedRevision, actualRevision))
    }
    if (actualRevision === Number.MAX_SAFE_INTEGER) {
      return Promise.reject(
        new SessionRowStoreError('delete-rows', new Error('session row revision is exhausted'), sessionId)
      )
    }
    this.sessions.delete(sessionId)
    if (actualRevision !== null) this.revisions.set(sessionId, actualRevision + 1)
    return Promise.resolve()
  }

  hasRows(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(sessionId))
  }

  getRevision(sessionId: string): Promise<number | null> {
    return Promise.resolve(this.revisions.get(sessionId) ?? null)
  }

  listSessionIds(): Promise<string[]> {
    return Promise.resolve([...this.sessions.keys()])
  }

  findMessagesByStatus(status: MessageRowStatus): Promise<GeneratingMessageRef[]> {
    const refs: GeneratingMessageRef[] = []
    for (const state of this.sessions.values()) {
      for (const message of state.messages.values()) {
        if (message.status === status) {
          refs.push({ sessionId: message.sessionId, threadId: message.threadId, messageId: message.messageId })
        }
      }
    }
    return Promise.resolve(refs)
  }

  clear(): void {
    this.sessions.clear()
    this.revisions.clear()
  }

  snapshot(): SessionRowSnapshot[] {
    return [...this.sessions.entries()].map(([sessionId, state]) => ({
      rows: {
        sessionId,
        threads: [...state.threads.values()].map((thread) => clone(thread)),
        messages: [...state.messages.values()].map((message) => clone(message)),
      },
      record: clone(state.record),
      revision: state.revision,
    }))
  }

  private publish(sessionId: string, state: SessionRowState): void {
    this.revisions.set(sessionId, state.revision)
    if (state.threads.size === 0 && state.messages.size === 0) {
      this.sessions.delete(sessionId)
      return
    }
    this.sessions.set(sessionId, state)
  }
}

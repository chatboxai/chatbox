import {
  SessionRowConflictError,
  type SessionMessageWindow,
  type SessionMessageWindowRequest,
  type SessionRowCommit,
} from '../ports/session-row-store'
import type { MessageRow, ThreadRow } from '../session/session-tree/types'

type MessageLink = Pick<
  MessageRow,
  'sessionId' | 'threadId' | 'messageId' | 'parentMessageId' | 'activeChildId' | 'seq'
>

export function validateMessageWindowRequest(request: SessionMessageWindowRequest): void {
  if (!request.sessionId || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 200) {
    throw new Error('A message window requires a session id and a limit from 1 to 200')
  }
  const cursor = request.cursor
  if (
    (request.threadId !== undefined && !request.threadId) ||
    (request.edge !== undefined && request.edge !== 'head' && request.edge !== 'tail') ||
    (request.edge !== undefined && cursor !== undefined) ||
    (cursor &&
      (cursor.sessionId !== request.sessionId ||
        !cursor.threadId ||
        !(
          (!!cursor.beforeMessageId && cursor.afterMessageId === undefined) ||
          (!!cursor.afterMessageId && cursor.beforeMessageId === undefined)
        ) ||
        !Number.isSafeInteger(cursor.revision) ||
        cursor.revision <= 0 ||
        (request.threadId !== undefined && request.threadId !== cursor.threadId)))
  ) {
    throw new Error('Message window cursor does not match the requested session and thread')
  }
}

export function assertMessageWindowRevision(request: SessionMessageWindowRequest, revision: number | null): void {
  if (request.cursor && request.cursor.revision !== revision) {
    throw new SessionRowConflictError(request.sessionId, request.cursor.revision, revision)
  }
}

/** Shared path validation; drivers own the atomic read and bounded payload hydration. */
export class SessionMessageWindowTraversal {
  nextMessageId: string | null
  readonly forward: boolean
  private previous: MessageLink | null = null
  private skipAnchor: boolean
  private count = 0

  constructor(
    private readonly request: SessionMessageWindowRequest,
    private readonly commit: SessionRowCommit,
    private readonly thread: ThreadRow
  ) {
    assertMessageWindowRevision(request, commit.revision)
    if (
      commit.record.id !== request.sessionId ||
      !Number.isSafeInteger(commit.revision) ||
      commit.revision <= 0 ||
      thread.sessionId !== request.sessionId ||
      thread.threadId !== (request.threadId ?? request.cursor?.threadId ?? commit.record.activeThreadId)
    ) {
      throw new Error('Message window metadata does not match the requested thread')
    }
    if ((thread.rootMessageId === null) !== (thread.activeLeafMessageId === null)) {
      throw new Error('Message window thread has inconsistent root and leaf pointers')
    }
    this.skipAnchor = request.cursor !== undefined
    this.forward = request.edge === 'head' || request.cursor?.afterMessageId !== undefined
    this.nextMessageId =
      request.cursor?.beforeMessageId ??
      request.cursor?.afterMessageId ??
      (this.forward ? thread.rootMessageId : thread.activeLeafMessageId)
  }

  get remaining(): number {
    return this.request.limit - this.count + (this.skipAnchor ? 1 : 0)
  }

  /** Returns false for the exclusive cursor anchor, which needs no payload hydration. */
  accept(row: MessageLink | undefined): boolean {
    if (
      !row ||
      row.sessionId !== this.request.sessionId ||
      row.threadId !== this.thread.threadId ||
      row.messageId !== this.nextMessageId ||
      !Number.isSafeInteger(row.seq) ||
      row.seq < 0 ||
      (this.previous &&
        (this.forward
          ? row.seq <= this.previous.seq || row.parentMessageId !== this.previous.messageId
          : row.seq >= this.previous.seq || row.activeChildId !== this.previous.messageId)) ||
      (row.parentMessageId === null && row.messageId !== this.thread.rootMessageId) ||
      (row.messageId === this.thread.rootMessageId && row.parentMessageId !== null) ||
      (this.forward && (row.activeChildId === null) !== (row.messageId === this.thread.activeLeafMessageId))
    ) {
      throw new Error(`Message window has an invalid path at ${this.nextMessageId}`)
    }
    this.previous = row
    this.nextMessageId = this.forward ? row.activeChildId : row.parentMessageId
    if (this.skipAnchor) {
      this.skipAnchor = false
      return false
    }
    this.count += 1
    return true
  }

  finish(selected: MessageRow[]): SessionMessageWindow {
    if (selected.length !== this.count) throw new Error('Incomplete message window payloads')
    const messages = this.forward ? selected : selected.reverse()
    const first = messages[0]
    const last = messages.at(-1)
    const identity = {
      sessionId: this.request.sessionId,
      threadId: this.thread.threadId,
      revision: this.commit.revision,
    }
    return {
      ...this.commit,
      thread: this.thread,
      messages,
      older: first?.parentMessageId ? { ...identity, beforeMessageId: first.messageId } : null,
      newer: last?.activeChildId ? { ...identity, afterMessageId: last.messageId } : null,
    }
  }
}

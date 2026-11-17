import { SessionRowConflictError, type SessionThreadPageRequest } from '../ports/session-row-store'

export function validateSessionThreadPageRequest(request: SessionThreadPageRequest): void {
  if (!request.sessionId || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 200) {
    throw new Error('A thread page requires a session id and a limit from 1 to 200')
  }
  const cursor = request.cursor
  if (
    cursor &&
    (cursor.sessionId !== request.sessionId ||
      !Number.isSafeInteger(cursor.revision) ||
      cursor.revision <= 0 ||
      !Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 1)
  ) {
    throw new Error('Thread page cursor does not match the requested session')
  }
}

export function assertSessionThreadPageRevision(request: SessionThreadPageRequest, revision: number | null): void {
  if (request.cursor && request.cursor.revision !== revision) {
    throw new SessionRowConflictError(request.sessionId, request.cursor.revision, revision)
  }
}

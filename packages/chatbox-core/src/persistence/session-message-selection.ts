import { SessionRowConflictError, type SessionMessagesRequest } from '../ports/session-row-store'

export function validateSessionMessagesRequest(request: SessionMessagesRequest): void {
  if (!request.sessionId || request.messageIds.some((id) => !id)) throw new Error('Message ids must be nonempty')
  if (
    request.expectedRevision !== undefined &&
    (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision <= 0)
  ) {
    throw new Error('Message selection requires a positive revision')
  }
}

export function assertSessionReadRevision(
  request: { sessionId: string; expectedRevision?: number },
  revision: number | null
): void {
  if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
    throw new SessionRowConflictError(request.sessionId, request.expectedRevision, revision)
  }
}

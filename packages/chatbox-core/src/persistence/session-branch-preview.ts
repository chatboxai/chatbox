import type { SessionBranchPreview, SessionBranchPreviewRequest } from '../ports/session-branch-source'
import { SessionRowConflictError, type SessionRowCommit } from '../ports/session-row-store'
import type { MessageRowMetadata } from '../session/session-tree/types'
import { requireKnownMetadata } from './session-row-relations-read'

export function validateBranchPreviewRequest(request: SessionBranchPreviewRequest): void {
  if (
    !request.sessionId ||
    !request.firstMessageId ||
    request.revealedMessageIds?.some((id) => typeof id !== 'string' || !id) ||
    (request.expectedRevision !== undefined &&
      (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1))
  )
    throw new Error('Invalid branch preview request')
}

export function assertBranchPreviewRevision(
  request: SessionBranchPreviewRequest,
  commit: SessionRowCommit | null
): void {
  if (request.expectedRevision !== undefined && request.expectedRevision !== (commit?.revision ?? null))
    throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit?.revision ?? null)
}

/** Reduces one committed local selected path to preview identities and a count. */
export async function readBranchPreviewFromMetadata(
  request: SessionBranchPreviewRequest,
  commit: SessionRowCommit,
  readMetadata: (messageId: string) => Promise<MessageRowMetadata | null>
): Promise<SessionBranchPreview> {
  validateBranchPreviewRequest(request)
  assertBranchPreviewRevision(request, commit)
  const candidates = new Set(request.revealedMessageIds)
  const revealedMessageIds: string[] = []
  const seen = new Set<string>()
  let threadId: string | undefined
  let headMessageId: string | null = null
  let headRole: SessionBranchPreview['headRole'] = null
  let pairedReplyMessageId: string | null = null
  let followupCount = 0
  let id: string | null = request.firstMessageId
  let previousId: string | undefined
  while (id !== null) {
    if (seen.has(id)) throw new Error('Cyclic branch preview path')
    seen.add(id)
    const row = await readMetadata(id)
    if (!row) throw new Error('Branch preview message was not found')
    if (row.sessionId !== request.sessionId || row.messageId !== id)
      throw new Error('Branch preview metadata identity is inconsistent')
    threadId ??= row.threadId
    if (row.threadId !== threadId) throw new Error('Relation crosses a thread boundary')
    if (previousId !== undefined && row.parentMessageId !== previousId)
      throw new Error('Broken selected message relationship')
    if (!requireKnownMetadata(row)) throw new Error('Branch preview metadata is unavailable')
    if (candidates.has(id)) revealedMessageIds.push(id)
    const visible = row.kind !== 'summary' && !row.facts.isForkMarker
    if (!headMessageId) {
      if (visible) {
        headMessageId = id
        headRole = row.facts.role
      }
    } else if (headRole === 'user' && !pairedReplyMessageId && visible && row.facts.role === 'assistant') {
      pairedReplyMessageId = id
    } else {
      followupCount++
    }
    previousId = id
    id = row.activeChildId
  }
  if (!threadId) throw new Error('Branch preview first message was not found')
  return {
    sessionId: request.sessionId,
    revision: commit.revision,
    threadId,
    headMessageId,
    headRole,
    pairedReplyMessageId,
    followupCount,
    ...(request.revealedMessageIds ? { revealedMessageIds } : {}),
  }
}

import { SESSION_TOKEN_PAGE_BYTES, SESSION_TOKEN_PAGE_MESSAGES } from '../../ports/session-token-cache'
import { selectContextEntries, type ContextSelectionEntry } from '@shared/context/builder'
import { findLatestApplicableCompactionPoint } from '@shared/context/compaction-points'
import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import { orderSteeredMessagesForModel } from '@shared/utils/message'
import type {
  SessionContextBeforeTarget,
  SessionContextRequest,
  SessionContextSource,
} from '../../ports/session-context-source'
import type { SessionKnownMessageMetadata, SessionMessageRelationsCursor } from '../../ports/session-row-relations'
import { SessionRowConflictError, type SessionRowStorePort } from '../../ports/session-row-store'
import type {
  SessionTokenPlan,
  SessionTokenPlanRequest,
  SessionTokenPageRequest,
  SessionTokenPage,
} from '../../ports/session-token-source'
import type { SessionHeader, Message } from '../../types'
import type { SessionRecordV2, ThreadRow } from '../../session/session-tree/types'
export function contextHeader(record: SessionRecordV2, activeThread: ThreadRow): SessionHeader {
  const {
    storageFormat: _storage,
    rowFormatVersion: _format,
    rowAuthority: _authority,
    activeThreadId: _active,
    forkCreatedAt: _forks,
    presentation: _presentation,
    contextReadProjection: _projection,
    topologyFingerprint: _fingerprint,
    ...header
  } = record
  return { ...header, threadName: activeThread.name ?? undefined }
}

export interface RowContextEntry extends ContextSelectionEntry {
  row: SessionKnownMessageMetadata
}

export function contextEntry(row: SessionKnownMessageMetadata): RowContextEntry {
  return {
    id: row.messageId,
    role: row.facts.role,
    isSummary: row.kind === 'summary',
    isForkMarker: row.facts.isForkMarker,
    generating: !row.facts.contextEligible,
    steered: row.facts.steered,
    finishReason: row.facts.finishReason,
    error: row.facts.hasError ? 'Message failed' : undefined,
    row,
  }
}

export async function readRowContextPlan(rows: SessionRowStorePort, request: SessionContextRequest) {
  const commit = await rows.readCommit(request.sessionId)
  if (!commit) return null
  if (request.expectedRevision !== undefined && request.expectedRevision !== commit.revision)
    throw new SessionRowConflictError(request.sessionId, request.expectedRevision, commit.revision)
  const revision = commit.revision
  const targetSelection = request.targetMessageId
    ? await rows.readMessageMetadata({
        sessionId: request.sessionId,
        messageIds: [request.targetMessageId],
        expectedRevision: revision,
      })
    : null
  if (targetSelection && targetSelection.status !== 'ready') throw new Error('Context target facts are unavailable')
  const target = targetSelection?.status === 'ready' ? targetSelection.rows[0] : undefined
  if (request.targetMessageId && !target) throw new Error('Context target is missing')
  const threadId = request.threadId ?? target?.threadId ?? commit.record.activeThreadId
  if (target && target.threadId !== threadId) throw new Error('Context target does not belong to the requested thread')
  const state = await rows.readThreadState({ sessionId: request.sessionId, threadId, expectedRevision: revision })
  if (!state || state.status !== 'ready') throw new Error('Context thread facts are unavailable')
  const active =
    threadId === commit.record.activeThreadId
      ? state
      : await rows.readThreadState({ sessionId: request.sessionId, expectedRevision: revision })
  if (!active || active.status !== 'ready') throw new Error('Active thread facts are unavailable')
  const leafId = request.targetMessageId ? target!.messageId : state.thread.activeLeafMessageId
  const reverse: SessionKnownMessageMetadata[] = []
  const seen = new Set<string>()
  let cursor: SessionMessageRelationsCursor | undefined
  if (leafId)
    do {
      const page = await rows.readMessageRelationsPage({
        sessionId: request.sessionId,
        threadId,
        selector: { kind: 'ancestors', messageId: leafId },
        limit: 200,
        cursor,
        expectedRevision: revision,
      })
      if (!page || page.status !== 'ready') throw new Error('Context path facts are unavailable')
      for (const row of page.rows) {
        if (seen.has(row.messageId)) throw new Error('Context path contains a cycle')
        seen.add(row.messageId)
        reverse.push(row)
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  const path = reverse.reverse()
  if (path.length && path[0].messageId !== state.thread.rootMessageId)
    throw new Error('Context path does not reach its thread root')
  const before = request.targetMessageId ? path.slice(0, -1) : path
  const beforeTarget: SessionContextBeforeTarget = {
    firstMessageTimestamp: path[0]?.facts.timestamp,
    userMessageCount: 0,
    hasAssistantMessage: false,
    hasLegacyCommandHistory: false,
    sandboxSeedAttachments: [],
    fileResourceKeys: [],
  }
  for (const row of before) {
    if (row.facts.role === 'user') {
      beforeTarget.userMessageCount++
      beforeTarget.lastUserMessageId = row.messageId
    }
    beforeTarget.hasAssistantMessage ||= row.facts.role === 'assistant'
    beforeTarget.hasLegacyCommandHistory ||= row.facts.hasLegacyCommand
    beforeTarget.sandboxSeedAttachments.push(...(row.facts.seedAttachments ?? []))
    beforeTarget.fileResourceKeys.push(...(row.facts.fileResourceKeys ?? []))
  }
  const candidate = request.targetMessageId && !request.includeTarget ? before : path
  const final = await rows.readCommit(request.sessionId)
  if (final?.revision !== revision)
    throw new SessionRowConflictError(request.sessionId, revision, final?.revision ?? null)
  return {
    ...commit,
    header: contextHeader(commit.record, active.thread),
    thread: state.thread,
    entries: candidate.map(contextEntry),
    target,
    beforeTarget,
  }
}

/** Generation alone materializes its causal request path; token jobs use independent pages below. */
export async function readRowContextSource(
  rows: SessionRowStorePort,
  request: SessionContextRequest
): Promise<SessionContextSource | null> {
  const plan = await readRowContextPlan(rows, request)
  if (!plan) return null
  const entries = plan.entries.map((entry) =>
    request.includeTarget && entry.id === plan.target?.messageId ? { ...entry, generating: false } : entry
  )
  const point = findLatestApplicableCompactionPoint(
    orderSteeredMessagesForModel(entries).filter(isContextEligibleMessage),
    plan.thread.compactionPoints
  )
  const draft: ContextSelectionEntry = { id: 'context-current-input', role: 'user' }
  const selection = selectContextEntries<ContextSelectionEntry>(
    request.reserveCurrentInput ? [...entries, draft] : entries,
    { compactionPoints: plan.thread.compactionPoints, maxContextMessageCount: request.maxContextMessageCount }
  ).filter((entry) => entry !== draft)
  const selectedIds = new Set(selection.map((entry) => entry.id))
  // Hosts select again after adding their current input. Retain the checkpoint's
  // boundary only when its summary remains in that window, so it stays applicable.
  if (point && selectedIds.has(point.summaryMessageId)) selectedIds.add(point.boundaryMessageId)
  const candidates = entries.filter((entry) => selectedIds.has(entry.id))
  const mode: SessionContextSource['mode'] = point ? 'compacted' : 'full-path'
  let conversationMessageIds: string[] | undefined
  if (request.includeConversationIds) {
    conversationMessageIds = plan.entries.map((entry) => entry.id)
    const seen = new Set(conversationMessageIds)
    if (plan.target && !seen.has(plan.target.messageId)) {
      conversationMessageIds.push(plan.target.messageId)
      seen.add(plan.target.messageId)
    }
    if (plan.target?.activeChildId) {
      let cursor: SessionMessageRelationsCursor | undefined
      do {
        const page = await rows.readMessageRelationsPage({
          sessionId: request.sessionId,
          threadId: plan.thread.threadId,
          selector: { kind: 'selected-path', messageId: plan.target.messageId, includeStart: false },
          expectedRevision: plan.revision,
          limit: 200,
          cursor,
        })
        if (!page || page.status !== 'ready') throw new Error('Conversation path identities are unavailable')
        for (const row of page.rows) {
          if (seen.has(row.messageId)) throw new Error('Conversation path contains a cycle')
          seen.add(row.messageId)
          conversationMessageIds.push(row.messageId)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
    }
  }
  const ids = [...new Set([...candidates.map((entry) => entry.id), ...(plan.target ? [plan.target.messageId] : [])])]
  const messages = new Map<string, Message>()
  for (let index = 0; index < ids.length; index += SESSION_TOKEN_PAGE_MESSAGES) {
    const selection = await rows.readMessages({
      sessionId: request.sessionId,
      messageIds: ids.slice(index, index + SESSION_TOKEN_PAGE_MESSAGES),
      expectedRevision: plan.revision,
    })
    if (!selection) throw new SessionRowConflictError(request.sessionId, plan.revision, null)
    for (const row of selection.messages) messages.set(row.messageId, row.message)
  }
  const get = (id: string) => {
    const message = messages.get(id)
    if (!message) throw new Error(`Context message ${id} is missing`)
    return message
  }
  return {
    header: plan.header,
    thread: plan.thread,
    revision: plan.revision,
    candidateMessages: candidates.map((entry) => get(entry.id)),
    pathMessageIds: plan.entries.map((entry) => entry.id),
    compactionPoints: plan.thread.compactionPoints,
    targetMessage: plan.target ? get(plan.target.messageId) : undefined,
    mode,
    beforeTarget: plan.beforeTarget,
    effectiveCompactionPoint: point,
    ...(conversationMessageIds ? { conversationMessageIds } : {}),
  }
}

export async function createRowTokenPlan(
  rows: SessionRowStorePort,
  request: SessionTokenPlanRequest
): Promise<SessionTokenPlan | null> {
  const plan = await readRowContextPlan(rows, request)
  if (!plan) return null
  const draft: ContextSelectionEntry = { id: 'token-draft', role: 'user' }
  const options = {
    compactionPoints: plan.thread.compactionPoints,
    maxContextMessageCount: request.maxContextMessageCount,
  }
  const selected = selectContextEntries<ContextSelectionEntry>([...plan.entries, draft], options).filter(
    (entry) => entry !== draft
  )
  const full = selectContextEntries(plan.entries, { compactionPoints: plan.thread.compactionPoints })
  return {
    sessionId: request.sessionId,
    revision: plan.revision,
    header: plan.header,
    thread: plan.thread,
    beforeTarget: plan.beforeTarget,
    messageIds: selected.map((entry) => entry.id),
    projectionEntries: selected.map(({ role, isSummary }) => ({ role, isSummary })),
    canManualCompact: full.some((entry) => !entry.isSummary && entry.role !== 'system'),
  }
}

export async function readRowTokenPage(
  rows: SessionRowStorePort,
  request: SessionTokenPageRequest
): Promise<SessionTokenPage> {
  const { plan, offset, limit } = request
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > SESSION_TOKEN_PAGE_MESSAGES
  )
    throw new Error('Invalid token page')
  const ids = plan.messageIds.slice(offset, offset + limit)
  const cache = await rows.readTokenCache({
    sessionId: plan.sessionId,
    messageIds: ids,
    cacheKey: request.cacheKey,
    expectedRevision: plan.revision,
  })
  if (!cache) throw new SessionRowConflictError(plan.sessionId, plan.revision, null)
  if (cache.entries.length !== ids.length || cache.entries.some((entry, index) => entry.messageId !== ids[index]))
    throw new Error('Token source is missing')
  const maxBytes = request.maxBytes ?? SESSION_TOKEN_PAGE_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > SESSION_TOKEN_PAGE_BYTES)
    throw new Error('Invalid token payload budget')
  const entries: typeof cache.entries = []
  let payloadBytes = 0
  for (const entry of cache.entries) {
    if (!Number.isSafeInteger(entry.payloadBytes) || entry.payloadBytes < 0)
      throw new Error('Invalid token payload identity')
    const bytes = entry.value ? 0 : entry.payloadBytes
    if (entries.length && payloadBytes + bytes > maxBytes) break
    entries.push(entry)
    payloadBytes += bytes
    if (payloadBytes > maxBytes) break
  }
  const missingIds = entries.filter((entry) => !entry.value).map((entry) => entry.messageId)
  const selected = missingIds.length
    ? await rows.readMessages({ sessionId: plan.sessionId, messageIds: missingIds, expectedRevision: plan.revision })
    : null
  if (missingIds.length && (!selected || selected.messages.length !== missingIds.length))
    throw new Error('Token payload is missing')
  return {
    sessionId: plan.sessionId,
    revision: plan.revision,
    entries,
    messages: selected?.messages.map((row) => row.message) ?? [],
    textTokens: selected?.textTokens,
    nextOffset: offset + entries.length < plan.messageIds.length ? offset + entries.length : null,
  }
}

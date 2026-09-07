import { findLatestApplicableCompactionPoint } from '@shared/context/compaction-points'
import { isContextEligibleMessage } from '@shared/context/message-eligibility'
import { toSandboxSeedAttachment } from '@shared/sandbox/attachment-path'
import type {
  SessionContextBeforeTarget,
  SessionContextMessage,
  SessionContextRequest,
  SessionContextRows,
} from '../ports/session-context-source'
import type { SessionRowCommit } from '../ports/session-row-store'
import type {
  SessionContextCheckpoint,
  SessionContextReadProjection,
} from '../session/session-tree/context-read-projection'
import type { MessageRow, ThreadRow } from '../session/session-tree/types'
import type { Message } from '../types/session'
import { assertSessionReadRevision } from './session-message-selection'

export function contextPathFacts(messages: Message[], prefix?: SessionContextBeforeTarget): SessionContextBeforeTarget {
  const facts: SessionContextBeforeTarget = prefix
    ? {
        ...prefix,
        sandboxSeedAttachments: [...prefix.sandboxSeedAttachments],
      }
    : {
        firstMessageTimestamp: messages[0]?.timestamp,
        userMessageCount: 0,
        hasAssistantMessage: false,
        hasLegacyCommandHistory: false,
        sandboxSeedAttachments: [],
      }
  for (const message of messages) {
    if (message.role === 'user') {
      facts.userMessageCount += 1
      facts.lastUserMessageId = message.id
    }
    if (message.role === 'assistant') facts.hasAssistantMessage = true
    if (
      message.contentParts.some(
        (part) => part.type === 'tool-call' && (part.toolName === 'user_exec' || part.toolName === 'code_execution')
      )
    ) {
      facts.hasLegacyCommandHistory = true
    }
    facts.sandboxSeedAttachments.push(...(message.files?.map(toSandboxSeedAttachment) ?? []))
  }
  return facts
}

function projectionFacts(message: Message): unknown {
  return [
    message.role,
    message.isSummary,
    message.steered,
    message.contentParts.some(
      (part) => part.type === 'tool-call' && (part.toolName === 'user_exec' || part.toolName === 'code_execution')
    ),
    message.files?.map(toSandboxSeedAttachment),
  ]
}

export function preservesContextReadProjection(
  before: Message,
  after: Message,
  projection: SessionContextReadProjection
): boolean {
  if (JSON.stringify(projectionFacts(before)) !== JSON.stringify(projectionFacts(after))) return false
  if (
    before.timestamp !== after.timestamp &&
    Object.values(projection.threads).some((thread) => thread.rootMessageId === before.id)
  )
    return false
  if (isContextEligibleMessage(before) === isContextEligibleMessage(after)) return true
  if (before.role === 'system') return false
  return !Object.values(projection.threads).some((thread) =>
    thread.checkpoints.some(
      (checkpoint) =>
        checkpoint.boundary.messageId === before.id ||
        checkpoint.summary.messageId === before.id ||
        checkpoint.systemMessageId === before.id
    )
  )
}

/** Derive sparse checkpoints while the complete tree is already available for a full write. */
export function deriveContextReadProjection(threads: ThreadRow[], rows: MessageRow[]): SessionContextReadProjection {
  const projection: SessionContextReadProjection = { version: 1, threads: {} }
  const byThread = new Map<string, MessageRow[]>()
  for (const row of rows) {
    const list = byThread.get(row.threadId)
    if (list) list.push(row)
    else byThread.set(row.threadId, [row])
  }
  for (const thread of threads) {
    const messages = (byThread.get(thread.threadId) ?? []).sort((a, b) => a.seq - b.seq)
    const byId = new Map(messages.map((row) => [row.messageId, row]))
    const ends = new Map<string, number>()
    const stack: MessageRow[] = []
    for (const row of messages) {
      while (stack.length > 0 && stack[stack.length - 1].messageId !== row.parentMessageId) {
        const closed = stack.pop()
        if (closed) ends.set(closed.messageId, row.seq)
      }
      stack.push(row)
    }
    const end = (messages.at(-1)?.seq ?? -1) + 1
    for (const row of stack) ends.set(row.messageId, end)
    const endpoint = (row: MessageRow) => ({
      messageId: row.messageId,
      seq: row.seq,
      subtreeEnd: ends.get(row.messageId) ?? row.seq + 1,
      eligible: isContextEligibleMessage(row.message),
    })
    const factsById = new Map<string, { facts: SessionContextCheckpoint['prefix']; systemMessageId?: string }>()
    const attachments: SessionContextReadProjection['threads'][string]['attachments'] = []
    for (const row of messages) {
      const parent = row.parentMessageId ? factsById.get(row.parentMessageId) : undefined
      const own = contextPathFacts(
        [{ ...row.message, files: undefined }],
        parent ? { ...parent.facts, sandboxSeedAttachments: [] } : undefined
      )
      const { sandboxSeedAttachments: _attachments, ...facts } = own
      factsById.set(row.messageId, {
        facts,
        systemMessageId:
          parent?.systemMessageId ??
          (row.message.role === 'system' && isContextEligibleMessage(row.message) ? row.messageId : undefined),
      })
      if (row.message.files?.length)
        attachments.push({ owner: endpoint(row), files: row.message.files.map(toSandboxSeedAttachment) })
    }
    const checkpoints: SessionContextCheckpoint[] = []
    for (const point of thread.compactionPoints) {
      const boundary = byId.get(point.boundaryMessageId)
      const summary = byId.get(point.summaryMessageId)
      if (!boundary || !summary) continue
      const facts = factsById.get(boundary.messageId)
      if (!facts) continue
      checkpoints.push({
        point,
        boundary: endpoint(boundary),
        summary: endpoint(summary),
        systemMessageId: facts.systemMessageId,
        prefix: facts.facts,
      })
    }
    projection.threads[thread.threadId] = {
      rootMessageId: thread.rootMessageId,
      hasSteeredMessages: messages.some((row) => row.message.steered === true),
      checkpoints,
      attachments,
    }
  }
  return projection
}

export function validateSessionContextRequest(request: SessionContextRequest): void {
  if (!request.sessionId || request.threadId === '' || request.targetMessageId === '')
    throw new Error('Context requires nonempty ids')
  if (request.includeTarget !== undefined && !request.targetMessageId)
    throw new Error('includeTarget requires a target message')
  if (
    request.expectedRevision !== undefined &&
    (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision <= 0)
  ) {
    throw new Error('Context requires a positive revision')
  }
}

export interface SessionContextReadPlan {
  thread: ThreadRow
  activeThreadName?: string
  target: SessionContextMessage | undefined
  startMessageId: string | null
  checkpoint?: SessionContextCheckpoint
  prefixAttachments?: SessionContextBeforeTarget['sandboxSeedAttachments']
}

export function planSessionContextRead(
  request: SessionContextRequest,
  commit: SessionRowCommit,
  threads: ThreadRow[],
  target: SessionContextMessage | undefined
): SessionContextReadPlan {
  assertSessionReadRevision(request, commit.revision)
  const threadId = request.threadId ?? target?.threadId ?? commit.record.activeThreadId
  const thread = threads.find((row) => row.threadId === threadId)
  if (!thread || (target && (target.sessionId !== request.sessionId || target.threadId !== threadId))) {
    throw new Error('Context target does not belong to the requested thread')
  }
  if (request.targetMessageId && target?.messageId !== request.targetMessageId)
    throw new Error('Context target is missing')
  if (!target && thread.activeLeafMessageId !== null) throw new Error('Context path leaf is missing')
  const startMessageId =
    request.targetMessageId && !request.includeTarget ? (target?.parentMessageId ?? null) : (target?.messageId ?? null)
  const projection = commit.record.contextReadProjection
  const projected = projection?.version === 1 ? projection.threads[threadId] : undefined
  let checkpoint: SessionContextCheckpoint | undefined
  if (target && projected && !projected.hasSteeredMessages) {
    const onPath = (endpoint: SessionContextCheckpoint['boundary']) =>
      endpoint.eligible &&
      Number.isSafeInteger(endpoint.seq) &&
      Number.isSafeInteger(endpoint.subtreeEnd) &&
      endpoint.seq <= target.seq &&
      target.seq < endpoint.subtreeEnd &&
      (!request.targetMessageId || endpoint.messageId !== target.messageId)
    for (const candidate of projected.checkpoints) {
      if (
        !thread.compactionPoints.some(
          (point) =>
            point.boundaryMessageId === candidate.point.boundaryMessageId &&
            point.summaryMessageId === candidate.point.summaryMessageId &&
            point.createdAt === candidate.point.createdAt
        )
      )
        continue
      if (!onPath(candidate.boundary) || !onPath(candidate.summary)) continue
      if (!checkpoint || candidate.point.createdAt > checkpoint.point.createdAt) checkpoint = candidate
    }
  }
  const prefixAttachments = checkpoint
    ? projected?.attachments
        .filter(({ owner }) => owner.seq <= checkpoint.boundary.seq && checkpoint.boundary.seq < owner.subtreeEnd)
        .flatMap(({ files }) => files)
    : undefined
  return {
    thread,
    target,
    startMessageId,
    checkpoint,
    prefixAttachments,
    activeThreadName: threads.find((row) => row.threadId === commit.record.activeThreadId)?.name ?? undefined,
  }
}

export type ContextMessageLink = Omit<SessionContextMessage, 'message'>

/** Validation does not require active-child links: retries can address an inactive fork. */
export class SessionContextPathTraversal {
  nextMessageId: string | null
  private child: ContextMessageLink | undefined
  constructor(
    private readonly sessionId: string,
    private readonly plan: SessionContextReadPlan
  ) {
    this.nextMessageId = plan.startMessageId
    this.child = plan.target?.messageId === plan.startMessageId ? undefined : plan.target
  }
  accept(row: ContextMessageLink | undefined): void {
    if (
      !row ||
      row.sessionId !== this.sessionId ||
      row.threadId !== this.plan.thread.threadId ||
      row.messageId !== this.nextMessageId ||
      !Number.isSafeInteger(row.seq) ||
      row.seq < 0 ||
      (this.child && row.seq >= this.child.seq) ||
      (row.parentMessageId === null && row.messageId !== this.plan.thread.rootMessageId)
    ) {
      throw new Error(`Context path is invalid at ${this.nextMessageId}`)
    }
    this.child = row
    this.nextMessageId = row.messageId === this.plan.checkpoint?.point.boundaryMessageId ? null : row.parentMessageId
  }
}

export function finishSessionContextRead(
  request: SessionContextRequest,
  commit: SessionRowCommit,
  plan: SessionContextReadPlan,
  path: SessionContextMessage[],
  extra: SessionContextMessage[] = []
): SessionContextRows | null {
  const checkpoint = plan.checkpoint
  const selected = [...new Map([...extra, ...path].map((row) => [row.messageId, row])).values()].sort(
    (a, b) => a.seq - b.seq
  )
  if (selected.some((row) => row.threadId !== plan.thread.threadId || row.sessionId !== request.sessionId))
    throw new Error('Context payload is from another path')
  if (checkpoint) {
    const applicable = findLatestApplicableCompactionPoint(
      selected.map((row) => row.message).filter(isContextEligibleMessage),
      [checkpoint.point]
    )
    if (!applicable || !path.some((row) => row.messageId === checkpoint.point.boundaryMessageId)) return null
    if (
      checkpoint.systemMessageId &&
      !selected.some(
        (row) =>
          row.messageId === checkpoint.systemMessageId &&
          row.message.role === 'system' &&
          isContextEligibleMessage(row.message)
      )
    )
      return null
  }
  const before = path.filter((row) => !request.targetMessageId || row.messageId !== request.targetMessageId)
  const facts = checkpoint
    ? contextPathFacts(
        before.filter((row) => row.seq > checkpoint.boundary.seq).map((row) => row.message),
        { ...checkpoint.prefix, sandboxSeedAttachments: plan.prefixAttachments ?? [] }
      )
    : contextPathFacts(before.map((row) => row.message))
  if (!checkpoint && before.length === 0) facts.firstMessageTimestamp = plan.target?.message.timestamp
  return {
    ...commit,
    thread: plan.thread,
    activeThreadName: plan.activeThreadName,
    messages: selected.map(({ sessionId, threadId, messageId, parentMessageId, seq, message }) => ({
      sessionId,
      threadId,
      messageId,
      parentMessageId,
      seq,
      message,
    })),
    targetMessage: request.targetMessageId ? plan.target?.message : undefined,
    mode: checkpoint ? 'compacted' : 'full-path',
    beforeTarget: facts,
    effectiveCompactionPoint:
      checkpoint?.point ??
      findLatestApplicableCompactionPoint(
        selected.map((row) => row.message).filter(isContextEligibleMessage),
        plan.thread.compactionPoints
      ),
  }
}

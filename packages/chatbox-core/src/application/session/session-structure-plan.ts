import type { SessionKnownMessageMetadata, SessionMessageRelationsSelector } from '../../ports/session-row-relations'
import type { SessionMessageStructureGuard, SessionStructureResult } from '../../ports/session-structure-command'
import type { MessageRow, MessageRowMetadata, SessionRowRecord, ThreadRow } from '../../session/session-tree/types'
import { assertSessionActionAllowed } from '../../session/action-gates'
import { deriveMessageFacts } from '../../session/message-facts'
import { resolveSessionMode } from '../../session/mode-policy'
import type { Message } from '../../types'
import { emptySessionCommandPlan, type SessionCommandPlan } from './session-command'
import { deriveSessionGenerationControl } from './session-generation-control'

/** Each read is fenced to this command's revision. Callers never expose a complete tree. */
export interface StructureCommandReader {
  record: SessionRowRecord
  revision: number
  activeThread: ThreadRow
  metadata(ids: readonly string[]): Promise<SessionKnownMessageMetadata[]>
  messages(ids: readonly string[]): Promise<MessageRow[]>
  thread(threadId: string): Promise<ThreadRow | null>
  latestArchivedThread(): Promise<ThreadRow | null>
  relations(
    threadId: string,
    selector: SessionMessageRelationsSelector,
    limit: number
  ): Promise<SessionKnownMessageMetadata[]>
}

export interface StructurePlan extends SessionCommandPlan {
  result: SessionStructureResult
}

export function emptyStructurePlan(reader: Pick<StructureCommandReader, 'record'>): StructurePlan {
  return { ...emptySessionCommandPlan(reader.record), result: { applied: false, cancelMessageIds: [] } }
}

export function putMetadata(plan: StructurePlan, row: MessageRowMetadata): void {
  const payload = plan.diff.messages.upsert.find((candidate) => candidate.messageId === row.messageId)
  if (payload) {
    Object.assign(payload, row)
    return
  }
  plan.diff.messageMetadataUpsert ??= []
  const rows = plan.diff.messageMetadataUpsert
  const index = rows.findIndex((candidate) => candidate.messageId === row.messageId)
  if (index < 0) rows.push(row)
  else rows[index] = row
}

export function putThread(plan: StructurePlan, thread: ThreadRow): void {
  const rows = plan.diff.threads.upsert
  const index = rows.findIndex((candidate) => candidate.threadId === thread.threadId)
  if (index < 0) rows.push(thread)
  else rows[index] = thread
}

export async function readMetadata(
  reader: StructureCommandReader,
  id: string | null
): Promise<SessionKnownMessageMetadata | undefined> {
  return id === null ? undefined : (await reader.metadata([id]))[0]
}

/** Resolve the shared summaries between the user pivot and its branch heads. */
export async function readBranchPoint(
  reader: StructureCommandReader,
  pivot: SessionKnownMessageMetadata
): Promise<SessionKnownMessageMetadata> {
  let point = pivot
  const visited = new Set<string>()
  while (point.activeChildId) {
    if (visited.has(point.messageId)) throw new Error('A summary chain contains a cycle')
    visited.add(point.messageId)
    const next = await readMetadata(reader, point.activeChildId)
    if (!next || next.threadId !== pivot.threadId || next.parentMessageId !== point.messageId)
      throw new Error('The branch point has an invalid selected child')
    if (next.kind !== 'summary') break
    point = next
  }
  return point
}

export async function readUserPivot(
  reader: StructureCommandReader,
  row: SessionKnownMessageMetadata
): Promise<SessionKnownMessageMetadata> {
  let pivot = row
  const visited = new Set<string>()
  while (pivot.kind === 'summary' && pivot.parentMessageId) {
    if (visited.has(pivot.messageId)) throw new Error('A summary chain contains a cycle')
    visited.add(pivot.messageId)
    const parent = await readMetadata(reader, pivot.parentMessageId)
    if (!parent || parent.threadId !== row.threadId) throw new Error('Missing summary parent')
    pivot = parent
  }
  return pivot
}

export async function readChildren(
  reader: StructureCommandReader,
  point: MessageRowMetadata,
  limit = 2,
  options: Omit<Extract<SessionMessageRelationsSelector, { kind: 'children' }>, 'kind' | 'parentMessageId'> = {}
): Promise<SessionKnownMessageMetadata[]> {
  return reader.relations(point.threadId, { kind: 'children', parentMessageId: point.messageId, ...options }, limit)
}

export async function nextSiblingOrder(reader: StructureCommandReader, point: MessageRowMetadata): Promise<number> {
  const last = (await readChildren(reader, point, 1, { reverse: true }))[0]
  const siblingOrder = Math.max(last?.siblingOrder ?? -1, point.pendingBranchOrder ?? -1) + 1
  if (!Number.isSafeInteger(siblingOrder)) throw new Error('Sibling order exhausted')
  return siblingOrder
}

export function newMessageRow(
  sessionId: string,
  threadId: string,
  message: Message,
  parentMessageId: string | null,
  siblingOrder: number,
  branchId: string | null = null
): MessageRow {
  if (!message.id || !Number.isSafeInteger(siblingOrder) || siblingOrder < 0)
    throw new Error('Invalid new message identity or order')
  const createdAt = message.timestamp ?? 0
  return {
    sessionId,
    threadId,
    messageId: message.id,
    parentMessageId,
    activeChildId: null,
    siblingOrder,
    branchId,
    kind: message.isSummary ? 'summary' : 'message',
    status: message.generating ? 'generating' : 'settled',
    createdAt,
    updatedAt: message.updatedAt ?? createdAt,
    facts: deriveMessageFacts(message),
    message: { ...message, contentParts: [...message.contentParts] },
  }
}

export async function assertNewMessages(reader: StructureCommandReader, messages: readonly Message[]): Promise<void> {
  const ids = messages.map((message) => message.id)
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) throw new Error('Duplicate new message identity')
  if ((await reader.metadata(ids)).length) throw new Error('Message identity already exists')
}

export function appendNewChain(
  plan: StructurePlan,
  parent: MessageRowMetadata,
  messages: readonly Message[],
  firstSeq: number,
  branchId: string | null
): void {
  let previous: MessageRowMetadata = { ...parent, pendingBranchId: undefined, pendingBranchOrder: undefined }
  for (const [index, message] of messages.entries()) {
    const row = newMessageRow(
      plan.record.id,
      parent.threadId,
      message,
      previous.messageId,
      index ? 0 : firstSeq,
      index ? null : branchId
    )
    putMetadata(plan, { ...previous, activeChildId: row.messageId })
    plan.diff.messages.upsert.push(row)
    plan.appendedMessageIds.push(row.messageId)
    previous = row
  }
}

export async function assertStructureGuard(
  reader: StructureCommandReader,
  guard: SessionMessageStructureGuard | undefined,
  target?: MessageRowMetadata
): Promise<void> {
  if (!guard) return
  const runtimeRows = await reader.metadata([...(guard.activeGenerationMessageIds ?? [])])
  const control = deriveSessionGenerationControl(reader.activeThread, runtimeRows)
  assertSessionActionAllowed(
    guard.action,
    {
      ...control,
      compactionRunning: guard.compactionRunning ?? false,
    },
    {
      messageGenerating: target?.status === 'generating',
      sessionMode: resolveSessionMode(reader.record.settings?.agentMode?.value),
    }
  )
}

export function markBranchNavigation(
  plan: StructurePlan,
  point: MessageRowMetadata,
  firstMessageId: string | null,
  mode: 'create' | 'select' = 'select'
): void {
  plan.result.applied = true
  plan.result.navigation = {
    type: 'branch',
    mode,
    sharedPrefixEnd: { threadId: point.threadId, messageId: point.messageId },
    firstMessageId,
  }
}

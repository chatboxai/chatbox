import type { SessionCompactionOperation } from '../../ports/session-structure-command'
import {
  assertNewMessages,
  emptyStructurePlan,
  newMessageRow,
  putMetadata,
  putThread,
  readMetadata,
  type StructureCommandReader,
  type StructurePlan,
} from './session-structure-plan'

/** Root-first identities from the thread root through `messageId`; null when the chain is broken. */
async function readAncestorPath(
  reader: StructureCommandReader,
  threadId: string,
  messageId: string | null
): Promise<string[] | null> {
  const reversed: string[] = []
  const seen = new Set<string>()
  let next = messageId
  while (next) {
    const page = await reader.relations(threadId, { kind: 'ancestors', messageId: next }, 200)
    if (!page.length) return null
    for (const row of page) {
      if (seen.has(row.messageId)) throw new Error('Compaction ancestry contains a cycle')
      seen.add(row.messageId)
      reversed.push(row.messageId)
    }
    next = page.at(-1)!.parentMessageId
  }
  return reversed.reverse()
}

function samePath(path: readonly string[], expected: readonly string[]): boolean {
  return path.length === expected.length && path.every((id, index) => id === expected[index])
}

/** Publish the summary and its checkpoint in the same owning-thread transaction. */
export async function planCompactionStructure(
  reader: StructureCommandReader,
  operation: SessionCompactionOperation
): Promise<StructurePlan> {
  const empty = () => emptyStructurePlan(reader)
  if (operation.abortSignal?.aborted) return empty()
  const boundary = await readMetadata(reader, operation.coverage.boundaryMessageId)
  if (!boundary || boundary.threadId !== operation.threadId) return empty()
  const thread = await reader.thread(boundary.threadId)
  if (!thread) return empty()
  if (operation.coverage.kind === 'generation') {
    const targetId = operation.coverage.targetMessageId
    const target = (await reader.messages([targetId]))[0]
    const firstTool = target?.message.contentParts.find((part) => part.type === 'tool-call')
    if (
      !target ||
      target.threadId !== thread.threadId ||
      !target.message.generating ||
      target.message.role !== 'assistant' ||
      firstTool?.toolCallId !== operation.coverage.retainedToolCallId
    )
      return empty()
    const path = await readAncestorPath(reader, thread.threadId, target.parentMessageId)
    if (!path || !samePath(path, operation.pathMessageIds)) return empty()
  }
  if (operation.coverage.kind === 'targeted') {
    // The summary stands for exactly the prefix it was generated from; any structural change there abandons it.
    const path = await readAncestorPath(reader, thread.threadId, boundary.messageId)
    if (!path || !samePath(path, operation.pathMessageIds)) return empty()
    // Every branch below the boundary moves under the new summary. A compaction point already inside that
    // subtree would then be preceded by a summary covering part of its own prefix again.
    const prefix = new Set(path)
    for (const point of thread.compactionPoints) {
      if (point.boundaryMessageId === boundary.messageId) return empty()
      if (prefix.has(point.boundaryMessageId)) continue
      const pointPath = await readAncestorPath(reader, thread.threadId, point.boundaryMessageId)
      if (pointPath?.includes(boundary.messageId)) return empty()
    }
  }
  await assertNewMessages(reader, [operation.summary])
  if (!operation.summary.isSummary || operation.summary.role !== 'assistant')
    throw new Error('Invalid compaction summary')
  const plan = empty()
  const summary = newMessageRow(reader.record.id, thread.threadId, operation.summary, boundary.messageId, 0)
  summary.activeChildId = boundary.activeChildId
  summary.forkPivotId = boundary.forkPivotId
  summary.pendingBranchId = boundary.pendingBranchId
  summary.pendingBranchOrder = boundary.pendingBranchOrder
  plan.diff.messages.upsert.push(summary)
  plan.diff.insertParents = [
    { threadId: thread.threadId, parentMessageId: boundary.messageId, newParentMessageId: summary.messageId },
  ]
  putMetadata(plan, {
    ...boundary,
    activeChildId: summary.messageId,
    forkPivotId: undefined,
    pendingBranchId: undefined,
    pendingBranchOrder: undefined,
  })
  putThread(plan, {
    ...thread,
    activeLeafMessageId:
      thread.activeLeafMessageId === boundary.messageId ? summary.messageId : thread.activeLeafMessageId,
    compactionPoints: [
      ...thread.compactionPoints,
      { summaryMessageId: summary.messageId, boundaryMessageId: boundary.messageId, createdAt: operation.createdAt },
    ],
  })
  if (operation.abortSignal?.aborted) return empty()
  plan.appendedMessageIds.push(summary.messageId)
  plan.result.applied = true
  return plan
}

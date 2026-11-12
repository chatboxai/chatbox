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
    const reversed: string[] = []
    const seen = new Set<string>()
    let next: string | null = target.parentMessageId
    while (next) {
      const page = await reader.relations(thread.threadId, { kind: 'ancestors', messageId: next }, 200)
      if (!page.length) return empty()
      for (const row of page) {
        if (seen.has(row.messageId)) throw new Error('Compaction ancestry contains a cycle')
        seen.add(row.messageId)
        reversed.push(row.messageId)
      }
      next = page.at(-1)!.parentMessageId
    }
    const path = reversed.reverse()
    if (
      path.length !== operation.pathMessageIds.length ||
      path.some((id, index) => id !== operation.pathMessageIds[index])
    )
      return empty()
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

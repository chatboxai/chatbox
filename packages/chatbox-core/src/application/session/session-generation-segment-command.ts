import type { SessionMessageStructureOperation } from '../../ports/session-structure-command'
import {
  emptyStructurePlan,
  newMessageRow,
  nextSiblingOrder,
  putMetadata,
  readBranchPoint,
  readMetadata,
  type StructureCommandReader,
  type StructurePlan,
} from './session-structure-plan'

/** Commit the terminal prefix and its continuation against the same row revision. */
export async function planGenerationSegmentSplit(
  reader: StructureCommandReader,
  operation: Extract<SessionMessageStructureOperation, { action: 'generation-segment-split' }>
): Promise<StructurePlan> {
  const plan = emptyStructurePlan(reader)
  if (operation.abortSignal?.aborted) return plan
  const { prefix, continuation, afterMessageId } = operation
  if (
    prefix.id === continuation.id ||
    prefix.role !== 'assistant' ||
    continuation.role !== 'assistant' ||
    prefix.generating !== false ||
    continuation.generating !== true
  )
    throw new Error('Invalid generation segment split')
  const bodies = await reader.messages([prefix.id, continuation.id])
  const target = bodies.find((row) => row.messageId === prefix.id)
  const existing = bodies.find((row) => row.messageId === continuation.id)
  if (!target) throw new Error('Generation split target no longer exists')
  if (existing) {
    if (
      target.threadId === existing.threadId &&
      !target.message.generating &&
      target.message.finishReason === prefix.finishReason &&
      JSON.stringify(target.message.contentParts) === JSON.stringify(prefix.contentParts) &&
      JSON.stringify(existing.message.contentParts) === JSON.stringify(continuation.contentParts)
    ) {
      plan.result.applied = true
      return plan
    }
    throw new Error('Generation continuation id already exists')
  }
  if (!target.message.generating) return plan
  let cursor: string | null = target.messageId
  const starts = new Set<string>()
  let anchor: Awaited<ReturnType<typeof readMetadata>>
  while (cursor) {
    if (starts.has(cursor)) throw new Error('Cyclic generation split path')
    starts.add(cursor)
    const page = await reader.relations(target.threadId, { kind: 'selected-path', messageId: cursor }, 200)
    anchor = page.find((row) => row.messageId === afterMessageId)
    if (anchor) break
    cursor = page.at(-1)?.activeChildId ?? null
  }
  if (!anchor) throw new Error('Generation split anchor is outside the target path')
  const point = await readBranchPoint(reader, anchor)
  const next = await readMetadata(reader, point.activeChildId)
  if (operation.abortSignal?.aborted) return plan
  plan.diff.messages.upsert.push({
    ...target,
    message: prefix,
    status: 'settled',
    updatedAt: prefix.updatedAt ?? target.updatedAt,
  })
  const inserted = newMessageRow(
    reader.record.id,
    point.threadId,
    continuation,
    point.messageId,
    next?.siblingOrder ?? point.pendingBranchOrder ?? (await nextSiblingOrder(reader, point)),
    next?.branchId ?? point.pendingBranchId ?? null
  )
  inserted.activeChildId = next?.messageId ?? null
  plan.diff.messages.upsert.push(inserted)
  if (next) putMetadata(plan, { ...next, parentMessageId: inserted.messageId, siblingOrder: 0, branchId: null })
  putMetadata(plan, {
    ...point,
    ...(point.messageId === target.messageId
      ? { status: 'settled' as const, updatedAt: prefix.updatedAt ?? target.updatedAt }
      : {}),
    activeChildId: inserted.messageId,
    pendingBranchId: undefined,
    pendingBranchOrder: undefined,
  })
  plan.appendedMessageIds.push(inserted.messageId)
  plan.result.applied = true
  return plan
}

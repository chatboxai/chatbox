import { recoverInterruptedMessage } from './session-generation-recovery'
import type { SessionMessageStructureOperation } from '../../ports/session-structure-command'
import { isActionAvailableInMode, resolveSessionMode } from '../../session/mode-policy'
import type { MessageRow } from '../../session/session-tree/types'
import { MessageAnchorNotFoundError } from './message-command-types'
import { planForkStructure } from './session-fork-command'
import { planSessionCommand } from './session-command'
import {
  assertNewMessages,
  assertStructureGuard,
  emptyStructurePlan,
  newMessageRow,
  nextSiblingOrder,
  putMetadata,
  putThread,
  readBranchPoint,
  readChildren,
  readMetadata,
  readUserPivot,
  type StructureCommandReader,
  type StructurePlan,
} from './session-structure-plan'

export async function planMessageStructure(
  reader: StructureCommandReader,
  operation: Exclude<SessionMessageStructureOperation, { action: 'generation-segment-split' | 'background-follow-up' }>
): Promise<StructurePlan> {
  const plan = emptyStructurePlan(reader)
  if (operation.action === 'message-recover') {
    const original = (await reader.messages([operation.messageId]))[0]
    if (!original) return plan
    const recovered = recoverInterruptedMessage(original.message, operation.bootTime, operation.now)
    if (recovered === undefined) return plan
    if (recovered === null)
      return planMessageStructure(reader, {
        action: 'message-remove',
        messageId: operation.messageId,
        replacementPivotId: operation.replacementPivotId,
      })
    return {
      ...planSessionCommand(
        { record: reader.record, revision: reader.revision, thread: reader.activeThread },
        { type: 'update', messageId: operation.messageId, updater: recovered },
        [original]
      ),
      result: { applied: true, cancelMessageIds: [] },
    }
  }
  if (operation.action === 'message-retry') {
    const target = await readMetadata(reader, operation.messageId)
    if (!target) throw new Error(`Message ${operation.messageId} not found`)
    await assertStructureGuard(reader, operation.guard, target)
    let parentId = target.parentMessageId
    let pivot: Awaited<ReturnType<typeof readMetadata>>
    while (parentId) {
      const ancestors = await reader.relations(target.threadId, { kind: 'ancestors', messageId: parentId }, 200)
      if (!ancestors.length) throw new Error('Missing retry predecessor')
      pivot = ancestors.find((row) => row.kind !== 'summary')
      if (pivot) break
      parentId = ancestors.at(-1)!.parentMessageId
    }
    if (pivot) {
      const fork = await planForkStructure(reader, {
        action: 'fork-create',
        pivotId: pivot.messageId,
        identity: operation.identity,
        append: [operation.reply],
        guard: operation.guard,
      })
      if (!fork.result.applied) throw new Error('Unable to create retry branch')
      fork.result.replyMessageId = operation.reply.id
      return fork
    }
    const original = (await reader.messages([target.messageId]))[0]
    if (!original) throw new Error('Missing retry message')
    return {
      ...planSessionCommand(
        { record: reader.record, revision: reader.revision, thread: reader.activeThread },
        {
          type: 'update',
          messageId: target.messageId,
          updater: {
            generating: true,
            contentParts: [],
            error: undefined,
            errorCode: undefined,
            errorExtra: undefined,
            finishReason: undefined,
            status: [],
            timestamp: operation.reply.timestamp,
          },
        },
        [original]
      ),
      result: { applied: true, cancelMessageIds: [], replyMessageId: target.messageId },
    }
  }
  if (operation.action === 'set-system-prompt') {
    const thread = reader.activeThread
    if (!thread.summary) throw new Error('Thread summary is unavailable')
    const targetId = thread.summary.firstSystemMessageId
    if (targetId && !operation.text)
      return planMessageStructure(reader, {
        action: 'message-remove',
        messageId: targetId,
        replacementPivotId: operation.replacementPivotId,
      })
    if (targetId) {
      const target = (await reader.messages([targetId]))[0]
      if (!target) throw new Error('Missing system prompt message')
      return {
        ...planSessionCommand(
          { record: reader.record, revision: reader.revision, thread },
          { type: 'update', messageId: targetId, updater: { contentParts: [{ type: 'text', text: operation.text }] } },
          [target]
        ),
        result: { applied: true, cancelMessageIds: [] },
      }
    }
    if (!operation.text) return plan
    const message = {
      id: operation.messageId,
      role: 'system' as const,
      contentParts: [{ type: 'text' as const, text: operation.text }],
      timestamp: operation.now,
    }
    await assertNewMessages(reader, [message])
    const root = await readMetadata(reader, thread.rootMessageId)
    const inserted = newMessageRow(reader.record.id, thread.threadId, message, null, 0)
    inserted.activeChildId = root?.messageId ?? null
    plan.diff.messages.upsert.push(inserted)
    if (root) putMetadata(plan, { ...root, parentMessageId: inserted.messageId, siblingOrder: 0, branchId: null })
    putThread(plan, {
      ...thread,
      rootMessageId: inserted.messageId,
      activeLeafMessageId: thread.activeLeafMessageId ?? inserted.messageId,
    })
    plan.result.applied = true
    return plan
  }
  if (operation.action === 'message-insert-after') {
    let anchor = await readMetadata(reader, operation.previousId)
    if (anchor && !anchor.selected) anchor = undefined
    const existing = await readMetadata(reader, operation.message.id)
    if (existing) {
      if (
        existing.selected &&
        (existing.threadId === (anchor?.threadId ?? reader.activeThread.threadId) ||
          (!anchor && operation.requireAnchor))
      )
        return plan
      throw new Error('Message identity already exists')
    }
    if (!anchor && operation.requireAnchor) throw new MessageAnchorNotFoundError(reader.record.id, operation.previousId)
    if (!anchor) anchor = await readMetadata(reader, reader.activeThread.activeLeafMessageId)
    if (operation.guard?.action === 'reply-below') {
      if (!isActionAvailableInMode('reply-below', resolveSessionMode(reader.record.settings?.agentMode?.value)))
        throw new Error('Reply Again Below is unavailable in Work Mode')
      if (
        !anchor ||
        !anchor.facts.contextEligible ||
        anchor.kind === 'summary' ||
        (anchor.facts.role !== 'user' && anchor.facts.role !== 'system')
      )
        throw new Error('Message cannot receive a reply below')
    }
    await assertStructureGuard(reader, operation.guard, anchor)
    if (anchor) anchor = await readBranchPoint(reader, anchor)
    const thread = anchor ? await reader.thread(anchor.threadId) : reader.activeThread
    if (!thread) throw new Error('Missing insertion thread')
    const next = await readMetadata(reader, anchor?.activeChildId ?? null)
    const siblingOrder =
      next?.siblingOrder ?? anchor?.pendingBranchOrder ?? (anchor ? await nextSiblingOrder(reader, anchor) : 0)
    const inserted = newMessageRow(
      reader.record.id,
      thread.threadId,
      operation.message,
      anchor?.messageId ?? null,
      siblingOrder,
      next?.branchId ?? anchor?.pendingBranchId ?? null
    )
    inserted.activeChildId = next?.messageId ?? null
    plan.diff.messages.upsert.push(inserted)
    if (next) putMetadata(plan, { ...next, parentMessageId: inserted.messageId, siblingOrder: 0, branchId: null })
    if (anchor)
      putMetadata(plan, {
        ...anchor,
        activeChildId: inserted.messageId,
        pendingBranchId: undefined,
        pendingBranchOrder: undefined,
      })
    else putThread(plan, { ...thread, rootMessageId: inserted.messageId, activeLeafMessageId: inserted.messageId })
    plan.appendedMessageIds.push(inserted.messageId)
    plan.result.applied = true
    return plan
  }

  if (operation.action === 'session-clear') {
    await assertStructureGuard(reader, operation.guard)
    const active = reader.activeThread
    if (!active.summary) throw new Error('Thread summary is unavailable')
    const keepId = active.summary.firstSystemMessageId
    const keep = keepId ? (await reader.messages([keepId]))[0] : undefined
    if (keepId && !keep) throw new Error('Missing retained system message')
    if (operation.scope === 'all') {
      plan.diff.deleteSessionMessages = true
      plan.diff.deleteArchivedThreads = true
      plan.result.affectedScopes = [{ type: 'session' }]
    } else {
      plan.diff.deleteThreadMessages = [active.threadId]
      plan.result.affectedScopes = [{ type: 'thread', threadId: active.threadId }]
    }
    if (keep) plan.diff.messages.upsert.push(retainedSystem(keep))
    putThread(plan, {
      ...active,
      rootMessageId: keep?.messageId ?? null,
      activeLeafMessageId: keep?.messageId ?? null,
      compactionPoints: [],
      ...(operation.scope === 'all' ? { name: '' } : {}),
    })
    plan.result.applied = true
    return plan
  }

  const target = await readMetadata(reader, operation.messageId)
  if (!target) return plan
  if (operation.guard?.action !== 'delete-summary' || target.kind === 'summary')
    await assertStructureGuard(reader, operation.guard)
  const thread = await reader.thread(target.threadId)
  if (!thread) throw new Error('Missing removal thread')
  const parent = await readMetadata(reader, target.parentMessageId)
  const point = await readBranchPoint(reader, target)
  const hasFork = target.forkCreatedAt !== undefined
  let updatedThread = {
    ...thread,
    compactionPoints: thread.compactionPoints.filter(
      (checkpoint) =>
        checkpoint.summaryMessageId !== target.messageId && checkpoint.boundaryMessageId !== target.messageId
    ),
  }

  if (hasFork && (!parent || point.messageId !== target.messageId)) {
    await assertNewMessages(reader, [{ id: operation.replacementPivotId, role: 'system', contentParts: [] }])
    const replacement = newMessageRow(
      reader.record.id,
      target.threadId,
      { id: operation.replacementPivotId, role: 'system', contentParts: [] },
      target.parentMessageId,
      target.siblingOrder,
      target.branchId
    )
    Object.assign(replacement, {
      activeChildId: target.activeChildId,
      forkCreatedAt: target.forkCreatedAt,
      forkPivotId: point.messageId === target.messageId ? replacement.messageId : undefined,
      pendingBranchId: target.pendingBranchId,
      pendingBranchOrder: target.pendingBranchOrder,
    })
    plan.diff.messages.upsert.push(replacement)
    if (point.messageId !== target.messageId)
      putMetadata(plan, {
        ...point,
        parentMessageId: point.parentMessageId === target.messageId ? replacement.messageId : point.parentMessageId,
        forkPivotId: replacement.messageId,
      })
    plan.diff.replaceMessagePivots = [
      { threadId: target.threadId, messageId: target.messageId, replacementMessageId: replacement.messageId },
    ]
    if (parent?.activeChildId === target.messageId)
      putMetadata(plan, { ...parent, activeChildId: replacement.messageId })
    if (thread.rootMessageId === target.messageId) updatedThread.rootMessageId = replacement.messageId
    updatedThread.compactionPoints = thread.compactionPoints
      .filter((checkpoint) => checkpoint.summaryMessageId !== target.messageId)
      .map((checkpoint) =>
        checkpoint.boundaryMessageId === target.messageId
          ? { ...checkpoint, boundaryMessageId: replacement.messageId }
          : checkpoint
      )
  } else if (parent) {
    const lastChild = (await readChildren(reader, target, 1, { reverse: true }))[0]
    const spread = Math.max(lastChild?.siblingOrder ?? 0, target.pendingBranchOrder ?? 0)
    if (spread)
      plan.diff.siblingShifts = [
        {
          threadId: target.threadId,
          parentMessageId: parent.messageId,
          afterSiblingOrder: target.siblingOrder,
          delta: spread,
        },
      ]
    plan.diff.reparentChildren = [
      {
        threadId: target.threadId,
        parentMessageId: target.messageId,
        newParentMessageId: parent.messageId,
        siblingOrderOffset: target.siblingOrder,
        ...(!hasFork && target.kind !== 'summary' ? { branchId: target.branchId } : {}),
      },
    ]
    let updatedParent = { ...parent }
    if (parent.activeChildId === target.messageId) {
      updatedParent.activeChildId = target.activeChildId
      if (target.pendingBranchId) {
        updatedParent.pendingBranchId = target.pendingBranchId
        updatedParent.pendingBranchOrder = target.siblingOrder + target.pendingBranchOrder!
      }
    }
    putMetadata(plan, updatedParent)
    if (hasFork) {
      const pivot = await readUserPivot(reader, parent)
      putMetadata(plan, { ...updatedParent, forkPivotId: pivot.messageId })
      putMetadata(plan, {
        ...(plan.diff.messageMetadataUpsert?.find((row) => row.messageId === pivot.messageId) ?? pivot),
        forkCreatedAt: pivot.forkCreatedAt ?? target.forkCreatedAt,
      })
    }
    if (!target.activeChildId && !target.pendingBranchId && !lastChild) {
      if (parent.activeChildId === target.messageId) {
        const next =
          (
            await readChildren(reader, parent, 1, {
              boundary: { siblingOrder: target.siblingOrder, messageId: target.messageId },
            })
          )[0] ??
          (
            await readChildren(reader, parent, 1, {
              boundary: { siblingOrder: target.siblingOrder, messageId: target.messageId },
              reverse: true,
            })
          )[0]
        updatedParent.activeChildId = next?.messageId ?? null
        putMetadata(plan, updatedParent)
      }
      if (parent.forkPivotId) {
        const siblings = (await readChildren(reader, parent, 3)).filter((row) => row.messageId !== target.messageId)
        const remainingBranches = siblings.length + Number(Boolean(parent.pendingBranchId))
        if (remainingBranches <= 1) {
          const pivot = await readUserPivot(reader, parent)
          putMetadata(plan, {
            ...(plan.diff.messageMetadataUpsert?.find((row) => row.messageId === pivot.messageId) ?? pivot),
            forkCreatedAt: undefined,
            fork: undefined,
          })
          putMetadata(plan, {
            ...(plan.diff.messageMetadataUpsert?.find((row) => row.messageId === parent.messageId) ?? updatedParent),
            forkPivotId: undefined,
            pendingBranchId: undefined,
            pendingBranchOrder: undefined,
          })
          if (siblings[0]) putMetadata(plan, { ...siblings[0], branchId: null })
        }
      }
    }
  } else {
    const child = await readMetadata(reader, target.activeChildId)
    if (child) putMetadata(plan, { ...child, parentMessageId: null, siblingOrder: 0, branchId: null })
    updatedThread.rootMessageId = child?.messageId ?? null
  }
  putThread(plan, updatedThread)
  plan.diff.messages.delete.push(target.messageId)
  plan.result.applied = true
  plan.result.affectedMessageIds = [target.messageId]
  if (target.status === 'generating' || operation.guard?.activeGenerationMessageIds?.has(target.messageId))
    plan.result.cancelMessageIds.push(target.messageId)
  return plan
}

export function retainedSystem(row: MessageRow): MessageRow {
  return {
    ...row,
    parentMessageId: null,
    activeChildId: null,
    siblingOrder: 0,
    branchId: null,
    forkCreatedAt: undefined,
    fork: undefined,
    forkPivotId: undefined,
    pendingBranchId: undefined,
    pendingBranchOrder: undefined,
  }
}

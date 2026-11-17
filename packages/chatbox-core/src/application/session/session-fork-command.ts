import type { SessionForkOperation } from '../../ports/session-fork-command'
import type { SessionKnownMessageMetadata } from '../../ports/session-row-relations'
import type { Message } from '../../types'
import {
  appendNewChain,
  assertNewMessages,
  assertStructureGuard,
  emptyStructurePlan,
  markBranchNavigation,
  nextSiblingOrder,
  putMetadata,
  readBranchPoint,
  readChildren,
  readMetadata,
  readUserPivot,
  type StructureCommandReader,
  type StructurePlan,
} from './session-structure-plan'

function validateEditedTarget(
  message: Message | undefined,
  reader: StructureCommandReader,
  expected: Message['contentParts'],
  edited: Message['contentParts']
): asserts message is Message {
  if (!message || message.role !== 'user' || message.isSummary || message.isForkMarker)
    throw new Error('Save & Resend requires a user message.')
  if (
    !edited.some((part) => part.type === 'image' || (part.type === 'text' && part.text.trim())) &&
    !message.files?.length &&
    !message.links?.length
  )
    throw new Error('Enter a message or add an attachment.')
  if (!reader.record.settings?.provider?.trim() || !reader.record.settings.modelId?.trim())
    throw new Error('Select a model before sending.')
  if (JSON.stringify(message.contentParts) !== JSON.stringify(expected))
    throw new Error('The message changed while editing. Reopen the editor before saving.')
}

async function adjacentBranch(
  reader: StructureCommandReader,
  point: SessionKnownMessageMetadata,
  current: { siblingOrder: number; messageId: string },
  reverse: boolean
): Promise<SessionKnownMessageMetadata | undefined> {
  return (
    (await readChildren(reader, point, 1, { reverse, boundary: current }))[0] ??
    (await readChildren(reader, point, 1, { reverse }))[0]
  )
}

/** Fork edits retain sibling identities and publish only the changed edges. */
export async function planForkStructure(
  reader: StructureCommandReader,
  operation: SessionForkOperation
): Promise<StructurePlan> {
  const plan = emptyStructurePlan(reader)
  let replacement: Message | undefined
  let pivot: SessionKnownMessageMetadata | undefined
  if (operation.action === 'fork-save-resend') {
    const target = await readMetadata(reader, operation.targetMessageId)
    if (!target) return plan
    if (operation.expectedContentParts) {
      const message = (await reader.messages([target.messageId]))[0]?.message
      validateEditedTarget(message, reader, operation.expectedContentParts, operation.replacement.contentParts)
      replacement = {
        ...message,
        id: operation.replacement.id,
        contentParts: operation.replacement.contentParts,
        timestamp: operation.replacement.timestamp,
        tokenCount: undefined,
        tokenCountMap: undefined,
        tokenCalculatedAt: undefined,
        tokenCountApproximate: undefined,
      }
    } else replacement = operation.replacement
    await assertStructureGuard(reader, operation.guard && { ...operation.guard, action: 'save-and-resend' }, target)
    const parent = await readMetadata(reader, target.parentMessageId)
    if (!parent) {
      if (target.parentMessageId !== null) throw new Error('Missing edited message parent')
      const fork = await planForkStructure(reader, {
        action: 'fork-create',
        pivotId: target.messageId,
        identity: operation.identity,
        append: operation.append,
        guard: operation.guard,
      })
      if (!fork.result.applied) return fork
      const original = (await reader.messages([target.messageId]))[0]
      if (!original) throw new Error('Missing edited message')
      const metadata = fork.diff.messageMetadataUpsert?.find((row) => row.messageId === target.messageId)
      fork.diff.messages.upsert.push({ ...original, ...metadata, message: { ...replacement, id: target.messageId } })
      fork.diff.messageMetadataUpsert = fork.diff.messageMetadataUpsert?.filter(
        (row) => row.messageId !== target.messageId
      )
      return fork
    }
    if (parent.activeChildId !== target.messageId) return plan
    pivot = await readUserPivot(reader, parent)
  } else pivot = await readMetadata(reader, operation.pivotId)
  if (!pivot || pivot.kind === 'summary') return plan
  const point = await readBranchPoint(reader, pivot)
  const selected = await readMetadata(reader, point.activeChildId)
  const children = await readChildren(reader, point, 3)
  const hasFork = children.length > 1 || (children.length > 0 && point.activeChildId === null)
  await assertStructureGuard(reader, operation.guard)

  const select = (target: SessionKnownMessageMetadata | undefined, collapse: boolean) => {
    putMetadata(plan, {
      ...point,
      forkPivotId: collapse ? undefined : pivot.messageId,
      activeChildId: target?.messageId ?? null,
      pendingBranchId: undefined,
      pendingBranchOrder: undefined,
    })
    if (collapse) {
      putMetadata(plan, {
        ...(plan.diff.messageMetadataUpsert?.find((row) => row.messageId === pivot.messageId) ?? pivot),
        forkCreatedAt: undefined,
        fork: undefined,
      })
      if (target) putMetadata(plan, { ...target, branchId: null })
    }
    markBranchNavigation(plan, point, target?.messageId ?? null)
  }

  if (operation.action === 'fork-switch') {
    if (!hasFork) return plan
    let target: SessionKnownMessageMetadata | undefined
    if (typeof operation.target === 'object') {
      if (operation.target.branchId === point.pendingBranchId || operation.target.branchId === selected?.branchId)
        return plan
      target = (await readChildren(reader, point, 1, { branchId: operation.target.branchId }))[0]
    } else {
      if (operation.target !== 'next' && operation.target !== 'prev')
        throw new Error('A stable branch identity is required')
      target = await adjacentBranch(
        reader,
        point,
        selected ?? { siblingOrder: point.pendingBranchOrder!, messageId: '' },
        operation.target === 'prev'
      )
    }
    if (!target || target.messageId === selected?.messageId) return plan
    select(target, children.length === 1)
    return plan
  }

  if (operation.action === 'fork-delete') {
    if (!hasFork) return plan
    const boundary = selected ?? { siblingOrder: point.pendingBranchOrder!, messageId: '' }
    const next =
      (await readChildren(reader, point, 1, { boundary }))[0] ??
      (await readChildren(reader, point, 1, { boundary, reverse: true }))[0]
    if (selected) {
      plan.diff.deleteSubtrees = [{ threadId: point.threadId, rootMessageId: selected.messageId }]
      plan.result.affectedScopes = [{ type: 'subtree', threadId: point.threadId, rootMessageId: selected.messageId }]
    }
    select(next, children.filter((row) => row.messageId !== selected?.messageId).length <= 1)
    return plan
  }

  if (operation.action === 'fork-expand') {
    if (!hasFork) return plan
    plan.diff.expandForks = [{ threadId: point.threadId, branchPointId: point.messageId }]
    putMetadata(plan, {
      ...pivot,
      forkCreatedAt: undefined,
      fork: undefined,
      ...(pivot.messageId === point.messageId
        ? {
            forkPivotId: undefined,
            activeChildId: selected?.messageId ?? children[0]?.messageId ?? null,
            pendingBranchId: undefined,
            pendingBranchOrder: undefined,
          }
        : {}),
    })
    if (pivot.messageId !== point.messageId)
      putMetadata(plan, {
        ...point,
        forkPivotId: undefined,
        pendingBranchId: undefined,
        pendingBranchOrder: undefined,
        activeChildId: selected?.messageId ?? children[0]?.messageId ?? null,
      })
    markBranchNavigation(plan, point, selected?.messageId ?? children[0]?.messageId ?? null)
    return plan
  }

  if (!selected || (operation.action === 'fork-save-resend' && selected.messageId !== operation.targetMessageId))
    return plan
  const inserted = replacement ? [replacement, ...(operation.append ?? [])] : (operation.append ?? [])
  await assertNewMessages(reader, inserted)
  const siblingOrder = await nextSiblingOrder(reader, point)
  const branchId = `fork_list_${operation.identity.newListId}`
  putMetadata(plan, { ...selected, branchId: selected.branchId ?? `fork_list_${operation.identity.storedListId}` })
  putMetadata(plan, { ...pivot, forkCreatedAt: pivot.forkCreatedAt ?? operation.identity.createdAt })
  const updatedPoint = {
    ...(plan.diff.messageMetadataUpsert?.find((row) => row.messageId === point.messageId) ?? point),
    forkPivotId: pivot.messageId,
    activeChildId: null,
    pendingBranchId: branchId,
    pendingBranchOrder: siblingOrder,
  }
  putMetadata(plan, updatedPoint)
  appendNewChain(plan, updatedPoint, inserted, siblingOrder, branchId)
  markBranchNavigation(plan, point, inserted[0]?.id ?? null, 'create')
  return plan
}

import { deriveContextReadProjection } from '../../persistence/session-context-read'
import { hasPendingPauseInteraction } from '../../message-approval'
import type { SessionForkOperation } from '../../ports/session-fork-command'
import type { SessionStructureSnapshot } from '../../ports/session-row-store'
import type { SessionStructureResult } from '../../ports/session-structure-command'
import { assertSessionActionAllowed, deriveSessionLockState } from '../../session/action-gates'
import {
  countCancellableGeneratingAssistantMessages,
  getReachableSessionMessages,
} from '../../session/generation-state'
import {
  buildCreateForkPatch,
  buildDeleteForkPatch,
  buildExpandForkPatch,
  buildSaveAndResendForkPatch,
  buildSwitchForkPatch,
  buildSwitchForkToPatch,
  findMessageLocation,
} from '../../session/message-forks'
import { resolveSessionMode } from '../../session/mode-policy'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '../../session/session-tree/types'
import type { Message, Session } from '../../types'
import { applyMessageInsert } from './message-tree'
import {
  projectStructurePresentation,
  structureActivePath,
  reindexStructureThreads,
  type StructurePlan,
} from './session-structure-plan'

const unchanged = (): SessionStructureResult => ({ applied: false, cancelMessageIds: [] })

export function applyForkStructure(
  session: Session,
  operation: SessionForkOperation
): { session: Session; result: SessionStructureResult } {
  if (operation.action === 'fork-save-resend' && operation.expectedContentParts) {
    const location = findMessageLocation(session, operation.targetMessageId)
    validateEditedTarget(
      location?.list[location.index],
      session.settings,
      operation.expectedContentParts,
      operation.replacement.contentParts
    )
  }
  if (operation.guard)
    assertSessionActionAllowed(operation.guard.action, deriveSessionLockState(session, operation.guard), {
      sessionMode: resolveSessionMode(session.settings?.agentMode?.value),
    })
  let patch: Partial<Session> | null
  const identity =
    'identity' in operation
      ? (() => {
          const ids = [operation.identity.seedListId, operation.identity.storedListId, operation.identity.newListId]
          // Existing forks already have their seed list identity.
          const pivot =
            operation.action === 'fork-save-resend'
              ? (() => {
                  const location = findMessageLocation(session, operation.targetMessageId)
                  if (!location) return undefined
                  let index = location.index - 1
                  while (index >= 0 && location.list[index].isSummary) index--
                  return location.list[index]?.id
                })()
              : operation.pivotId
          if (pivot && session.messageForksHash?.[pivot]) ids.shift()
          return {
            createId: () => {
              const id = ids.shift()
              if (!id) throw new Error('Missing fork identity')
              return id
            },
            now: () => operation.identity.createdAt,
          }
        })()
      : undefined
  switch (operation.action) {
    case 'fork-create':
      patch = buildCreateForkPatch(session, operation.pivotId, identity!)
      break
    case 'fork-save-resend':
      {
        const location = findMessageLocation(session, operation.targetMessageId)
        patch = buildSaveAndResendForkPatch(
          session,
          operation.targetMessageId,
          forkReplacement(operation, location?.list[location.index]),
          identity!
        )
      }
      break
    case 'fork-delete':
      patch = buildDeleteForkPatch(session, operation.pivotId)
      break
    case 'fork-expand':
      patch = buildExpandForkPatch(session, operation.pivotId)
      break
    case 'fork-switch':
      patch =
        typeof operation.target === 'number'
          ? buildSwitchForkToPatch(session, operation.pivotId, operation.target)
          : buildSwitchForkPatch(session, operation.pivotId, operation.target)
      break
  }
  if (!patch) return { session, result: unchanged() }
  let updated = { ...session, ...patch }
  if ('append' in operation) {
    const anchor = operation.action === 'fork-save-resend' ? operation.replacement.id : operation.pivotId
    for (const message of operation.append ?? []) {
      const location = findMessageLocation(updated, anchor)
      const tail = location?.list.at(-1)
      if (!tail) throw new Error('Missing fork append anchor')
      updated = applyMessageInsert(updated, session.id, message, tail.id, { requireAnchor: true })
    }
  }
  const survivingMessages = getReachableSessionMessages(updated)
  const surviving = new Set(survivingMessages.map((message) => message.id))
  const removedMessages = getReachableSessionMessages(session).filter((message) => !surviving.has(message.id))
  return {
    session: updated,
    result: {
      applied: true,
      cancelMessageIds: removedMessages.filter((message) => message.generating).map((message) => message.id),
      ...(operation.action === 'fork-delete' ? { removedMessages, survivingMessages } : {}),
    },
  }
}

function validateEditedTarget(
  message: Message | undefined,
  settings: Session['settings'],
  expected: Message['contentParts'],
  edited: Message['contentParts']
): void {
  if (!message || message.role !== 'user' || message.isSummary || message.isForkMarker)
    throw new Error('Save & Resend requires a user message.')
  if (
    !edited.some((part) => part.type === 'image' || (part.type === 'text' && part.text.trim())) &&
    !message.files?.length &&
    !message.links?.length
  )
    throw new Error('Enter a message or add an attachment.')
  if (!settings?.provider?.trim() || !settings.modelId?.trim()) throw new Error('Select a model before sending.')
  if (JSON.stringify(message.contentParts) !== JSON.stringify(expected))
    throw new Error('The message changed while editing. Reopen the editor before saving.')
}

function forkReplacement(
  operation: Extract<SessionForkOperation, { action: 'fork-save-resend' }>,
  target: Message | undefined
): Message {
  if (!operation.expectedContentParts || !target) return operation.replacement
  return {
    ...target,
    id: operation.replacement.id,
    contentParts: operation.replacement.contentParts,
    timestamp: operation.replacement.timestamp,
    tokenCount: undefined,
    tokenCountMap: undefined,
    tokenCalculatedAt: undefined,
    tokenCountApproximate: undefined,
  }
}

/** Mutate topology while retaining every unchanged message payload. */
export async function planForkStructure(
  snapshot: SessionStructureSnapshot,
  operation: SessionForkOperation,
  readMessages: (ids: string[]) => Promise<MessageRow[]>
): Promise<StructurePlan | null> {
  if (operation.action === 'fork-expand' || !snapshot.record.presentation || !snapshot.record.contextReadProjection)
    return null
  let messages = snapshot.messages.map((row) => ({ ...row }))
  const byId = new Map(messages.map((row) => [row.messageId, row]))
  const upsertMessages: MessageRow[] = []
  const payloads = new Map<string, Message>()
  const read = async (ids: string[]) => {
    for (const row of await readMessages(ids.filter((id) => !payloads.has(id))))
      payloads.set(row.messageId, row.message)
    return ids.map((id) => {
      const message = payloads.get(id)
      if (!message) throw new Error(`Missing fork message ${id}`)
      return message
    })
  }
  const emptyPlan = (): StructurePlan => ({
    record: snapshot.record,
    threads: snapshot.threads,
    messages: snapshot.messages,
    upsertMessages: [],
    result: unchanged(),
  })
  let pivotId: string
  if (operation.action === 'fork-save-resend') {
    const target = byId.get(operation.targetMessageId)
    if (!target) return emptyPlan()
    if (operation.expectedContentParts) {
      const [message] = await read([target.messageId])
      validateEditedTarget(
        message,
        snapshot.record.settings,
        operation.expectedContentParts,
        operation.replacement.contentParts
      )
    }
    let cursor = target
    let previous = cursor.parentMessageId ? byId.get(cursor.parentMessageId) : undefined
    // A saved branch starts its own V1 container; its first message has no predecessor.
    while (previous && previous.activeChildId === cursor.messageId && previous.kind === 'summary') {
      cursor = previous
      previous = cursor.parentMessageId ? byId.get(cursor.parentMessageId) : undefined
    }
    if (!previous || previous.activeChildId !== cursor.messageId) return emptyPlan()
    pivotId = previous.messageId
  } else pivotId = operation.pivotId
  const pivot = byId.get(pivotId)
  if (!pivot || pivot.kind === 'summary') return emptyPlan()
  let point = pivot
  while (point.activeChildId && byId.get(point.activeChildId)?.kind === 'summary')
    point = byId.get(point.activeChildId)!
  const children = messages.filter((row) => row.parentMessageId === point.messageId).sort((a, b) => a.seq - b.seq)
  const selected = point.activeChildId
  const hasFork = children.length > 1 || (children.length > 0 && selected === null)
  if (operation.guard) {
    const active = structureActivePath(snapshot)
    const activeIds = new Set(active.map((row) => row.messageId))
    const runtimeIds = operation.guard.activeGenerationMessageIds ?? new Set<string>()
    const controlRows = messages.filter(
      (row) =>
        (row.threadId === snapshot.record.activeThreadId && row.status === 'generating') ||
        runtimeIds.has(row.messageId) ||
        activeIds.has(row.messageId)
    )
    const control = await read(controlRows.map((row) => row.messageId))
    const current = control.filter((message) => activeIds.has(message.id))
    assertSessionActionAllowed(
      operation.guard.action,
      {
        generatingReplyCount: countCancellableGeneratingAssistantMessages(control, runtimeIds),
        anyReplyGenerating: control.some((message) => message.generating === true),
        compactionRunning: operation.guard.compactionRunning ?? false,
        awaitingPauseDecision: hasPendingPauseInteraction(current),
      },
      { sessionMode: resolveSessionMode(snapshot.record.settings?.agentMode?.value) }
    )
  }
  const removedIds = new Set<string>()
  let forkCreatedAt = { ...snapshot.record.forkCreatedAt }
  if (operation.action === 'fork-switch') {
    if (!hasFork) return emptyPlan()
    const position = selected === null ? children.length : children.findIndex((row) => row.messageId === selected)
    if (
      typeof operation.target === 'number' &&
      (!Number.isInteger(operation.target) ||
        operation.target < 0 ||
        operation.target >= children.length + (selected === null ? 1 : 0) ||
        operation.target === position)
    )
      return emptyPlan()
    const adjustedPosition = Math.min(position, children.length - 1)
    const target =
      typeof operation.target === 'number'
        ? operation.target
        : (adjustedPosition + (operation.target === 'next' ? 1 : -1) + children.length) % children.length
    point.activeChildId = children[target]?.messageId ?? null
    if (children.length === 1) {
      children[0].branchId = null
      delete forkCreatedAt[pivotId]
    }
  } else if (operation.action === 'fork-delete') {
    if (!hasFork) return emptyPlan()
    if (selected) {
      removedIds.add(selected)
      // DFS ordering ensures descendants follow their parent.
      for (const row of [...messages].sort((a, b) => a.seq - b.seq))
        if (row.parentMessageId && removedIds.has(row.parentMessageId)) removedIds.add(row.messageId)
    }
    const position = selected === null ? children.length : children.findIndex((row) => row.messageId === selected)
    const remaining = children.filter((row) => row.messageId !== selected)
    point.activeChildId = remaining[Math.min(position, remaining.length - 1)]?.messageId ?? null
    messages = messages.filter((row) => !removedIds.has(row.messageId))
    for (const id of removedIds) delete forkCreatedAt[id]
    if (remaining.length <= 1) {
      delete forkCreatedAt[pivotId]
      if (remaining[0]) remaining[0].branchId = null
    }
  } else {
    if (!selected) return emptyPlan()
    if (operation.action === 'fork-save-resend' && selected !== operation.targetMessageId) return emptyPlan()
    byId.get(selected)!.branchId = `fork_list_${operation.identity.storedListId}`
    point.activeChildId = null
    forkCreatedAt[pivotId] ??= operation.identity.createdAt
    const inserted =
      operation.action === 'fork-save-resend'
        ? [forkReplacement(operation, payloads.get(operation.targetMessageId)), ...(operation.append ?? [])]
        : (operation.append ?? [])
    let parent = point
    let nextSeq =
      messages.reduce((maximum, row) => (row.threadId === point.threadId ? Math.max(maximum, row.seq) : maximum), -1) +
      1
    for (const [index, message] of inserted.entries()) {
      if (byId.has(message.id)) throw new Error(`Duplicate fork message ${message.id}`)
      const row: MessageRow = {
        sessionId: snapshot.record.id,
        threadId: point.threadId,
        messageId: message.id,
        parentMessageId: parent.messageId,
        activeChildId: null,
        seq: nextSeq++,
        kind: message.isSummary ? 'summary' : 'message',
        status: message.generating ? 'generating' : 'settled',
        createdAt: message.timestamp ?? 0,
        updatedAt: message.timestamp ?? 0,
        branchId: index === 0 ? `fork_list_${operation.identity.newListId}` : null,
        message,
      }
      const { message: payload, ...metadata } = row
      payloads.set(message.id, payload)
      parent.activeChildId = row.messageId
      messages.push(metadata)
      byId.set(row.messageId, metadata)
      upsertMessages.push(row)
      parent = metadata
    }
  }
  const indexed = reindexStructureThreads(
    snapshot.threads.filter((thread) => thread.threadId === point.threadId),
    messages
  )
  const subtreeEnds = indexed.subtreeEnds
  const threads: ThreadRow[] = snapshot.threads.map((thread) =>
    thread.threadId !== point.threadId
      ? thread
      : {
          ...indexed.threads[0],
          compactionPoints: thread.compactionPoints.filter(
            (checkpoint) =>
              !removedIds.has(checkpoint.boundaryMessageId) && !removedIds.has(checkpoint.summaryMessageId)
          ),
        }
  )
  for (const row of upsertMessages) Object.assign(row, byId.get(row.messageId))
  let record = { ...snapshot.record, forkCreatedAt: Object.keys(forkCreatedAt).length ? forkCreatedAt : undefined }
  const activeMessages = await read(
    structureActivePath({ ...snapshot, record, threads, messages }).map((row) => row.messageId)
  )
  const affectedThread = threads.find((thread) => thread.threadId === point.threadId)!
  const oldProjection = snapshot.record.contextReadProjection.threads[point.threadId]
  if (!oldProjection) return null
  const endpoint = <T extends { messageId: string; seq: number; subtreeEnd: number }>(previous: T): T => ({
    ...previous,
    seq: byId.get(previous.messageId)!.seq,
    subtreeEnd: subtreeEnds.get(previous.messageId)!,
  })
  const removedMessages = await read([...removedIds])
  let hasSteeredMessages = oldProjection.hasSteeredMessages || upsertMessages.some((row) => row.message.steered)
  if (hasSteeredMessages && removedMessages.some((message) => message.steered)) {
    hasSteeredMessages = (
      await read(messages.filter((row) => row.threadId === point.threadId).map((row) => row.messageId))
    ).some((message) => message.steered === true)
  }
  const insertedProjection = deriveContextReadProjection([affectedThread], upsertMessages).threads[point.threadId]
  record = {
    ...record,
    contextReadProjection: {
      ...snapshot.record.contextReadProjection,
      threads: {
        ...snapshot.record.contextReadProjection.threads,
        [point.threadId]: {
          ...oldProjection,
          hasSteeredMessages,
          checkpoints: oldProjection.checkpoints
            .filter(
              (checkpoint) =>
                !removedIds.has(checkpoint.boundary.messageId) && !removedIds.has(checkpoint.summary.messageId)
            )
            .map((checkpoint) => ({
              ...checkpoint,
              boundary: endpoint(checkpoint.boundary),
              summary: endpoint(checkpoint.summary),
            })),
          attachments: [
            ...oldProjection.attachments
              .filter((attachment) => !removedIds.has(attachment.owner.messageId))
              .map((attachment) => ({ ...attachment, owner: endpoint(attachment.owner) })),
            ...insertedProjection.attachments.map((attachment) => ({
              ...attachment,
              owner: endpoint(attachment.owner),
            })),
          ].sort((a, b) => a.owner.seq - b.owner.seq),
        },
      },
    },
  }
  const projected = projectStructurePresentation(record, threads, activeMessages)
  const result: SessionStructureResult = {
    applied: true,
    cancelMessageIds: [...removedIds].filter(
      (id) => byId.get(id)?.status === 'generating' || operation.guard?.activeGenerationMessageIds?.has(id)
    ),
  }
  if (operation.action === 'fork-delete') {
    result.removedMessages = removedMessages
    // Ownership transfer is needed only when a removed message owns attachments.
    result.survivingMessages = result.removedMessages.some((message) =>
      message.files?.some((file) => typeof file.sessionAttachmentId === 'number')
    )
      ? await read(messages.map((row) => row.messageId))
      : []
  }
  return { record: projected, threads, messages, upsertMessages, result }
}

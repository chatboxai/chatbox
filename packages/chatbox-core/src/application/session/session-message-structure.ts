import { assertSessionActionAllowed, deriveSessionLockState } from '../../session/action-gates'
import { hasPendingPauseInteraction } from '../../message-approval'
import { countCancellableGeneratingAssistantMessages } from '../../session/generation-state'
import { isActionAvailableInMode, resolveSessionMode } from '../../session/mode-policy'
import type { SessionMessageStructureOperation, SessionStructureResult } from '../../ports/session-structure-command'
import type { SessionStructureSnapshot } from '../../ports/session-row-store'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '../../session/session-tree/types'
import type { Message, Session } from '../../types'
import { getReachableSessionMessages } from '../../session/generation-state'
import { deriveContextReadProjection } from '../../persistence/session-context-read'
import { applyMessageInsert, applyMessageRemoval, MessageAnchorNotFoundError } from './message-tree'
import {
  projectStructurePresentation,
  structureActivePath,
  reindexStructureThreads,
  type StructurePlan,
} from './session-structure-plan'

const unchanged = (): SessionStructureResult => ({ applied: false, cancelMessageIds: [] })

export function applyMessageStructure(session: Session, operation: SessionMessageStructureOperation) {
  if (operation.guard) {
    const target =
      operation.action === 'message-insert-after'
        ? [session.messages, ...(session.threads ?? []).map((thread) => thread.messages)]
            .flat()
            .find((message) => message.id === operation.previousId)
        : undefined
    if (operation.guard.action === 'reply-below') validateReplyTarget(target, session.settings)
    if (
      operation.guard.action !== 'delete-summary' ||
      getReachableSessionMessages(session).find(
        (message) => message.id === (operation.action === 'message-remove' ? operation.messageId : '')
      )?.isSummary
    )
      assertSessionActionAllowed(operation.guard.action, deriveSessionLockState(session, operation.guard), {
        messageGenerating: target?.generating,
        sessionMode: resolveSessionMode(session.settings?.agentMode?.value),
      })
  }
  const next =
    operation.action === 'message-remove'
      ? applyMessageRemoval(session, session.id, operation.messageId, () => operation.replacementPivotId)
      : operation.action === 'message-insert-after'
        ? applyMessageInsert(session, session.id, operation.message, operation.previousId, operation)
        : {
            ...session,
            messages: session.messages.filter((message) => message.role === 'system').slice(0, 1),
            ...(operation.scope === 'all' ? { threads: undefined, threadName: '' } : {}),
            messageForksHash: undefined,
            compactionPoints: undefined,
          }
  const survivors = getReachableSessionMessages(next)
  const ids = new Set(survivors.map((message) => message.id))
  const removed = getReachableSessionMessages(session).filter((message) => !ids.has(message.id))
  return {
    session: next,
    result: {
      applied: next !== session,
      cancelMessageIds: removed.filter((message) => message.generating).map((message) => message.id),
      affectedMessageIds: removed.map((message) => message.id),
      removedMessages: removed,
      survivingMessages: survivors,
    } satisfies SessionStructureResult,
  }
}

function validateReplyTarget(target: Message | undefined, settings: Session['settings']) {
  if (!isActionAvailableInMode('reply-below', resolveSessionMode(settings?.agentMode?.value)))
    throw new Error('Reply Again Below is unavailable in Work Mode')
  if (!target || target.isSummary || target.isForkMarker || (target.role !== 'user' && target.role !== 'system'))
    throw new Error('Message cannot receive a reply below')
}

/** Same-session edits retain payload identity while moving the existing row topology. */
export async function planMessageStructure(
  snapshot: SessionStructureSnapshot,
  operation: SessionMessageStructureOperation,
  readMessages: (ids: string[]) => Promise<MessageRow[]>
): Promise<StructurePlan | null> {
  if (!snapshot.record.presentation || !snapshot.record.contextReadProjection) return null
  let messages = snapshot.messages.map((row) => ({ ...row }))
  let threads = snapshot.threads.map((thread) => ({ ...thread }))
  const byId = new Map(messages.map((row) => [row.messageId, row]))
  const payloads = new Map<string, Message>()
  const read = async (ids: string[]) => {
    for (const row of await readMessages(ids.filter((id) => !payloads.has(id))))
      payloads.set(row.messageId, row.message)
    return ids.map((id) => {
      const message = payloads.get(id)
      if (!message) throw new Error(`Missing message ${id}`)
      return message
    })
  }
  const empty = (): StructurePlan => ({
    record: snapshot.record,
    threads: snapshot.threads,
    messages: snapshot.messages,
    upsertMessages: [],
    result: unchanged(),
  })
  const forkCreatedAt = { ...snapshot.record.forkCreatedAt }
  const upsertMessages: MessageRow[] = []
  const removedIds = new Set<string>()
  const replacementIds = new Map<string, string>()
  const children = (id: string) =>
    messages.filter((row) => row.parentMessageId === id && !removedIds.has(row.messageId)).sort((a, b) => a.seq - b.seq)
  const newRow = (
    message: Message,
    threadId: string,
    parentMessageId: string | null,
    seq: number
  ): MessageRowMetadata => {
    if (byId.has(message.id)) throw new Error('Message identity already exists')
    const row: MessageRow = {
      sessionId: snapshot.record.id,
      threadId,
      messageId: message.id,
      parentMessageId,
      activeChildId: null,
      seq,
      branchId: null,
      kind: message.isSummary ? 'summary' : 'message',
      status: message.generating ? 'generating' : 'settled',
      createdAt: message.timestamp ?? 0,
      updatedAt: message.timestamp ?? 0,
      message,
    }
    upsertMessages.push(row)
    const { message: body, ...metadata } = row
    payloads.set(message.id, body)
    messages.push(metadata)
    byId.set(message.id, metadata)
    return metadata
  }
  const active = threads.find((thread) => thread.threadId === snapshot.record.activeThreadId)!
  if (
    operation.guard &&
    (operation.guard.action !== 'delete-summary' ||
      (operation.action === 'message-remove' && byId.get(operation.messageId)?.kind === 'summary'))
  ) {
    const activeIds = new Set(structureActivePath(snapshot).map((row) => row.messageId))
    const runtimeIds = operation.guard.activeGenerationMessageIds ?? new Set<string>()
    const control = await read(
      messages
        .filter(
          (row) =>
            activeIds.has(row.messageId) ||
            runtimeIds.has(row.messageId) ||
            (row.threadId === active.threadId && row.status === 'generating')
        )
        .map((row) => row.messageId)
    )
    const target =
      operation.action === 'message-insert-after' && byId.has(operation.previousId)
        ? (await read([operation.previousId]))[0]
        : undefined
    if (operation.guard.action === 'reply-below') validateReplyTarget(target, snapshot.record.settings)
    assertSessionActionAllowed(
      operation.guard.action,
      {
        generatingReplyCount: countCancellableGeneratingAssistantMessages(control, runtimeIds),
        anyReplyGenerating: control.some((message) => message.generating === true),
        compactionRunning: operation.guard.compactionRunning ?? false,
        awaitingPauseDecision: hasPendingPauseInteraction(control.filter((message) => activeIds.has(message.id))),
      },
      {
        messageGenerating: target?.generating,
        sessionMode: resolveSessionMode(snapshot.record.settings?.agentMode?.value),
      }
    )
  }
  if (operation.action === 'message-insert-after') {
    const visible = new Set<string>()
    for (const thread of threads) {
      let id = thread.rootMessageId
      while (id) {
        visible.add(id)
        id = byId.get(id)!.activeChildId
      }
    }
    let anchor = visible.has(operation.previousId) ? byId.get(operation.previousId) : undefined
    const existing = byId.get(operation.message.id)
    if (existing) {
      if (
        visible.has(existing.messageId) &&
        (existing.threadId === (anchor?.threadId ?? active.threadId) || (!anchor && operation.requireAnchor))
      )
        return empty()
      throw new Error('Message identity already exists')
    }
    if (!anchor && operation.requireAnchor)
      throw new MessageAnchorNotFoundError(snapshot.record.id, operation.previousId)
    if (!anchor) anchor = active.activeLeafMessageId ? byId.get(active.activeLeafMessageId) : undefined
    while (anchor?.activeChildId && byId.get(anchor.activeChildId)?.kind === 'summary')
      anchor = byId.get(anchor.activeChildId)
    const thread = anchor ? threads.find((thread) => thread.threadId === anchor!.threadId)! : active
    const next = anchor?.activeChildId ? byId.get(anchor.activeChildId) : undefined
    const inserted = newRow(
      operation.message,
      thread.threadId,
      anchor?.messageId ?? null,
      next
        ? next.seq - 0.5
        : Math.max(anchor?.seq ?? -1, ...children(anchor?.messageId ?? '').map((row) => row.seq)) + 0.5
    )
    inserted.activeChildId = next?.messageId ?? null
    if (next) {
      next.parentMessageId = inserted.messageId
      inserted.branchId = next.branchId
      next.branchId = null
    } else if (anchor) {
      let pivot = anchor
      while (pivot.kind === 'summary' && pivot.parentMessageId) pivot = byId.get(pivot.parentMessageId)!
      if (Object.hasOwn(forkCreatedAt, pivot.messageId)) inserted.branchId = `fork_list_empty_${pivot.messageId}`
    }
    if (anchor) anchor.activeChildId = inserted.messageId
    else thread.rootMessageId = inserted.messageId
  } else if (operation.action === 'session-clear') {
    const activePath = structureActivePath(snapshot)
    let system: Message | undefined
    for (let offset = 0; offset < activePath.length && !system; offset += 32)
      system = (await read(activePath.slice(offset, offset + 32).map((row) => row.messageId))).find(
        (message) => message.role === 'system'
      )
    for (const row of messages)
      if ((operation.scope === 'all' || row.threadId === active.threadId) && row.messageId !== system?.id)
        removedIds.add(row.messageId)
    if (operation.scope === 'all') threads = [active]
    active.rootMessageId = system?.id ?? null
    active.compactionPoints = []
    if (operation.scope === 'all') active.name = ''
    if (system) Object.assign(byId.get(system.id)!, { parentMessageId: null, activeChildId: null, branchId: null })
    // Clearing retains archived visible paths in the active-only API.
    if (operation.scope === 'active') {
      const archivedVisible = new Set<string>()
      for (const thread of threads.filter((thread) => thread !== active)) {
        let id = thread.rootMessageId
        while (id) {
          archivedVisible.add(id)
          id = byId.get(id)!.activeChildId
        }
      }
      for (const row of messages)
        if (row.threadId !== active.threadId) {
          if (!archivedVisible.has(row.messageId)) removedIds.add(row.messageId)
          else row.branchId = null
        }
    }
    for (const pivot of Object.keys(forkCreatedAt)) delete forkCreatedAt[pivot]
  } else {
    const target = byId.get(operation.messageId)
    if (!target) return empty()
    const thread = threads.find((thread) => thread.threadId === target.threadId)!
    let point = target
    while (point.activeChildId && byId.get(point.activeChildId)?.kind === 'summary')
      point = byId.get(point.activeChildId)!
    const hasFork = Object.hasOwn(forkCreatedAt, target.messageId)
    const parent = target.parentMessageId ? byId.get(target.parentMessageId) : undefined
    if (hasFork && (!parent || point !== target)) {
      const replacement = newRow(
        { id: operation.replacementPivotId, role: 'system', contentParts: [] },
        target.threadId,
        target.parentMessageId,
        target.seq
      )
      replacementIds.set(target.messageId, replacement.messageId)
      replacement.activeChildId = target.activeChildId
      replacement.branchId = target.branchId
      for (const child of children(target.messageId)) child.parentMessageId = replacement.messageId
      if (parent?.activeChildId === target.messageId) parent.activeChildId = replacement.messageId
      if (thread.rootMessageId === target.messageId) thread.rootMessageId = replacement.messageId
      forkCreatedAt[replacement.messageId] = forkCreatedAt[target.messageId]
      for (const value of threads)
        value.compactionPoints = value.compactionPoints.map((checkpoint) =>
          checkpoint.boundaryMessageId === target.messageId
            ? { ...checkpoint, boundaryMessageId: replacement.messageId }
            : checkpoint
        )
    } else {
      const descendants = children(target.messageId)
      for (const child of descendants) {
        child.parentMessageId = target.parentMessageId
        if (!hasFork && target.kind !== 'summary') child.branchId = target.branchId
      }
      if (parent?.activeChildId === target.messageId) parent.activeChildId = target.activeChildId
      if (thread.rootMessageId === target.messageId) thread.rootMessageId = target.activeChildId
      if (hasFork && parent) {
        let pivot = parent
        while (pivot.kind === 'summary' && pivot.parentMessageId) pivot = byId.get(pivot.parentMessageId)!
        if (!Object.hasOwn(forkCreatedAt, pivot.messageId))
          forkCreatedAt[pivot.messageId] = forkCreatedAt[target.messageId]
      }
    }
    delete forkCreatedAt[target.messageId]
    removedIds.add(target.messageId)
    // Collapse empty alternatives and select the next surviving branch in list order.
    for (const pivotId of Object.keys(forkCreatedAt)) {
      let branchPoint = byId.get(pivotId)
      if (!branchPoint || removedIds.has(pivotId)) {
        delete forkCreatedAt[pivotId]
        continue
      }
      while (branchPoint.activeChildId && byId.get(branchPoint.activeChildId)?.kind === 'summary')
        branchPoint = byId.get(branchPoint.activeChildId)!
      const alternatives = children(branchPoint.messageId)
      if (!branchPoint.activeChildId || removedIds.has(branchPoint.activeChildId))
        branchPoint.activeChildId =
          (alternatives.find((row) => row.seq > target.seq) ?? alternatives.at(-1))?.messageId ?? null
      if (alternatives.length <= 1) {
        delete forkCreatedAt[pivotId]
        if (alternatives[0]) alternatives[0].branchId = null
      }
    }
  }
  messages = messages.filter((row) => !removedIds.has(row.messageId))
  for (const id of removedIds) byId.delete(id)
  const indexed = reindexStructureThreads(threads, messages)
  const ends = indexed.subtreeEnds
  threads = indexed.threads.map((thread) => ({
    ...thread,
    compactionPoints: thread.compactionPoints.filter((point) => !removedIds.has(point.summaryMessageId)),
  }))
  for (const row of upsertMessages) Object.assign(row, byId.get(row.messageId))
  const removedMessages = operation.action === 'session-clear' ? [] : await read([...removedIds])
  const contextThreads = { ...snapshot.record.contextReadProjection.threads }
  for (const id of Object.keys(contextThreads))
    if (!threads.some((thread) => thread.threadId === id)) delete contextThreads[id]
  const inserted = deriveContextReadProjection(threads, upsertMessages)
  const endpoint = <T extends { messageId: string; seq: number; subtreeEnd: number }>(value: T): T => ({
    ...value,
    seq: byId.get(value.messageId)!.seq,
    subtreeEnd: ends.get(value.messageId)!,
  })
  for (const thread of threads) {
    const previous = contextThreads[thread.threadId]
    if (!previous) return null
    const oldThread = snapshot.threads.find((item) => item.threadId === thread.threadId)
    const affected =
      operation.action === 'session-clear' ||
      (operation.action === 'message-remove' &&
        snapshot.messages.find((row) => row.messageId === operation.messageId)?.threadId === thread.threadId) ||
      upsertMessages.some((row) => row.threadId === thread.threadId)
    if (affected && (thread.compactionPoints.length || oldThread?.compactionPoints.length)) {
      const threadRows = messages.filter((row) => row.threadId === thread.threadId)
      await read(threadRows.map((row) => row.messageId))
      contextThreads[thread.threadId] = deriveContextReadProjection(
        [thread],
        threadRows.map((row) => ({ ...row, message: payloads.get(row.messageId)! }))
      ).threads[thread.threadId]
      continue
    }
    const checkpoints = previous.checkpoints
      .map((point) =>
        replacementIds.has(point.boundary.messageId)
          ? { ...point, boundary: { ...point.boundary, messageId: replacementIds.get(point.boundary.messageId)! } }
          : point
      )
      .filter((point) => byId.has(point.boundary.messageId) && byId.has(point.summary.messageId))
      .map((point) => ({ ...point, boundary: endpoint(point.boundary), summary: endpoint(point.summary) }))
    const attachments = [
      ...previous.attachments
        .filter((item) => byId.has(item.owner.messageId))
        .map((item) => ({ ...item, owner: endpoint(item.owner) })),
      ...(inserted.threads[thread.threadId]?.attachments ?? []).map((item) => ({
        ...item,
        owner: endpoint(item.owner),
      })),
    ].sort((a, b) => a.owner.seq - b.owner.seq)
    let hasSteeredMessages =
      previous.hasSteeredMessages ||
      upsertMessages.some((row) => row.threadId === thread.threadId && row.message.steered)
    if (
      hasSteeredMessages &&
      (operation.action === 'session-clear' || removedMessages.some((message) => message.steered))
    )
      hasSteeredMessages = (
        await read(messages.filter((row) => row.threadId === thread.threadId).map((row) => row.messageId))
      ).some((message) => message.steered === true)
    contextThreads[thread.threadId] = {
      ...previous,
      rootMessageId: thread.rootMessageId,
      checkpoints,
      attachments,
      hasSteeredMessages,
    }
  }
  const record = projectStructurePresentation(
    {
      ...snapshot.record,
      forkCreatedAt: Object.keys(forkCreatedAt).length ? forkCreatedAt : undefined,
      contextReadProjection: { ...snapshot.record.contextReadProjection, threads: contextThreads },
    },
    threads,
    await read(structureActivePath({ record: snapshot.record, threads, messages }).map((row) => row.messageId))
  )
  const result: SessionStructureResult = {
    applied: true,
    removedMessages,
    cancelMessageIds: snapshot.messages
      .filter((row) => removedIds.has(row.messageId) && row.status === 'generating')
      .map((row) => row.messageId),
    affectedMessageIds: [...removedIds],
  }
  if (removedMessages.some((message) => message.files?.some((file) => file.sessionAttachmentId)))
    result.survivingMessages = await read(messages.map((row) => row.messageId))
  return { record, threads, messages, upsertMessages, result }
}

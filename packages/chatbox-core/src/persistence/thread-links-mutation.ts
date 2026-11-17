import type { Message } from '../types/session'
import type { SessionRowCommit, SessionRowsDiff, SessionRowMutationResult } from '../ports/session-row-store'
import type { ThreadLinks, ThreadLink } from '../session/thread-links'
import type { MessageRowMetadata, ThreadRow, SessionThreadSummary } from '../session/session-tree/types'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../session/message-facts'

export type ProjectedMessage = ThreadLink
export interface LocalRowMutationAccess {
  oldMessage(id: string): Promise<ProjectedMessage | null>
  message(id: string): Promise<ProjectedMessage | null>
  oldThread(id: string): Promise<ThreadRow | null>
  children(
    threadId: string,
    parentId: string | null,
    after: { siblingOrder: number; messageId: string } | undefined,
    limit: number,
    old?: boolean
  ): Promise<ProjectedMessage[]>
  yieldTask?(): Promise<void>
  oldLinks(threadId: string): Promise<ThreadLinks>
  links(threadId: string): Promise<ThreadLinks>
  childStats(
    threadId: string,
    parentId: string,
    boundary: { siblingOrder: number; messageId: string } | null
  ): Promise<{ count: number; before: number }>
  put(row: ProjectedMessage, message?: Message): Promise<void>
  remove(messageId: string): Promise<void>
  putThread(thread: ThreadRow): Promise<void>
  clearMessages(threadId?: string): Promise<void>
}
interface ThreadState {
  thread: ThreadRow
  summary: SessionThreadSummary
  generatingAssistantCount: number
  old: ThreadRow | null
  cleared?: boolean
  changes: Map<string, { before: ThreadLink | null; after: ThreadLink | null }>
}
function number(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid row order')
  return value
}
/** The access layer stages metadata in bounded batches; only affected thread summaries remain resident. */
export async function applyThreadLinksMutation(
  access: LocalRowMutationAccess,
  diff: SessionRowsDiff,
  commit: SessionRowCommit
): Promise<SessionRowMutationResult> {
  if (commit.record.rowFormatVersion !== 3) throw new Error('Session rows require a format upgrade before editing')
  const states = new Map<string, ThreadState>()
  const deletedThreads = new Set(diff.threads.delete)
  const explicitThreads = new Map(diff.threads.upsert.map((row) => [row.threadId, row]))
  const forks = new Set<string>()
  const publishedIds = new Set([
    ...(diff.messageMetadataUpsert ?? []).map((row) => row.messageId),
    ...diff.messages.upsert.map((row) => row.messageId),
  ])
  const publishedMetadata = new Map<string, MessageRowMetadata>()
  async function state(id: string): Promise<ThreadState> {
    const known = states.get(id)
    if (known) return known
    const old = await access.oldThread(id)
    const thread = explicitThreads.get(id) ?? old
    if (!thread) throw new Error('Mutation thread is missing')
    if (old && (!old.summary || !old.control)) throw new Error('Thread projection is unavailable')
    const next = {
      thread,
      old,
      changes: new Map(),
      summary: { ...(old?.summary ?? emptyThreadSummary()) },
      generatingAssistantCount: old?.control?.generatingAssistantCount ?? 0,
    } satisfies ThreadState
    states.set(id, next)
    return next
  }
  async function put(row: ProjectedMessage, body?: Message) {
    if (row.sessionId !== diff.sessionId) throw new Error('Mutation row belongs to another session')
    number(row.siblingOrder)
    const previous = await access.message(row.messageId)
    if (previous && previous.threadId !== row.threadId) throw new Error('Messages cannot move between threads')
    const target = await state(row.threadId)
    target.changes.set(row.messageId, {
      before: target.changes.get(row.messageId)?.before ?? (await access.oldMessage(row.messageId)),
      after: row,
    })
    await access.put(row, body)
    if (publishedIds.has(row.messageId)) publishedMetadata.set(row.messageId, row)
  }
  async function remove(id: string) {
    const row = await access.message(id)
    if (!row) return
    const target = await state(row.threadId)
    target.changes.set(id, { before: target.changes.get(id)?.before ?? (await access.oldMessage(id)), after: null })
    await access.remove(id)
    publishedMetadata.delete(id)
  }
  async function requireRow(id: string, threadId?: string, old = false) {
    const row = await (old ? access.oldMessage(id) : access.message(id))
    if (!row || (threadId !== undefined && row.threadId !== threadId)) throw new Error('Mutation message is missing')
    return row
  }
  async function refreshFork(id: string) {
    const point = await access.message(id)
    if (!point?.forkPivotId) return
    const pivot = await requireRow(point.forkPivotId, point.threadId)
    const selected = point.activeChildId ? await requireRow(point.activeChildId, point.threadId) : null
    if (selected && selected.parentMessageId !== point.messageId)
      throw new Error('Selected branch has the wrong parent')
    const branchId = selected?.branchId ?? point.pendingBranchId
    if (!branchId) throw new Error('Selected fork identity is missing')
    const stats = await access.childStats(
      point.threadId,
      point.messageId,
      selected
        ? { siblingOrder: selected.siblingOrder, messageId: selected.messageId }
        : { siblingOrder: number(point.pendingBranchOrder!), messageId: point.pendingBranchId! }
    )
    const pendingBefore = Boolean(
      selected && point.pendingBranchId && point.pendingBranchOrder! < selected.siblingOrder
    )
    publishedIds.add(pivot.messageId)
    await put({
      ...pivot,
      fork: {
        pivotId: pivot.messageId,
        branchPointId: point.messageId,
        selectedBranchId: branchId,
        count: stats.count + Number(Boolean(point.pendingBranchId)),
        position: stats.before + Number(pendingBefore),
      },
    })
  }
  await state(commit.record.activeThreadId)
  for (const thread of diff.threads.upsert) await state(thread.threadId)
  for (const row of [...(diff.messageMetadataUpsert ?? []), ...diff.messages.upsert]) {
    const old = await access.oldMessage(row.messageId)
    await state(row.threadId)
    if (old?.forkPivotId || row.forkPivotId) forks.add(row.messageId)
    if (old?.parentMessageId) forks.add(old.parentMessageId)
    if (row.parentMessageId) forks.add(row.parentMessageId)
  }
  for (const id of diff.messages.delete) {
    const row = await access.oldMessage(id)
    if (row?.parentMessageId) forks.add(row.parentMessageId)
  }
  for (const move of diff.reparentChildren ?? []) forks.add(move.newParentMessageId)
  for (const insertion of diff.insertParents ?? []) forks.add(insertion.newParentMessageId)
  if (diff.deleteSessionMessages) {
    await access.clearMessages()
    for (const target of states.values()) target.cleared = true
  } else
    for (const id of diff.deleteThreadMessages ?? []) {
      await access.clearMessages(id)
      if (!deletedThreads.has(id)) (await state(id)).cleared = true
    }
  for (const shift of diff.siblingShifts ?? []) {
    if (!Number.isSafeInteger(shift.delta) || !Number.isSafeInteger(shift.afterSiblingOrder))
      throw new Error('Invalid sibling shift')
    let boundary: { siblingOrder: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(shift.threadId, shift.parentMessageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { siblingOrder: old.siblingOrder, messageId: old.messageId }
        if (old.siblingOrder > shift.afterSiblingOrder) {
          const row = await requireRow(old.messageId)
          await put({ ...row, siblingOrder: number(old.siblingOrder + shift.delta) })
        }
      }
    }
  }
  for (const move of diff.reparentChildren ?? []) {
    const pivot = await requireRow(move.parentMessageId, move.threadId, true)
    if (
      pivot.parentMessageId !== move.newParentMessageId ||
      !diff.messages.delete.includes(pivot.messageId) ||
      !Number.isSafeInteger(move.siblingOrderOffset)
    )
      throw new Error('Invalid pivot collapse')
    let boundary: { siblingOrder: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(move.threadId, move.parentMessageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { siblingOrder: old.siblingOrder, messageId: old.messageId }
        const row = await requireRow(old.messageId)
        await put({
          ...row,
          parentMessageId: move.newParentMessageId,
          siblingOrder: number(old.siblingOrder + move.siblingOrderOffset),
          ...(move.branchId !== undefined ? { branchId: move.branchId } : {}),
        })
      }
    }
  }
  for (const insertion of diff.insertParents ?? []) {
    const parent = await requireRow(insertion.parentMessageId, insertion.threadId, true)
    const next = diff.messages.upsert.find((row) => row.messageId === insertion.newParentMessageId)
    if (
      !next ||
      (await access.oldMessage(next.messageId)) ||
      next.threadId !== parent.threadId ||
      next.parentMessageId !== parent.messageId
    )
      throw new Error('Invalid inserted parent')
    let boundary: { siblingOrder: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(parent.threadId, parent.messageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { siblingOrder: old.siblingOrder, messageId: old.messageId }
        const row = await requireRow(old.messageId)
        await put({ ...row, parentMessageId: next.messageId })
      }
    }
  }
  for (const replacement of diff.replaceMessagePivots ?? []) {
    const pivot = await requireRow(replacement.messageId, replacement.threadId, true)
    const next = diff.messages.upsert.find((row) => row.messageId === replacement.replacementMessageId)
    if (
      !next ||
      (await access.oldMessage(next.messageId)) ||
      !diff.messages.delete.includes(pivot.messageId) ||
      next.threadId !== pivot.threadId ||
      next.parentMessageId !== pivot.parentMessageId ||
      next.siblingOrder !== pivot.siblingOrder ||
      next.branchId !== pivot.branchId
    )
      throw new Error('Invalid replacement pivot')
    let boundary: { siblingOrder: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(pivot.threadId, pivot.messageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { siblingOrder: old.siblingOrder, messageId: old.messageId }
        await put({ ...(await requireRow(old.messageId)), parentMessageId: next.messageId })
      }
    }
  }
  for (const expansion of diff.expandForks ?? []) {
    const point = await requireRow(expansion.branchPointId, expansion.threadId, true)
    let tail = await requireRow(point.messageId)
    async function appendBranch(head: ProjectedMessage) {
      const nested = tail.messageId !== point.messageId && tail.pendingBranchId !== undefined
      await put({
        ...(await requireRow(head.messageId)),
        parentMessageId: tail.messageId,
        branchId: nested ? tail.pendingBranchId! : null,
        siblingOrder: nested ? number(tail.pendingBranchOrder!) : 0,
      })
      await put({ ...tail, activeChildId: head.messageId, pendingBranchId: undefined, pendingBranchOrder: undefined })
      if (nested) await refreshFork(tail.messageId)
      let leaf = await requireRow(head.messageId)
      while (leaf.activeChildId !== null) {
        const child = await requireRow(leaf.activeChildId, leaf.threadId)
        if (child.parentMessageId !== leaf.messageId) throw new Error('Invalid branch path')
        leaf = child
      }
      tail = leaf
    }
    if (point.activeChildId) await appendBranch(await requireRow(point.activeChildId, point.threadId, true))
    let boundary: { siblingOrder: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(point.threadId, point.messageId, boundary, 50, true)
      if (!rows.length) break
      for (const row of rows) {
        boundary = { siblingOrder: row.siblingOrder, messageId: row.messageId }
        if (row.messageId !== point.activeChildId) await appendBranch(row)
      }
    }
    await put({
      ...(await requireRow(point.messageId)),
      pendingBranchId: undefined,
      pendingBranchOrder: undefined,
      forkPivotId: undefined,
    })
  }
  for (const range of diff.deleteSubtrees ?? []) {
    let current = await requireRow(range.rootMessageId, range.threadId, true)
    let phase: 'emit' | 'ascend' = 'emit'
    for (;;) {
      if (phase === 'emit') {
        await remove(current.messageId)
        const [child] = await access.children(range.threadId, current.messageId, undefined, 1, true)
        if (child) {
          current = child
          continue
        }
      }
      if (current.messageId === range.rootMessageId) break
      if (current.parentMessageId === null) throw new Error('Subtree escaped its root')
      const [sibling] = await access.children(
        range.threadId,
        current.parentMessageId,
        { siblingOrder: current.siblingOrder, messageId: current.messageId },
        1,
        true
      )
      if (sibling) {
        current = sibling
        phase = 'emit'
      } else {
        current = await requireRow(current.parentMessageId, range.threadId, true)
        phase = 'ascend'
      }
    }
  }
  for (const row of diff.messageMetadataUpsert ?? []) {
    const old = await requireRow(row.messageId)
    await put({ ...row, facts: old.facts })
  }
  for (const row of diff.messages.upsert) {
    const { message, ...metadata } = row
    await put(
      {
        ...metadata,
        facts: deriveMessageFacts(message),
      },
      message
    )
  }
  for (const id of diff.messages.delete) await remove(id)
  for (const id of forks) await refreshFork(id)
  async function summarizeIncrementally(
    id: string,
    target: ThreadState
  ): Promise<Pick<ThreadRow, 'summary' | 'control' | 'activeLeafMessageId'> | null> {
    if (target.cleared) return null
    const previous = target.old
    const appended = new Set(
      [...target.changes].filter(([, change]) => !change.before && change.after).map(([id]) => id)
    )
    if (
      target.thread.rootMessageId !== (previous?.rootMessageId ?? null) &&
      !(
        (previous?.rootMessageId ?? null) === null &&
        target.thread.rootMessageId &&
        appended.has(target.thread.rootMessageId)
      )
    )
      return null
    const oldLeaf = previous?.activeLeafMessageId ?? null
    for (const { before, after } of target.changes.values()) {
      if (!after) return null
      if (!before) continue
      if (
        before.parentMessageId !== after.parentMessageId ||
        before.kind !== after.kind ||
        before.facts.role !== after.facts.role ||
        before.facts.autoTitleEligible !== after.facts.autoTitleEligible ||
        before.facts.isForkMarker !== after.facts.isForkMarker
      )
        return null
      if (
        before.activeChildId !== after.activeChildId &&
        !(
          before.messageId === oldLeaf &&
          before.activeChildId === null &&
          after.activeChildId &&
          appended.has(after.activeChildId)
        )
      )
        return null
    }
    const summary = { ...target.summary }
    let generatingAssistantCount = target.generatingAssistantCount
    const oldGraph = target.changes.size ? await access.oldLinks(id) : null
    const counts = [
      'messageCount',
      'userMessageCount',
      'assistantMessageCount',
      'fileMessageCount',
      'generatingMessageCount',
      'pausedMessageCount',
      'webSearchSignInErrorCount',
      'legacyCommandMessageCount',
      'steeredMessageCount',
    ] as const
    for (const { before, after } of target.changes.values()) {
      if (before)
        generatingAssistantCount -= Number(before.status === 'generating' && before.facts.role === 'assistant')
      if (after) generatingAssistantCount += Number(after.status === 'generating' && after.facts.role === 'assistant')
      if (before && oldGraph!.isOnPath(before.messageId, previous?.rootMessageId ?? null)) {
        const oldFacts = addSummaryRow(emptyThreadSummary(), before),
          newFacts = addSummaryRow(emptyThreadSummary(), after!)
        for (const key of counts) summary[key] += newFacts[key] - oldFacts[key]
      }
    }
    let parent = oldLeaf
    let cursor = oldLeaf ? (target.changes.get(oldLeaf)?.after?.activeChildId ?? null) : target.thread.rootMessageId
    const seen = new Set<string>()
    while (cursor !== null) {
      if (!appended.has(cursor) || seen.has(cursor)) return null
      seen.add(cursor)
      const row = await access.message(cursor)
      if (!row || row.parentMessageId !== parent) return null
      Object.assign(summary, addSummaryRow(summary, row))
      parent = cursor
      cursor = row.activeChildId
    }
    return { summary, control: { generatingAssistantCount }, activeLeafMessageId: parent }
  }
  for (const [id, target] of states) {
    if (deletedThreads.has(id) || (diff.deleteArchivedThreads && id !== commit.record.activeThreadId)) continue
    const incremental = await summarizeIncrementally(id, target)
    const summary =
      incremental ?? (await (await access.links(id)).summarize(target.thread.rootMessageId, access.yieldTask))
    target.thread = { ...target.thread, ...summary }
    await access.putThread(target.thread)
  }
  return {
    ...commit,
    messageMetadata: [...publishedMetadata.values()],
    threads: [...states.values()]
      .map((entry) => entry.thread)
      .filter(
        (thread) =>
          !deletedThreads.has(thread.threadId) &&
          (!diff.deleteArchivedThreads || thread.threadId === commit.record.activeThreadId)
      ),
  }
}

import type { Message } from '../types/session'
import type { SessionRowCommit, SessionRowsDiff, SessionRowMutationResult } from '../ports/session-row-store'
import type { SessionKnownMessageMetadata } from '../ports/session-row-relations'
import type { MessageRowMetadata, ThreadRow, SessionThreadSummary } from '../session/session-tree/types'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../session/message-facts'

export type ProjectedMessage = SessionKnownMessageMetadata & { selectedDepth: number | null }
export interface LocalRowMutationAccess {
  oldMessage(id: string): Promise<ProjectedMessage | null>
  message(id: string): Promise<ProjectedMessage | null>
  oldThread(id: string): Promise<ThreadRow | null>
  children(
    threadId: string,
    parentId: string | null,
    after: { seq: number; messageId: string } | undefined,
    limit: number,
    old?: boolean
  ): Promise<ProjectedMessage[]>
  selected(
    threadId: string,
    options: {
      afterDepth?: number
      beforeDepth?: number
      reverse?: boolean
      role?: string
      conversation?: true
      namingRole?: 'user' | 'assistant'
      kind?: string
      limit: number
      old?: boolean
    }
  ): Promise<ProjectedMessage[]>
  childStats(
    threadId: string,
    parentId: string,
    boundary: { seq: number; messageId: string } | null
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
  start?: number
  endpoints?: boolean
}
function number(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid row order')
  return value
}
function contribution(row: ProjectedMessage) {
  return addSummaryRow(emptyThreadSummary(), row)
}
const COUNTS = [
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
function accumulate(summary: SessionThreadSummary, row: ProjectedMessage, sign: 1 | -1) {
  const delta = contribution(row)
  for (const key of COUNTS) summary[key] += sign * delta[key]
}
const generating = (row: ProjectedMessage) => Number(row.status === 'generating' && row.facts.role === 'assistant')

/** The access layer stages metadata in bounded batches; only affected thread summaries remain resident. */
export async function applyLocalRowMutation(
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
      summary: { ...(old?.summary ?? emptyThreadSummary()) },
      generatingAssistantCount: old?.control?.generatingAssistantCount ?? 0,
    } satisfies ThreadState
    states.set(id, next)
    return next
  }
  async function start(threadId: string, depth: number) {
    const target = await state(threadId)
    target.start = Math.min(target.start ?? Infinity, number(depth))
  }
  async function put(row: ProjectedMessage, body?: Message) {
    if (row.sessionId !== diff.sessionId) throw new Error('Mutation row belongs to another session')
    number(row.seq)
    const previous = await access.message(row.messageId)
    const target = await state(row.threadId)
    if (previous) {
      if (previous.threadId !== row.threadId) throw new Error('Messages cannot move between threads')
      if (previous.selected) accumulate(target.summary, previous, -1)
      target.generatingAssistantCount -= generating(previous)
    }
    if (
      (previous?.selected || row.selectedDepth !== null) &&
      (previous?.selectedDepth !== row.selectedDepth ||
        previous?.facts.role !== row.facts.role ||
        previous?.kind !== row.kind ||
        previous?.facts.isForkMarker !== row.facts.isForkMarker ||
        previous?.facts.autoTitleEligible !== row.facts.autoTitleEligible)
    )
      target.endpoints = true
    row = { ...row, selected: row.selectedDepth !== null }
    if (row.selected) accumulate(target.summary, row, 1)
    target.generatingAssistantCount += generating(row)
    await access.put(row, body)
    if (publishedIds.has(row.messageId)) {
      const { selectedDepth, ...metadata } = row
      publishedMetadata.set(row.messageId, metadata)
    }
  }
  async function remove(id: string) {
    const row = await access.message(id)
    if (!row) return
    const target = await state(row.threadId)
    if (row.selected) {
      accumulate(target.summary, row, -1)
      target.endpoints = true
    }
    target.generatingAssistantCount -= generating(row)
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
        ? { seq: selected.seq, messageId: selected.messageId }
        : { seq: number(point.pendingBranchSeq!), messageId: point.pendingBranchId! }
    )
    const pendingBefore = Boolean(selected && point.pendingBranchId && point.pendingBranchSeq! < selected.seq)
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
  for (const thread of diff.threads.upsert) {
    const old = await access.oldThread(thread.threadId)
    await state(thread.threadId)
    if (!old || old.rootMessageId !== thread.rootMessageId) await start(thread.threadId, 0)
  }
  const points = [...(diff.messageMetadataUpsert ?? []), ...diff.messages.upsert]
  for (const row of points) {
    const old = await access.oldMessage(row.messageId)
    await state(row.threadId)
    if (old?.selected && (old.parentMessageId !== row.parentMessageId || old.activeChildId !== row.activeChildId))
      await start(row.threadId, old.selectedDepth! + Number(old.parentMessageId === row.parentMessageId))
    if (
      (old?.forkPivotId || row.forkPivotId) &&
      (!old ||
        old.forkPivotId !== row.forkPivotId ||
        old.activeChildId !== row.activeChildId ||
        old.pendingBranchId !== row.pendingBranchId ||
        old.pendingBranchSeq !== row.pendingBranchSeq)
    )
      forks.add(row.messageId)
    if (!old || old.parentMessageId !== row.parentMessageId || old.seq !== row.seq || old.branchId !== row.branchId) {
      if (old?.parentMessageId) forks.add(old.parentMessageId)
      if (row.parentMessageId) forks.add(row.parentMessageId)
    }
  }
  for (const id of diff.messages.delete) {
    const row = await access.oldMessage(id)
    if (row?.selected) await start(row.threadId, row.selectedDepth!)
    if (row?.parentMessageId) forks.add(row.parentMessageId)
  }
  for (const range of diff.deleteSubtrees ?? []) {
    const row = await requireRow(range.rootMessageId, range.threadId, true)
    if (row.selected) await start(row.threadId, row.selectedDepth!)
    if (row.parentMessageId) forks.add(row.parentMessageId)
  }
  for (const range of diff.expandForks ?? []) {
    const row = await requireRow(range.branchPointId, range.threadId, true)
    if (row.selected) await start(row.threadId, row.selectedDepth! + 1)
  }
  for (const range of diff.reparentChildren ?? []) {
    const row = await requireRow(range.parentMessageId, range.threadId, true)
    if (row.selected) await start(row.threadId, row.selectedDepth!)
    forks.add(range.newParentMessageId)
  }
  for (const insertion of diff.insertParents ?? []) {
    const row = await requireRow(insertion.parentMessageId, insertion.threadId, true)
    if (row.selected) await start(row.threadId, row.selectedDepth! + 1)
    forks.add(insertion.newParentMessageId)
  }
  for (const replacement of diff.replaceMessagePivots ?? []) {
    const row = await requireRow(replacement.messageId, replacement.threadId, true)
    if (row.selected) await start(row.threadId, row.selectedDepth!)
  }
  if (diff.deleteSessionMessages) {
    await access.clearMessages()
    for (const target of states.values()) {
      target.summary = emptyThreadSummary()
      target.generatingAssistantCount = 0
      target.start = 0
    }
  } else {
    for (const id of diff.deleteThreadMessages ?? []) {
      await access.clearMessages(id)
      if (!deletedThreads.has(id)) {
        const target = await state(id)
        target.summary = emptyThreadSummary()
        target.generatingAssistantCount = 0
        target.start = 0
      }
    }
    for (const [id, target] of states) {
      if (target.start === undefined || deletedThreads.has(id) || diff.deleteThreadMessages?.includes(id)) continue
      let after = target.start - 1
      for (;;) {
        const rows = await access.selected(id, { afterDepth: after, limit: 50, old: true })
        if (!rows.length) break
        for (const row of rows) {
          after = row.selectedDepth!
          await put({ ...row, selected: false, selectedDepth: null })
        }
      }
    }
  }
  for (const shift of diff.siblingShifts ?? []) {
    if (!Number.isSafeInteger(shift.delta) || !Number.isSafeInteger(shift.afterSeq))
      throw new Error('Invalid sibling shift')
    let boundary: { seq: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(shift.threadId, shift.parentMessageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { seq: old.seq, messageId: old.messageId }
        if (old.seq > shift.afterSeq) {
          const row = await requireRow(old.messageId)
          await put({ ...row, seq: number(old.seq + shift.delta) })
        }
      }
    }
  }
  for (const move of diff.reparentChildren ?? []) {
    const pivot = await requireRow(move.parentMessageId, move.threadId, true)
    if (
      pivot.parentMessageId !== move.newParentMessageId ||
      !diff.messages.delete.includes(pivot.messageId) ||
      !Number.isSafeInteger(move.seqOffset)
    )
      throw new Error('Invalid pivot collapse')
    let boundary: { seq: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(move.threadId, move.parentMessageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { seq: old.seq, messageId: old.messageId }
        const row = await requireRow(old.messageId)
        await put({
          ...row,
          parentMessageId: move.newParentMessageId,
          seq: number(old.seq + move.seqOffset),
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
    let boundary: { seq: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(parent.threadId, parent.messageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { seq: old.seq, messageId: old.messageId }
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
      next.seq !== pivot.seq ||
      next.branchId !== pivot.branchId
    )
      throw new Error('Invalid replacement pivot')
    let boundary: { seq: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(pivot.threadId, pivot.messageId, boundary, 50, true)
      if (!rows.length) break
      for (const old of rows) {
        boundary = { seq: old.seq, messageId: old.messageId }
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
        seq: nested ? number(tail.pendingBranchSeq!) : 0,
      })
      await put({ ...tail, activeChildId: head.messageId, pendingBranchId: undefined, pendingBranchSeq: undefined })
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
    let boundary: { seq: number; messageId: string } | undefined
    for (;;) {
      const rows = await access.children(point.threadId, point.messageId, boundary, 50, true)
      if (!rows.length) break
      for (const row of rows) {
        boundary = { seq: row.seq, messageId: row.messageId }
        if (row.messageId !== point.activeChildId) await appendBranch(row)
      }
    }
    await put({
      ...(await requireRow(point.messageId)),
      pendingBranchId: undefined,
      pendingBranchSeq: undefined,
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
        { seq: current.seq, messageId: current.messageId },
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
    await put({ ...row, facts: old.facts, selected: old.selected, selectedDepth: old.selectedDepth })
  }
  for (const row of diff.messages.upsert) {
    const old = await access.message(row.messageId)
    const { message, ...metadata } = row
    await put(
      {
        ...metadata,
        facts: deriveMessageFacts(message),
        selected: old?.selected ?? false,
        selectedDepth: old?.selectedDepth ?? null,
      },
      message
    )
  }
  for (const id of diff.messages.delete) await remove(id)
  for (const [id, target] of states) {
    if (deletedThreads.has(id) || (diff.deleteArchivedThreads && id !== commit.record.activeThreadId)) continue
    if (target.start !== undefined) {
      const [prefix] = await access.selected(id, { beforeDepth: target.start, reverse: true, limit: 1 })
      let parent = prefix?.messageId ?? null
      let cursor = prefix ? prefix.activeChildId : target.thread.rootMessageId
      let depth = target.start
      while (cursor !== null) {
        const row = await requireRow(cursor, id)
        if (row.parentMessageId !== parent) throw new Error('Invalid selected path')
        await put({ ...row, selected: true, selectedDepth: number(depth++) })
        parent = cursor
        cursor = row.activeChildId
      }
    }
    let activeLeafMessageId = target.thread.activeLeafMessageId
    if (target.start !== undefined || target.endpoints) {
      const [last, user, nonSummary, summary, system, conversation, namingUser, namingAssistant] = await Promise.all([
        access.selected(id, { reverse: true, limit: 1 }),
        access.selected(id, { reverse: true, role: 'user', limit: 1 }),
        access.selected(id, { reverse: true, kind: 'message', limit: 1 }),
        access.selected(id, { reverse: true, kind: 'summary', limit: 1 }),
        access.selected(id, { role: 'system', limit: 1 }),
        access.selected(id, { conversation: true, reverse: true, limit: 1 }),
        access.selected(id, { namingRole: 'user', limit: 1 }),
        access.selected(id, { namingRole: 'assistant', reverse: true, limit: 1 }),
      ])
      target.summary.firstNamingUserMessageId = namingUser[0]?.messageId
      target.summary.lastNamingAssistantMessageId = namingAssistant[0]?.messageId
      target.summary.hasAutoTitleContent = Boolean(
        namingUser[0] && namingAssistant[0] && namingUser[0].selectedDepth! < namingAssistant[0].selectedDepth!
      )
      target.summary.lastConversationMessageId = conversation[0]?.messageId
      target.summary.lastUserMessageId = user[0]?.messageId
      target.summary.lastNonSummaryMessageId = nonSummary[0]?.messageId
      target.summary.lastSummaryMessageId = summary[0]?.messageId
      target.summary.firstSystemMessageId = system[0]?.messageId
      activeLeafMessageId = last[0]?.messageId ?? null
    }
    for (const key of COUNTS) number(target.summary[key])
    number(target.generatingAssistantCount)
    target.thread = {
      ...target.thread,
      activeLeafMessageId,
      summary: target.summary,
      control: { generatingAssistantCount: target.generatingAssistantCount },
    }
    await access.putThread(target.thread)
  }
  for (const id of forks) await refreshFork(id)
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

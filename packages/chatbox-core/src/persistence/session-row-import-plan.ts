import type { SessionRowCommit } from '../ports/session-row-store'
import type { SessionRowImportIssueHandler, SessionRowImportPreparation } from '../ports/session-row-transfer'
import { addSummaryRow, emptyThreadSummary } from '../session/message-facts'
import type { MessageRow, MessageRowMetadata, ThreadRow } from '../session/session-tree/types'

export interface SessionImportMessage {
  value: MessageRowMetadata
  pathDepth: number | null
}
export interface SessionImportIndex {
  threads: Map<string, ThreadRow>
  messages: Map<string, SessionImportMessage>
}
interface SessionImportPlanOptions {
  sqlite?: boolean
  reservedThreadId?: string
}
const childrenKey = (thread: string, parent: string | null) => JSON.stringify([thread, parent])
const compareStorageIds = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
// SQLite BINARY sorts UTF-8 IDs by code point, including supplementary characters.
function compareSqlIds(left: string, right: string): number {
  let a = 0,
    b = 0
  while (a < left.length && b < right.length) {
    const first = left.codePointAt(a)!,
      second = right.codePointAt(b)!
    if (first !== second) return first - second
    a += first > 0xffff ? 2 : 1
    b += second > 0xffff ? 2 : 1
  }
  return left.length - a - (right.length - b)
}

export function prepareImportIndex(
  index: SessionImportIndex,
  commit: SessionRowCommit,
  onIssue?: SessionRowImportIssueHandler,
  forks?: ReadonlyMap<string, NonNullable<MessageRow['fork']>>,
  options: SessionImportPlanOptions = {}
): SessionRowImportPreparation {
  const { messages, threads } = index
  const compareIds = options.sqlite ? compareSqlIds : compareStorageIds
  const sessionId = commit.record.id
  const orderedMessages = [...messages.values()].sort((a, b) => compareIds(a.value.messageId, b.value.messageId))
  const children = new Map<string, SessionImportMessage[]>()
  const populatedThreads = new Set<string>()
  for (const entry of orderedMessages) {
    populatedThreads.add(entry.value.threadId)
    const key = childrenKey(entry.value.threadId, entry.value.parentMessageId)
    const siblings = children.get(key)
    if (siblings) siblings.push(entry)
    else children.set(key, [entry])
  }
  for (const siblings of children.values())
    siblings.sort(
      (a, b) => a.value.siblingOrder - b.value.siblingOrder || compareIds(a.value.messageId, b.value.messageId)
    )
  const getChildren = (threadId: string, parent: string | null) => children.get(childrenKey(threadId, parent)) ?? []
  let canReuseForks = forks !== undefined
  const report = (
    entity: 'message' | 'thread' | 'session',
    rowId: string,
    reason: string,
    action: 'skipped' | 'repaired' = 'repaired'
  ) => {
    canReuseForks = false
    onIssue?.({ entity, id: rowId, reason, action })
  }
  const originalMessages = messages.size
  let active = threads.get(commit.record.activeThreadId)
  if (!active) {
    active = [...threads.values()].sort(
      (a, b) => (options.sqlite ? a.threadOrder - b.threadOrder : 0) || compareIds(a.threadId, b.threadId)
    )[0]
    if (active) commit.record.activeThreadId = active.threadId
    else {
      if (commit.record.activeThreadId === options.reservedThreadId)
        commit.record.activeThreadId = 'import-thread:' + sessionId
      active = {
        sessionId,
        threadId: commit.record.activeThreadId,
        threadOrder: -1,
        name: null,
        createdAt: 0,
        rootMessageId: null,
        activeLeafMessageId: null,
        compactionPoints: [],
      }
      threads.set(active.threadId, active)
    }
    report('session', sessionId, 'missing-active-thread')
  }
  const activeId = active.threadId
  const orderedThreads = [...threads.values()].sort((a, b) => compareIds(a.threadId, b.threadId))
  const threadOrder = new Set<number>()
  let reorder = false
  for (const thread of orderedThreads) {
    if ((thread.threadId === activeId) !== (thread.threadOrder === -1) || threadOrder.has(thread.threadOrder))
      reorder = true
    threadOrder.add(thread.threadOrder)
  }
  let sequence = 0
  for (const thread of orderedThreads) {
    if (reorder) {
      const siblingOrder = thread.threadId === activeId ? -1 : sequence++
      if (siblingOrder !== thread.threadOrder) {
        thread.threadOrder = siblingOrder
        if (siblingOrder !== -1 && thread.name === null) thread.name = ''
        report('thread', thread.threadId, 'thread-order')
      }
    }
    const root = thread.rootMessageId === null ? undefined : messages.get(thread.rootMessageId)?.value
    if (!root || root.threadId !== thread.threadId || root.parentMessageId !== null) {
      const roots = getChildren(thread.threadId, null)
      const next = roots.length === 1 ? roots[0].value.messageId : null
      const hasMessages = populatedThreads.has(thread.threadId)
      if (
        options.sqlite
          ? thread.rootMessageId !== null || hasMessages
          : thread.rootMessageId !== next || roots.length > 1
      )
        report('thread', thread.threadId, 'thread-root')
      thread.rootMessageId = next
    }
  }
  const invalid = new Map<string, boolean>()
  for (const entry of orderedMessages) {
    if (invalid.has(entry.value.messageId)) continue
    const path = new Set<string>()
    let current: SessionImportMessage | undefined = entry
    let broken = false
    while (current) {
      const row = current.value
      if (invalid.has(row.messageId)) {
        broken = invalid.get(row.messageId)!
        break
      }
      if (path.has(row.messageId)) {
        broken = true
        break
      }
      path.add(row.messageId)
      const thread = threads.get(row.threadId)
      if (!thread) {
        broken = true
        break
      }
      if (row.parentMessageId === null) {
        broken = thread.rootMessageId !== row.messageId
        break
      }
      const parent = messages.get(row.parentMessageId)
      if (!parent || parent.value.threadId !== row.threadId) {
        broken = true
        break
      }
      current = parent
    }
    for (const id of path) invalid.set(id, broken)
  }
  for (const entry of orderedMessages) {
    if (!invalid.get(entry.value.messageId)) continue
    messages.delete(entry.value.messageId)
    report('message', entry.value.messageId, 'unreachable-message', 'skipped')
  }
  for (const [key, siblings] of children)
    children.set(
      key,
      siblings.filter((entry) => messages.has(entry.value.messageId))
    )
  for (const entry of orderedMessages) {
    if (!messages.has(entry.value.messageId)) continue
    const siblings = getChildren(entry.value.threadId, entry.value.messageId)
    if (
      !siblings.some(
        (child, position) => position > 0 && child.value.siblingOrder === siblings[position - 1].value.siblingOrder
      )
    )
      continue
    const counts = new Map<number, number>()
    if (options.sqlite)
      for (const child of siblings)
        counts.set(child.value.siblingOrder, (counts.get(child.value.siblingOrder) ?? 0) + 1)
    for (const [siblingOrder, child] of siblings.entries()) {
      if (options.sqlite ? counts.get(child.value.siblingOrder)! > 1 : child.value.siblingOrder !== siblingOrder)
        report('message', child.value.messageId, 'sibling-order')
      child.value.siblingOrder = siblingOrder
    }
  }
  for (const entry of orderedMessages) {
    const row = entry.value
    if (!messages.has(row.messageId)) continue
    if (row.activeChildId !== null) {
      const child = messages.get(row.activeChildId)?.value
      if (!child || child.threadId !== row.threadId || child.parentMessageId !== row.messageId) {
        row.activeChildId = null
        report('message', row.messageId, 'selected-child')
      }
    }
    if (row.pendingBranchId !== undefined || row.pendingBranchOrder !== undefined) {
      const collision = getChildren(row.threadId, row.messageId).some(
        (child) => child.value.siblingOrder === row.pendingBranchOrder
      )
      if (
        !row.pendingBranchId ||
        row.activeChildId !== null ||
        row.pendingBranchOrder === undefined ||
        !Number.isSafeInteger(row.pendingBranchOrder) ||
        row.pendingBranchOrder < 0 ||
        collision
      ) {
        delete row.pendingBranchId
        delete row.pendingBranchOrder
        report('message', row.messageId, 'pending-branch')
      }
    }
    if (options.sqlite ? row.forkPivotId != null : Boolean(row.forkPivotId)) {
      const pivot = messages.get(row.forkPivotId!)?.value
      const selected = row.activeChildId === null ? undefined : messages.get(row.activeChildId)?.value
      const branchId = selected?.branchId ?? row.pendingBranchId
      if (!pivot || pivot.threadId !== row.threadId || !branchId) {
        delete row.forkPivotId
        report('message', row.messageId, 'fork-reference')
      }
    }
  }
  const repairCompaction = (thread: ThreadRow) => {
    let invalidCompaction = false
    thread.compactionPoints = thread.compactionPoints.filter((point) => {
      const boundary = messages.get(point.boundaryMessageId)?.value
      const summaryRow = messages.get(point.summaryMessageId)?.value
      if (
        boundary?.threadId === thread.threadId &&
        summaryRow?.threadId === thread.threadId &&
        summaryRow.kind === 'summary'
      )
        return true
      if (!options.sqlite || !invalidCompaction) report('thread', thread.threadId, 'compaction-reference')
      invalidCompaction = true
      return false
    })
  }
  if (options.sqlite) for (const thread of orderedThreads) repairCompaction(thread)
  if (canReuseForks && forks) {
    for (const [pivotId, fork] of forks) {
      const pivot = messages.get(pivotId)
      if (!pivot) throw new Error('Imported fork pivot is missing')
      pivot.value.fork = structuredClone(fork)
    }
  } else {
    for (const entry of orderedMessages) {
      const row = entry.value
      if (!messages.has(row.messageId) || !row.forkPivotId) continue
      const pivot = messages.get(row.forkPivotId)
      const selected = row.activeChildId === null ? undefined : messages.get(row.activeChildId)?.value
      const branchId = selected?.branchId ?? row.pendingBranchId
      if (!pivot || !branchId || (options.sqlite && pivot.value.fork)) continue
      const siblings = getChildren(row.threadId, row.messageId)
      const boundary = selected?.siblingOrder ?? row.pendingBranchOrder!
      pivot.value.fork = {
        pivotId: pivot.value.messageId,
        branchPointId: row.messageId,
        selectedBranchId: branchId,
        count: siblings.length + Number(Boolean(row.pendingBranchId)),
        position: siblings.filter((child) => child.value.siblingOrder < boundary).length,
      }
    }
  }
  for (const thread of orderedThreads) {
    let summary = emptyThreadSummary()
    let next = thread.rootMessageId
    let parent: string | null = null
    let depth = 0
    while (next !== null) {
      const message = messages.get(next)
      if (
        !message ||
        message.value.threadId !== thread.threadId ||
        message.value.parentMessageId !== parent ||
        depth > originalMessages
      )
        throw new Error('Prepared selected path is inconsistent')
      message.pathDepth = depth++
      message.value.selected = true
      if (!message.value.facts) throw new Error('Imported message facts are missing')
      summary = addSummaryRow(summary, { ...message.value, facts: message.value.facts })
      parent = next
      next = message.value.activeChildId
    }
    if (!options.sqlite) repairCompaction(thread)
    thread.activeLeafMessageId = parent
    thread.summary = summary
    thread.control = { generatingAssistantCount: 0 }
  }
  return {
    messageCount: messages.size,
    threadCount: threads.size,
    skipSession: originalMessages > 0 && messages.size === 0,
  }
}

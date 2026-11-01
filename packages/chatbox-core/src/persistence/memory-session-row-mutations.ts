import type { SessionRowsDiff } from '../ports/session-row-store'
import { addSummaryRow, deriveMessageFacts, emptyThreadSummary } from '../session/message-facts'
import type { MessageRow, ThreadRow } from '../session/session-tree/types'

function rank(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid sibling rank')
  return value
}
function sorted(rows: Iterable<MessageRow>) {
  return [...rows].sort(
    (a, b) => a.siblingOrder - b.siblingOrder || (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0)
  )
}

/** Reference implementation applies ranges to the old committed relationships before explicit point writes. */
export function applyMemoryRanges(
  messages: Map<string, MessageRow>,
  threads: Map<string, ThreadRow>,
  diff: SessionRowsDiff,
  activeThreadId: string
): void {
  const old = new Map(messages)
  const childIndex = new Map<string, MessageRow[]>()
  for (const row of old.values()) {
    const key = JSON.stringify([row.threadId, row.parentMessageId])
    const rows = childIndex.get(key) ?? []
    rows.push(row)
    childIndex.set(key, rows)
  }
  const children = (threadId: string, parentId: string | null) =>
    sorted(childIndex.get(JSON.stringify([threadId, parentId])) ?? [])
  const requireRow = (id: string, threadId: string) => {
    const row = old.get(id)
    if (!row || row.threadId !== threadId) throw new Error('Range target is missing')
    return row
  }
  const change = (row: MessageRow, patch: Partial<MessageRow>) =>
    messages.set(row.messageId, { ...(messages.get(row.messageId) ?? row), ...patch })
  for (const shift of diff.siblingShifts ?? []) {
    if (!Number.isSafeInteger(shift.delta) || !Number.isSafeInteger(shift.afterSiblingOrder))
      throw new Error('Invalid sibling shift')
    if (shift.parentMessageId !== null) requireRow(shift.parentMessageId, shift.threadId)
    for (const row of children(shift.threadId, shift.parentMessageId))
      if (row.siblingOrder > shift.afterSiblingOrder)
        change(row, { siblingOrder: rank(row.siblingOrder + shift.delta) })
  }
  for (const move of diff.reparentChildren ?? []) {
    const pivot = requireRow(move.parentMessageId, move.threadId)
    requireRow(move.newParentMessageId, move.threadId)
    if (
      pivot.parentMessageId !== move.newParentMessageId ||
      !diff.messages.delete.includes(pivot.messageId) ||
      !Number.isSafeInteger(move.siblingOrderOffset)
    )
      throw new Error('Invalid pivot collapse')
    for (const row of children(move.threadId, move.parentMessageId))
      change(row, {
        parentMessageId: move.newParentMessageId,
        siblingOrder: rank(row.siblingOrder + move.siblingOrderOffset),
        ...(move.branchId !== undefined ? { branchId: move.branchId } : {}),
      })
  }
  for (const insertion of diff.insertParents ?? []) {
    const parent = requireRow(insertion.parentMessageId, insertion.threadId)
    const next = diff.messages.upsert.find((row) => row.messageId === insertion.newParentMessageId)
    if (
      !next ||
      old.has(next.messageId) ||
      next.threadId !== parent.threadId ||
      next.parentMessageId !== parent.messageId
    )
      throw new Error('Invalid inserted parent')
    for (const row of children(parent.threadId, parent.messageId)) change(row, { parentMessageId: next.messageId })
  }
  for (const replacement of diff.replaceMessagePivots ?? []) {
    const pivot = requireRow(replacement.messageId, replacement.threadId)
    const next = diff.messages.upsert.find((row) => row.messageId === replacement.replacementMessageId)
    if (
      !next ||
      old.has(next.messageId) ||
      !diff.messages.delete.includes(pivot.messageId) ||
      next.threadId !== pivot.threadId ||
      next.parentMessageId !== pivot.parentMessageId ||
      next.siblingOrder !== pivot.siblingOrder ||
      next.branchId !== pivot.branchId
    )
      throw new Error('Invalid replacement pivot')
    for (const row of children(pivot.threadId, pivot.messageId)) change(row, { parentMessageId: next.messageId })
  }
  for (const expansion of diff.expandForks ?? []) {
    const point = requireRow(expansion.branchPointId, expansion.threadId)
    const branches = children(point.threadId, point.messageId)
    const ordered = [
      ...branches.filter((row) => row.messageId === point.activeChildId),
      ...branches.filter((row) => row.messageId !== point.activeChildId),
    ]
    let tail = point
    for (const head of ordered) {
      const nested = tail.messageId !== point.messageId && tail.pendingBranchId !== undefined
      change(head, {
        parentMessageId: tail.messageId,
        branchId: nested ? tail.pendingBranchId! : null,
        siblingOrder: nested ? rank(tail.pendingBranchOrder!) : 0,
      })
      change(tail, { activeChildId: head.messageId, pendingBranchId: undefined, pendingBranchOrder: undefined })
      let leaf = head
      const seen = new Set<string>()
      while (leaf.activeChildId !== null) {
        if (seen.has(leaf.messageId)) throw new Error('Cyclic branch path')
        seen.add(leaf.messageId)
        const child = requireRow(leaf.activeChildId, leaf.threadId)
        if (child.parentMessageId !== leaf.messageId) throw new Error('Invalid branch path')
        leaf = child
      }
      tail = leaf
    }
    change(point, { pendingBranchId: undefined, pendingBranchOrder: undefined, forkPivotId: undefined })
  }
  for (const range of diff.deleteSubtrees ?? []) {
    requireRow(range.rootMessageId, range.threadId)
    const pending = [range.rootMessageId]
    const seen = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (seen.has(id)) throw new Error('Cyclic subtree')
      seen.add(id)
      messages.delete(id)
      for (const row of children(range.threadId, id)) pending.push(row.messageId)
    }
  }
  const removedThreads = new Set(diff.deleteThreadMessages ?? [])
  if (diff.deleteSessionMessages || removedThreads.size)
    for (const row of old.values())
      if (diff.deleteSessionMessages || removedThreads.has(row.threadId)) messages.delete(row.messageId)
  if (diff.deleteArchivedThreads) for (const id of threads.keys()) if (id !== activeThreadId) threads.delete(id)
}

/** The test adapter stores body objects directly; production stores derive these facts while persisting each body. */
export function projectMemoryRows(messages: Map<string, MessageRow>, threads: Map<string, ThreadRow>): string[] {
  const changedForks: string[] = []
  for (const [id, row] of messages)
    messages.set(id, { ...row, facts: row.facts ?? deriveMessageFacts(row.message), selected: false })
  for (const [id, thread] of threads) {
    let summary = emptyThreadSummary()
    let cursor = thread.rootMessageId
    let parent: string | null = null
    const seen = new Set<string>()
    while (cursor !== null) {
      const row = messages.get(cursor)
      if (!row || row.threadId !== id || row.parentMessageId !== parent || seen.has(cursor))
        throw new Error('Invalid selected path')
      seen.add(cursor)
      messages.set(cursor, { ...row, selected: true })
      summary = addSummaryRow(summary, { ...row, facts: row.facts! })
      parent = cursor
      cursor = row.activeChildId
    }
    let generatingAssistantCount = 0
    for (const row of messages.values())
      if (row.threadId === id && row.status === 'generating' && row.facts?.role === 'assistant')
        generatingAssistantCount++
    threads.set(id, { ...thread, activeLeafMessageId: parent, summary, control: { generatingAssistantCount } })
  }
  const children = new Map<string, MessageRow[]>()
  for (const row of messages.values())
    if (row.parentMessageId !== null) {
      const list = children.get(row.parentMessageId) ?? []
      list.push(row)
      children.set(row.parentMessageId, list)
    }
  for (const point of messages.values()) {
    if (!point.forkPivotId) continue
    const pivot = messages.get(point.forkPivotId)
    if (!pivot || pivot.threadId !== point.threadId) throw new Error('Missing fork pivot')
    const branches = sorted(children.get(point.messageId) ?? []).map((row) => ({
      id: row.messageId,
      branchId: row.branchId,
      siblingOrder: row.siblingOrder,
    }))
    if (point.pendingBranchId)
      branches.push({
        id: point.pendingBranchId,
        branchId: point.pendingBranchId,
        siblingOrder: point.pendingBranchOrder!,
      })
    branches.sort((a, b) => a.siblingOrder - b.siblingOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const position = branches.findIndex((branch) => branch.id === (point.activeChildId ?? point.pendingBranchId))
    const selected = branches[position]
    if (!selected?.branchId) throw new Error('Missing selected fork identity')
    const fork = {
      pivotId: pivot.messageId,
      branchPointId: point.messageId,
      selectedBranchId: selected.branchId,
      count: branches.length,
      position,
    }
    if (
      pivot.fork?.pivotId !== fork.pivotId ||
      pivot.fork.branchPointId !== fork.branchPointId ||
      pivot.fork.selectedBranchId !== fork.selectedBranchId ||
      pivot.fork.count !== fork.count ||
      pivot.fork.position !== fork.position
    )
      changedForks.push(pivot.messageId)
    messages.set(pivot.messageId, { ...pivot, fork })
  }
  return changedForks
}

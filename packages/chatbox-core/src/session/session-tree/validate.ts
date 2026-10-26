import type { MessageRowMetadata, SessionRecordV2, ThreadRow } from './types'

export type SessionTreeValidationResult = { ok: true } | { ok: false; reason: string }

function childKey(threadId: string, parentMessageId: string): string {
  return `${threadId} ${parentMessageId}`
}

/** Check the structural invariants a session tree must hold for decoding to be well defined. */
export function validateSessionTree(tree: {
  session: SessionRecordV2
  threads: ThreadRow[]
  messages: MessageRowMetadata[]
}): SessionTreeValidationResult {
  if (tree.session.rowFormatVersion !== undefined && tree.session.rowFormatVersion !== 3) {
    return { ok: false, reason: 'Unsupported session row format version' }
  }
  const threadsById = new Map<string, ThreadRow>()
  const threadSeqs = new Set<number>()
  for (const thread of tree.threads) {
    if (thread.sessionId !== tree.session.id) {
      return { ok: false, reason: `thread ${thread.threadId} belongs to session ${thread.sessionId}` }
    }
    if (threadsById.has(thread.threadId)) {
      return { ok: false, reason: `duplicate thread row ${thread.threadId}` }
    }
    if (threadSeqs.has(thread.seq)) {
      return { ok: false, reason: `thread ${thread.threadId} reuses seq ${thread.seq}` }
    }
    threadsById.set(thread.threadId, thread)
    threadSeqs.add(thread.seq)
  }

  const activeThread = threadsById.get(tree.session.activeThreadId)
  if (!activeThread) {
    return { ok: false, reason: `active thread ${tree.session.activeThreadId} has no thread row` }
  }
  if (activeThread.seq !== -1) {
    return { ok: false, reason: `active thread ${activeThread.threadId} has seq ${activeThread.seq}, expected -1` }
  }
  for (const thread of tree.threads) {
    if (thread !== activeThread && thread.name === null) {
      return { ok: false, reason: `archived thread ${thread.threadId} has no name` }
    }
  }

  const rowsById = new Map<string, MessageRowMetadata>()
  const threadMessageIds = new Map<string, Set<string>>()
  for (const row of tree.messages) {
    if (!Number.isSafeInteger(row.seq) || row.seq < 0) {
      return { ok: false, reason: `message ${row.messageId} has an invalid ordering label` }
    }
    if (row.sessionId !== tree.session.id) {
      return { ok: false, reason: `message ${row.messageId} belongs to session ${row.sessionId}` }
    }
    if (rowsById.has(row.messageId)) {
      return { ok: false, reason: `duplicate message row ${row.messageId}` }
    }
    if (!threadsById.has(row.threadId)) {
      return { ok: false, reason: `message ${row.messageId} references unknown thread ${row.threadId}` }
    }
    rowsById.set(row.messageId, row)
    const ids = threadMessageIds.get(row.threadId)
    if (ids) {
      ids.add(row.messageId)
    } else {
      threadMessageIds.set(row.threadId, new Set([row.messageId]))
    }
  }

  /** null marks an ancestor chain already proven acyclic; a string is the row whose walk is on it now. */
  const chainOrigin = new Map<string, string | null>()
  for (const row of tree.messages) {
    if (chainOrigin.get(row.messageId) === null) {
      continue
    }
    const walked: string[] = []
    let current: MessageRowMetadata | undefined = row
    while (current !== undefined) {
      const origin = chainOrigin.get(current.messageId)
      if (origin === null) {
        break
      }
      if (origin === row.messageId) {
        return { ok: false, reason: `message ${row.messageId} sits on a parent cycle` }
      }
      chainOrigin.set(current.messageId, row.messageId)
      walked.push(current.messageId)
      current = current.parentMessageId === null ? undefined : rowsById.get(current.parentMessageId)
    }
    for (const messageId of walked) {
      chainOrigin.set(messageId, null)
    }
  }

  const childrenByParent = new Map<string, MessageRowMetadata[]>()
  const rootsByThread = new Map<string, MessageRowMetadata[]>()
  for (const row of tree.messages) {
    if (row.parentMessageId === null) {
      const roots = rootsByThread.get(row.threadId)
      if (roots) {
        roots.push(row)
      } else {
        rootsByThread.set(row.threadId, [row])
      }
      continue
    }
    const parent = rowsById.get(row.parentMessageId)
    if (!parent) {
      return { ok: false, reason: `message ${row.messageId} references missing parent ${row.parentMessageId}` }
    }
    if (parent.threadId !== row.threadId) {
      return {
        ok: false,
        reason: `message ${row.messageId} has parent ${parent.messageId} in thread ${parent.threadId}`,
      }
    }
    if (tree.session.rowFormatVersion !== 3 && row.seq <= parent.seq) {
      return {
        ok: false,
        reason: `message ${row.messageId} has seq ${row.seq}, which does not follow its parent seq ${parent.seq}`,
      }
    }
    const key = childKey(row.threadId, row.parentMessageId)
    const siblings = childrenByParent.get(key)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenByParent.set(key, [row])
    }
  }

  for (const row of tree.messages) {
    if (tree.session.rowFormatVersion === 3) {
      const siblings = childrenByParent.get(childKey(row.threadId, row.messageId)) ?? []
      if (new Set(siblings.map((child) => child.seq)).size !== siblings.length) {
        return { ok: false, reason: `message ${row.messageId} has duplicate sibling labels` }
      }
      if (row.pendingBranchId !== undefined || row.pendingBranchSeq !== undefined) {
        if (
          !row.pendingBranchId ||
          row.activeChildId !== null ||
          !Number.isSafeInteger(row.pendingBranchSeq) ||
          row.pendingBranchSeq === undefined ||
          row.pendingBranchSeq < 0 ||
          siblings.some((child) => child.seq === row.pendingBranchSeq)
        ) {
          return { ok: false, reason: `message ${row.messageId} has an invalid empty branch slot` }
        }
      }
    }
    if (row.activeChildId === null) {
      continue
    }
    const children = childrenByParent.get(childKey(row.threadId, row.messageId)) ?? []
    if (!children.some((child) => child.messageId === row.activeChildId)) {
      return {
        ok: false,
        reason: `message ${row.messageId} points at active child ${row.activeChildId}, which is not one of its children`,
      }
    }
  }

  for (const thread of tree.threads) {
    const roots = rootsByThread.get(thread.threadId) ?? []
    const messageCount = threadMessageIds.get(thread.threadId)?.size ?? 0
    if (messageCount === 0) {
      if (thread.rootMessageId !== null || thread.activeLeafMessageId !== null) {
        return { ok: false, reason: `empty thread ${thread.threadId} names a root or an active leaf` }
      }
      continue
    }
    if (roots.length !== 1) {
      return { ok: false, reason: `thread ${thread.threadId} has ${roots.length} roots, expected 1` }
    }
    if (thread.rootMessageId !== roots[0].messageId) {
      return {
        ok: false,
        reason: `thread ${thread.threadId} names root ${thread.rootMessageId ?? 'null'} but its root row is ${roots[0].messageId}`,
      }
    }

    let leafMessageId: string | null = null
    let cursor: string | null = thread.rootMessageId
    while (cursor !== null) {
      leafMessageId = cursor
      cursor = rowsById.get(cursor)?.activeChildId ?? null
    }
    if (leafMessageId !== thread.activeLeafMessageId) {
      return {
        ok: false,
        reason: `thread ${thread.threadId} names active leaf ${thread.activeLeafMessageId ?? 'null'} but its active path ends at ${leafMessageId ?? 'null'}`,
      }
    }

    const ids = threadMessageIds.get(thread.threadId) ?? new Set<string>()
    for (const point of thread.compactionPoints) {
      if (!ids.has(point.boundaryMessageId)) {
        return {
          ok: false,
          reason: `thread ${thread.threadId} compacts at boundary ${point.boundaryMessageId}, which is not one of its messages`,
        }
      }
      if (!ids.has(point.summaryMessageId)) {
        return {
          ok: false,
          reason: `thread ${thread.threadId} compacts into summary ${point.summaryMessageId}, which is not one of its messages`,
        }
      }
      if (rowsById.get(point.summaryMessageId)?.kind !== 'summary') {
        return { ok: false, reason: `compaction summary ${point.summaryMessageId} is not a summary message` }
      }
    }
  }

  return { ok: true }
}

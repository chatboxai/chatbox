import type { Message, Session, SessionThread } from '../../types/session'
import type { MessageRow, SessionTree, ThreadRow } from './types'

type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]

export type DecodeSessionTreeResult = { ok: true; session: Session } | { ok: false; reason: string }

type ChainResult = { ok: true; messages: Message[] } | { ok: false; reason: string }

function childKey(threadId: string, parentMessageId: string): string {
  return `${threadId}\u0000${parentMessageId}`
}

/** Rebuild a V1 session from its row projection. */
export function decodeSessionTree(tree: SessionTree): DecodeSessionTreeResult {
  const activeThreadRow = tree.threads.find((thread) => thread.threadId === tree.session.activeThreadId)
  if (!activeThreadRow) {
    return { ok: false, reason: `active thread ${tree.session.activeThreadId} has no thread row` }
  }
  if (activeThreadRow.seq !== -1) {
    return { ok: false, reason: `active thread ${activeThreadRow.threadId} must have seq -1` }
  }

  const rowsById = new Map<string, MessageRow>()
  for (const row of tree.messages) {
    if (rowsById.has(row.messageId)) {
      return { ok: false, reason: `duplicate message row ${row.messageId}` }
    }
    rowsById.set(row.messageId, row)
  }

  const childrenByParent = new Map<string, MessageRow[]>()
  for (const row of tree.messages) {
    if (row.parentMessageId === null) {
      continue
    }
    const key = childKey(row.threadId, row.parentMessageId)
    const siblings = childrenByParent.get(key)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenByParent.set(key, [row])
    }
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(
      (left, right) =>
        left.seq - right.seq || (left.messageId < right.messageId ? -1 : left.messageId > right.messageId ? 1 : 0)
    )
  }

  const messageForksHash: Record<string, MessageForkEntry> = {}
  let consumedRows = 0

  const resolvePivotId = (row: MessageRow): { ok: true; pivotId: string } | { ok: false; reason: string } => {
    let current = row
    while (current.kind === 'summary') {
      if (current.parentMessageId === null) {
        return { ok: false, reason: `branch point ${row.messageId} has no non-summary ancestor` }
      }
      const parent = rowsById.get(current.parentMessageId)
      if (!parent) {
        return {
          ok: false,
          reason: `message ${current.messageId} references missing parent ${current.parentMessageId}`,
        }
      }
      current = parent
    }
    return { ok: true, pivotId: current.messageId }
  }

  const decodeThread = (threadRow: ThreadRow): ChainResult => {
    const visited = new Set<string>()

    const chainFrom = (startMessageId: string): ChainResult => {
      const chain: Message[] = []
      let cursor: string | null = startMessageId

      while (cursor !== null) {
        if (visited.has(cursor)) {
          return { ok: false, reason: `message ${cursor} is reachable twice in thread ${threadRow.threadId}` }
        }
        visited.add(cursor)
        consumedRows += 1

        const row = rowsById.get(cursor)
        if (!row) {
          return { ok: false, reason: `missing message row ${cursor} in thread ${threadRow.threadId}` }
        }
        if (row.threadId !== threadRow.threadId) {
          return { ok: false, reason: `message ${cursor} belongs to thread ${row.threadId}` }
        }
        chain.push(row.message)

        const children: MessageRow[] = childrenByParent.get(childKey(threadRow.threadId, cursor)) ?? []
        if (children.length === 0) {
          if (row.activeChildId !== null) {
            return { ok: false, reason: `leaf ${cursor} points at active child ${row.activeChildId}` }
          }
          break
        }
        if (children.length === 1 && row.activeChildId === children[0].messageId) {
          cursor = row.activeChildId
          continue
        }

        const pivot = resolvePivotId(row)
        if (!pivot.ok) {
          return pivot
        }
        if (messageForksHash[pivot.pivotId]) {
          return { ok: false, reason: `fork pivot ${pivot.pivotId} is claimed by two branch points` }
        }

        const lists: MessageForkEntry['lists'] = []
        let position = -1
        for (const child of children) {
          const id = child.branchId ?? `fork_list_${child.messageId}`
          if (child.messageId === row.activeChildId) {
            position = lists.length
            lists.push({ id, messages: [] })
            continue
          }
          const branch = chainFrom(child.messageId)
          if (!branch.ok) {
            return branch
          }
          lists.push({ id, messages: branch.messages })
        }
        if (row.activeChildId === null) {
          const pendingSeq = row.pendingBranchSeq
          const nextSibling = pendingSeq === undefined ? -1 : children.findIndex((child) => child.seq > pendingSeq)
          position = nextSibling < 0 ? lists.length : nextSibling
          lists.splice(position, 0, { id: row.pendingBranchId ?? `fork_list_empty_${pivot.pivotId}`, messages: [] })
        } else if (position < 0) {
          return {
            ok: false,
            reason: `message ${cursor} points at active child ${row.activeChildId}, not one of its children`,
          }
        }

        messageForksHash[pivot.pivotId] = {
          position,
          lists,
          createdAt:
            rowsById.get(pivot.pivotId)?.forkCreatedAt ??
            tree.session.forkCreatedAt?.[pivot.pivotId] ??
            Math.min(...children.map((child) => child.createdAt)),
        }
        cursor = row.activeChildId
      }

      return { ok: true, messages: chain }
    }

    if (threadRow.rootMessageId === null) {
      if (threadRow.activeLeafMessageId !== null) {
        return {
          ok: false,
          reason: `empty thread ${threadRow.threadId} names active leaf ${threadRow.activeLeafMessageId}`,
        }
      }
      return { ok: true, messages: [] }
    }

    const rootRow = rowsById.get(threadRow.rootMessageId)
    if (!rootRow) {
      return { ok: false, reason: `thread ${threadRow.threadId} references missing root ${threadRow.rootMessageId}` }
    }
    if (rootRow.parentMessageId !== null) {
      return { ok: false, reason: `root ${rootRow.messageId} of thread ${threadRow.threadId} has a parent` }
    }

    const result = chainFrom(threadRow.rootMessageId)
    if (!result.ok) {
      return result
    }
    const leafMessageId = result.messages.at(-1)?.id ?? null
    if (leafMessageId !== threadRow.activeLeafMessageId) {
      return {
        ok: false,
        reason: `thread ${threadRow.threadId} names active leaf ${threadRow.activeLeafMessageId ?? 'null'} but its active path ends at ${leafMessageId ?? 'null'}`,
      }
    }
    return result
  }

  const active = decodeThread(activeThreadRow)
  if (!active.ok) {
    return active
  }

  const archivedRows = tree.threads
    .filter((thread) => thread !== activeThreadRow)
    .sort((left, right) => left.seq - right.seq)
  const threads: SessionThread[] = []
  for (const threadRow of archivedRows) {
    if (threadRow.name === null) {
      return { ok: false, reason: `archived thread ${threadRow.threadId} has no name` }
    }
    const decoded = decodeThread(threadRow)
    if (!decoded.ok) {
      return decoded
    }
    threads.push({
      id: threadRow.threadId,
      name: threadRow.name,
      messages: decoded.messages,
      createdAt: threadRow.createdAt,
      ...(threadRow.compactionPoints.length > 0 ? { compactionPoints: threadRow.compactionPoints } : {}),
      ...(threadRow.sessionPromptContextSnapshot === undefined
        ? {}
        : { sessionPromptContextSnapshot: threadRow.sessionPromptContextSnapshot }),
    })
  }

  if (consumedRows !== tree.messages.length) {
    return {
      ok: false,
      reason: `${tree.messages.length - consumedRows} message rows are unreachable from their thread`,
    }
  }

  const {
    activeThreadId: _activeThreadId,
    storageFormat: _storageFormat,
    rowAuthority: _rowAuthority,
    rowFormatVersion: _rowFormatVersion,
    forkCreatedAt: _forkCreatedAt,
    presentation: _presentation,
    contextReadProjection: _contextReadProjection,
    topologyFingerprint: _topologyFingerprint,
    ...record
  } = tree.session

  return {
    ok: true,
    session: {
      ...record,
      messages: active.messages,
      ...(threads.length > 0 ? { threads } : {}),
      ...(activeThreadRow.name === null ? {} : { threadName: activeThreadRow.name }),
      ...(activeThreadRow.compactionPoints.length > 0 ? { compactionPoints: activeThreadRow.compactionPoints } : {}),
      ...(Object.keys(messageForksHash).length > 0 ? { messageForksHash } : {}),
    },
  }
}

import { v5 as uuidv5 } from 'uuid'
import type { SessionRowStorePort } from '../../ports/session-row-store'
import type {
  MessageRow,
  MessageRowMetadata,
  SessionRowRecord,
  SessionThreadSummary,
  ThreadRow,
} from '../../session/session-tree/types'
import { validateSessionTree } from '../../session/session-tree/validate'

export const copiedMessageId = (sessionId: string, messageId: string): string =>
  uuidv5(`${sessionId}\u0000message\u0000${messageId}`, uuidv5.URL)
export const copiedBranchId = (sessionId: string, branchId: string): string =>
  uuidv5(`${sessionId}\u0000branch\u0000${branchId}`, uuidv5.URL)

export function copyThreadMetadata(thread: ThreadRow, sessionId: string, threadId = sessionId, seq = -1): ThreadRow {
  const id = (value: string | null) => (value === null ? null : copiedMessageId(sessionId, value))
  const summary = thread.summary && { ...thread.summary }
  if (summary) {
    for (const key of Object.keys(summary) as Array<keyof SessionThreadSummary>) {
      const value = summary[key]
      if (key.endsWith('MessageId') && typeof value === 'string') Object.assign(summary, { [key]: id(value) })
    }
  }
  return {
    ...thread,
    sessionId,
    threadId,
    seq,
    rootMessageId: id(thread.rootMessageId),
    activeLeafMessageId: id(thread.activeLeafMessageId),
    compactionPoints: thread.compactionPoints.map((point) => ({
      ...point,
      summaryMessageId: copiedMessageId(sessionId, point.summaryMessageId),
      boundaryMessageId: copiedMessageId(sessionId, point.boundaryMessageId),
    })),
    summary,
  }
}

function copyRow(row: MessageRow, sessionId: string, threadId: string): MessageRow {
  const id = (value: string | null) => (value === null ? null : copiedMessageId(sessionId, value))
  return {
    ...row,
    sessionId,
    threadId,
    messageId: copiedMessageId(sessionId, row.messageId),
    parentMessageId: id(row.parentMessageId),
    activeChildId: id(row.activeChildId),
    branchId: row.branchId === null ? null : copiedBranchId(sessionId, row.branchId),
    forkPivotId: row.forkPivotId && copiedMessageId(sessionId, row.forkPivotId),
    pendingBranchId: row.pendingBranchId && copiedBranchId(sessionId, row.pendingBranchId),
    fork: row.fork && {
      ...row.fork,
      pivotId: copiedMessageId(sessionId, row.fork.pivotId),
      branchPointId: copiedMessageId(sessionId, row.fork.branchPointId),
      selectedBranchId: copiedBranchId(sessionId, row.fork.selectedBranchId),
    },
    message: { ...row.message, id: copiedMessageId(sessionId, row.messageId) },
  }
}

/** The target becomes visible only after the source revision has been checked again. */
export async function stageSessionCopy(options: {
  store: SessionRowStorePort
  sourceSessionId: string
  sourceRevision: number
  sourceThreadId?: string
  record: SessionRowRecord
  expectedTargetRevision: number | null
  mapThread: (thread: ThreadRow) => ThreadRow
  mapThreadId: (threadId: string) => string
  transformActiveMessage?: (row: MessageRow) => MessageRow | null
  appendMessages?: MessageRow[]
  verifySource: () => Promise<void>
}) {
  const { store, record } = options
  const candidate = await store.stageRows(
    { record, revision: (options.expectedTargetRevision ?? 0) + 1 },
    options.expectedTargetRevision
  )
  const transformed =
    options.transformActiveMessage || options.appendMessages?.length
      ? { session: record, threads: [] as ThreadRow[], messages: [] as MessageRowMetadata[] }
      : undefined
  const append = async (message: MessageRow) => {
    const copied = copyRow(message, record.id, options.mapThreadId(message.threadId))
    if (transformed && copied.threadId === record.activeThreadId) {
      const { message: _body, ...metadata } = copied
      transformed.messages.push(metadata)
    }
    await candidate.appendMessage(copied)
  }
  try {
    for await (const row of store.iterateRows({
      sessionId: options.sourceSessionId,
      threadId: options.sourceThreadId,
      expectedRevision: options.sourceRevision,
    })) {
      if (row.kind === 'thread') {
        const thread = options.mapThread(row.thread)
        if (transformed && thread.threadId === record.activeThreadId) transformed.threads.push(thread)
        await candidate.appendThread(thread)
        continue
      }
      if (options.sourceThreadId && row.message.threadId !== options.sourceThreadId)
        throw new Error('Copy source escaped its thread scope')
      const message =
        options.transformActiveMessage && options.mapThreadId(row.message.threadId) === record.activeThreadId
          ? options.transformActiveMessage(row.message)
          : row.message
      if (message && message.threadId !== row.message.threadId)
        throw new Error('Copy transformation changed message thread identity')
      if (message) await append(message)
    }
    for (const message of options.appendMessages ?? []) {
      if (options.mapThreadId(message.threadId) !== record.activeThreadId)
        throw new Error('Appended copy messages must belong to the active thread')
      await append(message)
    }
    if (transformed) {
      const validation = validateSessionTree(transformed)
      if (!validation.ok) throw new Error(`Invalid copied branch: ${validation.reason}`)
    }
    await options.verifySource()
    await candidate.publish()
  } finally {
    await candidate.dispose().catch(() => {})
  }
}

import type { Message, Session } from '../../types/session'
import { forkTailStartIndex } from '@shared/session/message-forks'
import { normalizeSessionV1 } from './normalize'
import type { MessageRow, MessageRowStatus, SessionRecordV2, SessionTree, ThreadRow } from './types'

export interface EncodeSessionTreeOptions {
  /** Thread id given to the active conversation; the same value yields the same tree. */
  activeThreadId: string
  /** Fallback timestamp for a new empty active thread. */
  now: number
}

export type EncodeSessionTreeResult =
  | { ok: true; tree: SessionTree; normalized: Session /** See `NormalizeSessionV1Result`. */; reshaped: boolean }
  | { ok: false; reason: string }

/** Row status of a message; a row written outside `encodeSessionTree` derives it the same way. */
export function messageRowStatus(message: Message): MessageRowStatus {
  return message.generating === true ? 'generating' : 'settled'
}

/** Row timestamp of a message; a row written outside `encodeSessionTree` derives it the same way. */
export function messageRowUpdatedAt(message: Message, createdAt: number): number {
  return message.updatedAt ?? createdAt
}

/** Header and historical fork timestamps required by the external legacy codec. */
function encodeSessionRecord(session: Session, activeThreadId: string): SessionRecordV2 {
  const {
    messages: _messages,
    threads: _threads,
    threadName: _threadName,
    messageForksHash: _forks,
    compactionPoints: _compaction,
    ...header
  } = session
  const forkCreatedAt = Object.fromEntries(
    Object.entries(session.messageForksHash ?? {}).map(([id, fork]) => [id, fork.createdAt])
  )
  return {
    ...header,
    activeThreadId,
    storageFormat: 'rows',
    ...(Object.keys(forkCreatedAt).length ? { forkCreatedAt } : {}),
  }
}

interface EncodedThreadMessages {
  rows: MessageRow[]
  rootMessageId: string | null
  activeLeafMessageId: string | null
}

// Messages created before timestamp persistence have no recoverable wall-clock
// time. A sentinel keeps their row metadata stable across future encodes.
const LEGACY_MESSAGE_TIMESTAMP = 0

function encodeThreadMessages(
  sessionId: string,
  threadId: string,
  messages: Message[],
  forks: NonNullable<Session['messageForksHash']>
): EncodedThreadMessages {
  const rows: MessageRow[] = []
  const rowsById = new Map<string, MessageRow>()
  let seq = 0

  const createRow = (message: Message, parentMessageId: string | null, branchId: string | null): MessageRow => {
    const createdAt = message.timestamp ?? LEGACY_MESSAGE_TIMESTAMP
    const row: MessageRow = {
      sessionId,
      threadId,
      messageId: message.id,
      parentMessageId,
      activeChildId: null,
      seq,
      kind: message.isSummary ? 'summary' : 'message',
      status: messageRowStatus(message),
      createdAt,
      updatedAt: messageRowUpdatedAt(message, createdAt),
      branchId,
      message,
    }
    seq += 1
    rows.push(row)
    rowsById.set(message.id, row)
    return row
  }

  const emitChain = (chain: Message[], parentMessageId: string | null, headBranchId: string | null): void => {
    let previous: MessageRow | null = null

    for (const [index, message] of chain.entries()) {
      const row = createRow(message, previous ? previous.messageId : parentMessageId, index === 0 ? headBranchId : null)
      if (previous) {
        previous.activeChildId = message.id
      }
      previous = row

      const fork = forks[message.id]
      if (!fork) {
        continue
      }

      // Summaries anchored to the pivot belong to the shared prefix, so they
      // stay on the chain and the branch point moves past them.
      const tailStart = forkTailStartIndex(chain, index)
      let branchPoint = row
      for (const summary of chain.slice(index + 1, tailStart)) {
        const summaryRow = createRow(summary, branchPoint.messageId, null)
        branchPoint.activeChildId = summary.id
        branchPoint = summaryRow
      }

      const activeTail = chain.slice(tailStart)
      for (const [listIndex, list] of fork.lists.entries()) {
        const branch = listIndex === fork.position ? activeTail : list.messages
        emitChain(branch, branchPoint.messageId, list.id)
        if (listIndex === fork.position) {
          branchPoint.activeChildId = branch[0]?.id ?? null
        }
      }
      return
    }
  }

  emitChain(messages, null, null)

  const rootMessageId: string | null = messages[0]?.id ?? null
  let activeLeafMessageId: string | null = null
  let cursor: string | null = rootMessageId
  while (cursor !== null) {
    activeLeafMessageId = cursor
    cursor = rowsById.get(cursor)?.activeChildId ?? null
  }

  return { rows, rootMessageId, activeLeafMessageId }
}

/**
 * Project a V1 session onto message rows, thread rows and a session record.
 * The session is normalized first, so the returned `normalized` value — not
 * the input — is what the tree round-trips back to.
 */
export function encodeSessionTree(session: Session, options: EncodeSessionTreeOptions): EncodeSessionTreeResult {
  const normalizedResult = normalizeSessionV1(session)
  if (!normalizedResult.ok) {
    return normalizedResult
  }
  const normalized = normalizedResult.session
  const archivedThreads = normalized.threads ?? []
  if (archivedThreads.some((thread) => thread.id === options.activeThreadId)) {
    return { ok: false, reason: `archived thread ${options.activeThreadId} collides with the active thread id` }
  }

  const forks = normalized.messageForksHash ?? {}
  const messages: MessageRow[] = []
  const threads: ThreadRow[] = []

  const active = encodeThreadMessages(normalized.id, options.activeThreadId, normalized.messages, forks)
  messages.push(...active.rows)
  threads.push({
    sessionId: normalized.id,
    threadId: options.activeThreadId,
    seq: -1,
    name: normalized.threadName ?? null,
    createdAt: active.rows[0]?.createdAt ?? options.now,
    rootMessageId: active.rootMessageId,
    activeLeafMessageId: active.activeLeafMessageId,
    compactionPoints: normalized.compactionPoints ?? [],
  })

  for (const [index, thread] of archivedThreads.entries()) {
    const encoded = encodeThreadMessages(normalized.id, thread.id, thread.messages, forks)
    messages.push(...encoded.rows)
    threads.push({
      sessionId: normalized.id,
      threadId: thread.id,
      seq: index,
      name: thread.name,
      createdAt: thread.createdAt,
      rootMessageId: encoded.rootMessageId,
      activeLeafMessageId: encoded.activeLeafMessageId,
      compactionPoints: thread.compactionPoints ?? [],
      ...(thread.sessionPromptContextSnapshot === undefined
        ? {}
        : { sessionPromptContextSnapshot: thread.sessionPromptContextSnapshot }),
    })
  }

  const sessionRecord = encodeSessionRecord(normalized, options.activeThreadId)

  return {
    ok: true,
    tree: { session: sessionRecord, threads, messages },
    normalized,
    reshaped: normalizedResult.reshaped,
  }
}

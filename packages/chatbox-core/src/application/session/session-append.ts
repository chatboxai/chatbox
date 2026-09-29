import { deriveContextReadProjection } from '../../persistence/session-context-read'
import type { SessionRows, SessionRowsDiff } from '../../ports/session-row-store'
import { deriveSessionRecord, messageRowStatus, messageRowUpdatedAt, type MessageRow } from '../../session/session-tree'
import { deriveSessionTopologyFingerprint } from '../../session/session-tree/topology-fingerprint'
import type { Message, Session } from '../../types/session'

/** Matches an immutable baseline while allowing separately persisted token overlays. */
export function isAppendBase(previous: Session, base: Session, allowTextTokenOverlay = false): boolean {
  if (previous === base) return true
  const keys = Object.keys({ ...previous, ...base }) as (keyof Session)[]
  if (keys.some((key) => key !== 'messages' && previous[key] !== base[key])) return false
  if (previous.messages.length !== base.messages.length) return false
  return previous.messages.every((message, index) => {
    const other = base.messages[index]
    if (message === other) return true
    const fields = Object.keys({ ...message, ...other }) as (keyof Message)[]
    return fields.every((key) =>
      allowTextTokenOverlay &&
      (key === 'tokenCountMap' || key === 'tokenCalculatedAt' || key === 'tokenCountApproximate')
        ? true
        : message[key] === other[key]
    )
  })
}

/** Plans a tail append using persisted topology and immutable message identities. */
export function planSessionAppend(previous: Session, next: Session, rows: SessionRows) {
  if (
    next.id !== previous.id ||
    next.messages.length <= previous.messages.length ||
    next.threads !== previous.threads ||
    next.messageForksHash !== previous.messageForksHash ||
    next.compactionPoints !== previous.compactionPoints ||
    next.threadName !== previous.threadName ||
    previous.messages.some((message, index) => message !== next.messages[index])
  )
    return null

  const active = rows.threads.find((thread) => thread.threadId === next.id && thread.seq === -1)
  if (!active) return null
  const tail = previous.messages.at(-1)
  // A summary may move the branch point of the preceding fork.
  if (tail && (tail.isSummary || previous.messageForksHash?.[tail.id])) return null
  if (active.activeLeafMessageId !== (tail?.id ?? null)) return null
  const activeRows = rows.messages.filter((row) => row.threadId === active.threadId)
  const last = activeRows.at(-1)
  // Appending before another DFS branch would require relabeling that branch.
  if (last?.messageId !== tail?.id || (last && last.activeChildId !== null)) return null

  const appended = next.messages.slice(previous.messages.length)
  const ids = new Set(rows.messages.map((row) => row.messageId))
  let seq = last ? last.seq + 1 : 0
  if (!Number.isSafeInteger(seq + appended.length)) return null
  const added: MessageRow[] = []
  for (const message of appended) {
    if (!message.id || ids.has(message.id) || message.isSummary) return null
    ids.add(message.id)
    const createdAt = message.timestamp ?? 0
    added.push({
      sessionId: next.id,
      threadId: active.threadId,
      messageId: message.id,
      parentMessageId: added.at(-1)?.messageId ?? last?.messageId ?? null,
      activeChildId: null,
      seq: seq++,
      kind: 'message',
      status: messageRowStatus(message),
      createdAt,
      updatedAt: messageRowUpdatedAt(message, createdAt),
      branchId: null,
      message,
    })
    if (added.length > 1) added[added.length - 2].activeChildId = message.id
  }
  const first = added[0]
  const updatedTail = last ? { ...last, activeChildId: first.messageId } : null
  const thread = {
    ...active,
    rootMessageId: active.rootMessageId ?? first.messageId,
    activeLeafMessageId: added[added.length - 1].messageId,
    createdAt: last ? active.createdAt : first.createdAt,
  }
  const threads = rows.threads.map((row) => (row === active ? thread : row))
  const messages = rows.messages.map((row) => (row === last && updatedTail ? updatedTail : row))
  const insertion = last ? rows.messages.indexOf(last) + 1 : 0
  messages.splice(insertion, 0, ...added)
  const record = deriveSessionRecord(next, active.threadId)
  record.contextReadProjection = deriveContextReadProjection(threads, messages)
  record.topologyFingerprint = deriveSessionTopologyFingerprint(threads, messages)
  const diff: SessionRowsDiff = {
    sessionId: next.id,
    threads: { upsert: [thread], delete: [] },
    messages: { upsert: [...(updatedTail ? [updatedTail] : []), ...added], delete: [] },
  }
  return { rows: { ...rows, threads, messages }, record, diff }
}

import type { SessionRows, SessionRowsDiff } from '../../ports/session-row-store'
import type { MessageRow, ThreadRow } from './types'

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined)
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = definedKeys(leftRecord)
  if (leftKeys.length !== definedKeys(rightRecord).length) {
    return false
  }
  return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]))
}

/** Every `MessageRow` field except the payload; a field added to the row belongs here too. */
const MESSAGE_ROW_STRUCTURAL_FIELDS: Record<keyof Omit<MessageRow, 'message'>, true> = {
  sessionId: true,
  threadId: true,
  messageId: true,
  parentMessageId: true,
  activeChildId: true,
  seq: true,
  kind: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  branchId: true,
}

const MESSAGE_ROW_STRUCTURAL_KEYS = Object.keys(MESSAGE_ROW_STRUCTURAL_FIELDS) as Array<
  keyof Omit<MessageRow, 'message'>
>

/**
 * Sessions are updated immutably, so a message left alone by an edit is the
 * same object in both snapshots. Its row then only has to be compared field by
 * field, which keeps the cost of a diff proportional to the number of rows
 * rather than to the bytes they carry.
 */
function messageRowsEqual(previous: MessageRow, next: MessageRow): boolean {
  if (previous.message !== next.message) {
    return deepEqual(previous, next)
  }
  return MESSAGE_ROW_STRUCTURAL_KEYS.every((key) => previous[key] === next[key])
}

function diffRows<Row>(
  previous: Row[],
  next: Row[],
  identify: (row: Row) => string,
  equals: (previous: Row, next: Row) => boolean
): { upsert: Row[]; delete: string[] } {
  const previousById = new Map<string, Row>()
  for (const row of previous) {
    previousById.set(identify(row), row)
  }

  const upsert: Row[] = []
  const nextIds = new Set<string>()
  for (const row of next) {
    const id = identify(row)
    nextIds.add(id)
    const before = previousById.get(id)
    if (!before || !equals(before, row)) {
      upsert.push(row)
    }
  }

  const removed: string[] = []
  for (const row of previous) {
    const id = identify(row)
    if (!nextIds.has(id)) {
      removed.push(id)
    }
  }

  return { upsert, delete: removed }
}

/**
 * Row-level difference between two snapshots of one session's rows. Rows are
 * matched by id and compared by content, so an edit that only moves the active
 * branch touches the branch point row and its thread row and nothing else.
 */
export function diffSessionRows(previous: SessionRows | null, next: SessionRows): SessionRowsDiff {
  const previousThreads: ThreadRow[] = previous ? previous.threads : []
  const previousMessages: MessageRow[] = previous ? previous.messages : []

  const messages = diffRows(previousMessages, next.messages, (row) => row.messageId, messageRowsEqual)
  const previousById = new Map(previousMessages.map((row) => [row.messageId, row]))
  const unchangedPayloadMessageIds = messages.upsert
    .filter((row) => {
      const before = previousById.get(row.messageId)
      return before !== undefined && deepEqual(before.message, row.message)
    })
    .map((row) => row.messageId)

  return {
    ...(unchangedPayloadMessageIds.length ? { unchangedPayloadMessageIds } : {}),
    sessionId: next.sessionId,
    threads: diffRows(previousThreads, next.threads, (row) => row.threadId, deepEqual),
    messages,
  }
}

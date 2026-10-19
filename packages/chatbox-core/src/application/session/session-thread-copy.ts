import { v5 as uuidv5 } from 'uuid'
import { BackupMessageValidator, backupPayloadBlocks } from '../../backup/payload'
import { JsonTokens } from '../../backup/resource-payload'
import { DEFAULT_BACKUP_PAGE_LIMITS, type BackupSessionStore } from '../../backup/session-port'
import type { MessageRow, SessionRowRecord, SessionThreadSummary, ThreadRow } from '../../session/session-tree/types'

export const copiedMessageId = (sessionId: string, messageId: string): string =>
  uuidv5(`${sessionId}\u0000message\u0000${messageId}`, uuidv5.URL)
export const copiedBranchId = (sessionId: string, branchId: string): string =>
  uuidv5(`${sessionId}\u0000branch\u0000${branchId}`, uuidv5.URL)

/** Changes the root identity while all body strings retain bounded streaming storage. */
export async function* copyMessagePayload(source: AsyncIterable<Uint8Array>, messageId: string) {
  const tokens = new JsonTokens(false)
  const encoder = new TextEncoder()
  let depth = 0
  let keyExpected = false
  let readingKey = false
  let key = ''
  let replacing = false
  let found = false
  function* write(token: { kind: string; value: string }): Generator<Uint8Array> {
    if (token.kind === 'string-start') {
      readingKey = depth === 1 && keyExpected
      if (readingKey) key = ''
      replacing = depth === 1 && !keyExpected && key === 'id'
      if (replacing) {
        if (found) throw new Error('Duplicate copied message identity')
        found = true
        yield encoder.encode(JSON.stringify(messageId))
        return
      }
    } else if (token.kind === 'string-part' && readingKey) {
      key = key.length < 64 ? key + token.value : key
    } else if (token.kind === 'string-end') {
      if (readingKey) {
        key = key.length <= 64 ? JSON.parse(`"${key}"`) : ''
        readingKey = false
      }
      if (replacing) {
        replacing = false
        key = ''
        return
      }
    } else if (token.kind === 'punctuation') {
      if (token.value === '{' || token.value === '[') {
        depth += 1
        if (depth === 1) keyExpected = true
      } else if (token.value === '}' || token.value === ']') depth -= 1
      else if (depth === 1 && token.value === ':') keyExpected = false
      else if (depth === 1 && token.value === ',') {
        keyExpected = true
        key = ''
      }
    }
    if (!replacing) yield encoder.encode(token.value)
  }
  for await (const block of source) for (const token of tokens.write(block)) yield* write(token)
  for (const token of tokens.finish()) yield* write(token)
  if (!found) throw new Error('Copied message identity is missing')
}

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
  store: BackupSessionStore
  sourceSessionId: string
  sourceThreadId?: string
  record: SessionRowRecord
  expectedTargetRevision: number | null
  mapThread: (thread: ThreadRow) => ThreadRow
  mapThreadId: (threadId: string) => string
  transformMessage?: (row: MessageRow) => MessageRow | null
  appendMessages?: MessageRow[]
  verifySource: () => Promise<void>
}) {
  const { store, record } = options
  const candidate = await store.beginBackupRestore(record.id, options.expectedTargetRevision)
  async function appendMessage(
    row: MessageRow,
    payload?: Extract<import('../../backup/session-port').BackupRow, { kind: 'message' }>['payload']
  ) {
    const message = copyRow(row, record.id, options.mapThreadId(row.threadId))
    if (payload?.chunks) {
      if (!candidate.appendPayload) throw new Error('Copy storage does not support payload restoration')
      const validator = new BackupMessageValidator()
      let size = 0
      for await (const bytes of backupPayloadBlocks(copyMessagePayload(payload.chunks(), message.messageId))) {
        validator.write(bytes)
        size += bytes.length
        await candidate.appendPayload(bytes)
      }
      await candidate.append({
        kind: 'message',
        message: { ...message, message: validator.finish() },
        payload: { size },
      })
    } else {
      await candidate.append({
        kind: 'message',
        message: payload?.value ? { ...message, message: { ...payload.value, id: message.messageId } } : message,
      })
    }
  }
  try {
    await candidate.append({ kind: 'header', record })
    for await (const row of store.iterateBackupRows(
      options.sourceSessionId,
      DEFAULT_BACKUP_PAGE_LIMITS,
      undefined,
      options.sourceThreadId
    )) {
      if (row.kind === 'header') continue
      if (row.kind === 'thread') {
        await candidate.append({ kind: 'thread', thread: options.mapThread(row.thread) })
        continue
      }
      if (options.sourceThreadId && row.message.threadId !== options.sourceThreadId)
        throw new Error('Copy source escaped its thread scope')
      const message = options.transformMessage ? options.transformMessage(row.message) : row.message
      if (message) await appendMessage(message, row.payload)
    }
    for (const message of options.appendMessages ?? []) await appendMessage(message)
    await options.verifySource()
    await candidate.publish()
  } catch (error) {
    await candidate.dispose().catch(() => undefined)
    throw error
  }
  await candidate.dispose().catch(() => undefined)
}

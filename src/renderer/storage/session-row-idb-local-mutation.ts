import { v4 as uuid } from 'uuid'
import {
  applyLocalRowMutation,
  type LocalRowMutationAccess,
  type ProjectedMessage,
  type TranscriptMessageMetadata,
} from '@chatbox/core/persistence'
import type { SessionRowCommit, SessionRowsDiff } from '@chatbox/core/ports'
import type { ThreadRow } from '@chatbox/core/session/session-tree'
import {
  MESSAGE_STAGE,
  MESSAGE_ORDER_INDEX,
  OLD_PARENT_ORDER,
  SELECTED_KIND,
  SELECTED_CONVERSATION,
  SELECTED_NAMING,
  SELECTED_ROLE,
  SESSION_INDEX,
  SESSION_ROW_THREAD_STORE,
} from './session-row-idb-records'
import {
  RELATION_CHILDREN,
  SELECTED_ORDER,
  TRANSCRIPT_MESSAGES,
  TRANSCRIPT_THREADS,
  putTranscriptThread,
  requestValue,
} from './session-row-idb-transcript'
import { deleteStoredMessage, messageMetadata, putStoredMessages } from './session-row-idb-messages'

type Metadata = ProjectedMessage & TranscriptMessageMetadata & { parentKey: string; branchKey: string }
type StageRow = Partial<Metadata> & {
  sessionId: string
  messageId: string
  deleted?: true
  oldThreadId?: string
  oldParentKey?: string
  oldSeq?: number
}
const sessionRange = (id: string) => IDBKeyRange.bound([id], [id, []])
const order = (left: ProjectedMessage, right: ProjectedMessage) =>
  left.seq - right.seq || (left.messageId < right.messageId ? -1 : left.messageId > right.messageId ? 1 : 0)

function metadata(row: StageRow | undefined): Metadata | null {
  if (!row || row.deleted) return null
  if (!row.facts || typeof row.selected !== 'boolean' || (row.selected && !Number.isSafeInteger(row.selectedDepth)))
    throw new Error('Message projection is unavailable')
  const { deleted: _deleted, oldThreadId: _thread, oldParentKey: _parent, oldSeq: _seq, ...result } = row
  return result as Metadata
}

/** The base projection stays immutable until every local relation has been evaluated. */
export async function applyIndexedDBLocalMutation(tx: IDBTransaction, diff: SessionRowsDiff, commit: SessionRowCommit) {
  const sessionId = diff.sessionId
  const base = tx.objectStore(TRANSCRIPT_MESSAGES)
  const stage = tx.objectStore(MESSAGE_STAGE)
  const threads = tx.objectStore(SESSION_ROW_THREAD_STORE)
  const changedThreads = new Map<string, ThreadRow>()
  const cleared = new Set<string>()
  let clearAll = false
  const isCleared = (threadId: string) => clearAll || cleared.has(threadId)
  await requestValue(stage.delete(sessionRange(sessionId)))
  const oldMessage = async (id: string) => metadata(await requestValue<Metadata | undefined>(base.get([sessionId, id])))
  const message = async (id: string) => {
    const staged = await requestValue<StageRow | undefined>(stage.get([sessionId, id]))
    if (staged) return metadata(staged)
    const row = await oldMessage(id)
    return row && !isCleared(row.threadId) ? row : null
  }
  const oldKeys = async (id: string) => {
    const old = await oldMessage(id)
    return old ? { oldThreadId: old.threadId, oldParentKey: old.parentKey, oldSeq: old.seq } : {}
  }
  async function scan(
    store: IDBObjectStore,
    index: string,
    range: IDBKeyRange,
    direction: IDBCursorDirection,
    limit: number,
    currentBase = false
  ): Promise<Metadata[]> {
    const result: Metadata[] = []
    await new Promise<void>((resolve, reject) => {
      const request = store.index(index).openCursor(range, direction)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor || result.length === limit) return resolve()
        const row = metadata(cursor.value as StageRow)
        if (!row) return cursor.continue()
        if (!currentBase) {
          result.push(row)
          cursor.continue()
          return
        }
        const override = stage.get([sessionId, row.messageId])
        override.onerror = () => reject(override.error)
        override.onsuccess = () => {
          if (!override.result && !isCleared(row.threadId)) result.push(row)
          cursor.continue()
        }
      }
    })
    return result
  }
  async function merged(
    index: string,
    range: IDBKeyRange,
    reverse: boolean,
    limit: number,
    old: boolean,
    compare: (a: Metadata, b: Metadata) => number,
    threadId: string
  ) {
    const direction = reverse ? 'prev' : 'next'
    if (old) return scan(base, index, range, direction, limit)
    const [original, staged] = await Promise.all([
      isCleared(threadId) ? [] : scan(base, index, range, direction, limit, true),
      scan(stage, index, range, direction, limit),
    ])
    return [...original, ...staged].sort((a, b) => (reverse ? -1 : 1) * compare(a, b)).slice(0, limit)
  }
  const access: LocalRowMutationAccess = {
    oldMessage,
    message,
    oldThread: async (id) => {
      return (await requestValue<ThreadRow | undefined>(threads.get([sessionId, id]))) ?? null
    },
    children: (threadId, parentId, after, limit, old = false) => {
      const prefix = [sessionId, threadId, parentId ?? '']
      const range = IDBKeyRange.bound(
        after ? [...prefix, after.seq, after.messageId] : prefix,
        [...prefix, []],
        Boolean(after)
      )
      return merged(RELATION_CHILDREN, range, false, limit, old, order, threadId)
    },
    selected: (threadId, options) => {
      const index = options.namingRole
        ? SELECTED_NAMING
        : options.conversation
          ? SELECTED_CONVERSATION
          : options.role
            ? SELECTED_ROLE
            : options.kind
              ? SELECTED_KIND
              : SELECTED_ORDER
      const prefix = [
        sessionId,
        threadId,
        ...(options.namingRole
          ? [options.namingRole]
          : options.conversation
            ? [1]
            : options.role
              ? [options.role]
              : options.kind
                ? [options.kind]
                : []),
      ]
      const range = IDBKeyRange.bound(
        options.afterDepth !== undefined ? [...prefix, options.afterDepth, []] : prefix,
        options.beforeDepth !== undefined ? [...prefix, options.beforeDepth] : [...prefix, []],
        options.afterDepth !== undefined,
        options.beforeDepth !== undefined
      )
      return merged(
        index,
        range,
        options.reverse ?? false,
        options.limit,
        options.old ?? false,
        (a, b) => a.selectedDepth! - b.selectedDepth!,
        threadId
      )
    },
    childStats: async (threadId, parentId, boundary) => {
      const prefix = [sessionId, threadId, parentId]
      const range = IDBKeyRange.bound(prefix, [...prefix, []])
      const before = boundary
        ? IDBKeyRange.bound(prefix, [...prefix, boundary.seq, boundary.messageId], false, true)
        : null
      const count = (store: IDBObjectStore, index: string, selected: IDBKeyRange | null) =>
        selected ? requestValue<number>(store.index(index).count(selected)) : Promise.resolve(0)
      const [baseCount, baseBefore, oldCount, oldBefore, nextCount, nextBefore] = await Promise.all([
        isCleared(threadId) ? 0 : count(base, RELATION_CHILDREN, range),
        isCleared(threadId) ? 0 : count(base, RELATION_CHILDREN, before),
        isCleared(threadId) ? 0 : count(stage, OLD_PARENT_ORDER, range),
        isCleared(threadId) ? 0 : count(stage, OLD_PARENT_ORDER, before),
        count(stage, RELATION_CHILDREN, range),
        count(stage, RELATION_CHILDREN, before),
      ])
      return { count: baseCount - oldCount + nextCount, before: baseBefore - oldBefore + nextBefore }
    },
    put: async (row, body) => {
      const previous = await message(row.messageId)
      const next = {
        ...previous,
        ...row,
        ...(await oldKeys(row.messageId)),
        parentKey: row.parentMessageId ?? '',
        branchKey: row.branchId ?? '',
        pausedKey: Number(row.facts.paused),
        namingRole: row.facts?.autoTitleEligible ? row.facts.role : '',
        conversationKey: Number(row.kind !== 'summary' && row.facts.role !== 'system' && !row.facts.isForkMarker),
        ...(body
          ? {
              tokenPayloadId: uuid(),
              payloadBytes: new TextEncoder().encode(JSON.stringify(body)).length,
            }
          : {}),
      }
      if (!Number.isSafeInteger(next.payloadBytes) || next.payloadBytes! < 0)
        throw new Error('Message payload budget is unavailable')
      await requestValue(stage.put(next))
    },
    remove: async (messageId) => {
      await requestValue(
        stage.put({ sessionId, messageId, ...(await oldKeys(messageId)), deleted: true } satisfies StageRow)
      )
    },
    putThread: async (thread) => {
      changedThreads.set(thread.threadId, thread)
    },
    clearMessages: async (threadId) => {
      if (threadId === undefined) clearAll = true
      else cleared.add(threadId)
    },
  }
  const result = await applyLocalRowMutation(access, diff, commit)
  result.messageMetadata = result.messageMetadata.map(messageMetadata)
  // Clear operations retain their old metadata until planning finishes.
  for (const threadId of clearAll ? [undefined] : [...cleared]) {
    await new Promise<void>((resolve, reject) => {
      const prefix = threadId === undefined ? [sessionId] : [sessionId, threadId]
      const request = base.index(MESSAGE_ORDER_INDEX).openKeyCursor(IDBKeyRange.bound(prefix, [...prefix, []]))
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolve()
        deleteStoredMessage(tx, sessionId, (cursor.primaryKey as string[])[1])
        cursor.continue()
      }
    })
  }
  await new Promise<void>((resolve, reject) => putStoredMessages(tx, diff.messages.upsert, resolve, reject, false))
  await new Promise<void>((resolve, reject) => {
    const request = stage.openCursor(sessionRange(sessionId))
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return resolve()
      const staged = cursor.value as StageRow
      const row = metadata(staged)
      if (row) base.put(row)
      else deleteStoredMessage(tx, sessionId, staged.messageId)
      cursor.delete()
      cursor.continue()
    }
  })
  for (const thread of changedThreads.values()) {
    threads.put(thread)
    putTranscriptThread(tx, thread)
  }
  for (const id of diff.threads.delete) {
    threads.delete([sessionId, id])
    tx.objectStore(TRANSCRIPT_THREADS).delete([sessionId, id])
  }
  if (diff.deleteArchivedThreads) {
    await new Promise<void>((resolve, reject) => {
      const request = threads.index(SESSION_INDEX).openCursor(sessionId)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolve()
        const row = cursor.value as ThreadRow
        if (row.seq !== -2 && row.threadId !== commit.record.activeThreadId) {
          cursor.delete()
          tx.objectStore(TRANSCRIPT_THREADS).delete([sessionId, row.threadId])
        }
        cursor.continue()
      }
    })
  }
  return result
}

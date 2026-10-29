import { loadTreeLinks } from './session-row-idb-links'
import { v4 as uuid } from 'uuid'
import { prepareThreadLinksWriteSet } from '@chatbox/core/persistence'
import type { SessionRowCommit, SessionRowsDiff } from '@chatbox/core/ports'
import type { ThreadRow } from '@chatbox/core/session/session-tree'
import {
  SESSION_ROW_THREAD_STORE,
  SESSION_INDEX,
  REVISION_HEAD_THREAD_ID,
  isRevisionHeadRow,
} from './session-row-idb-records'
import { requestValue } from './session-row-idb-transcript'
import { deleteStoredMessage, putStoredMessages, messageMetadata } from './session-row-idb-messages'
import { MESSAGE_TREE, readTreeMessage, encodeTreeMetadata } from './session-row-idb-tree'

/** The transaction owns its write set; the persistent mutation stage is intentionally unused. */
export async function applyIndexedDBLocalMutation(
  tx: IDBTransaction,
  diff: SessionRowsDiff,
  commit: SessionRowCommit,
  expectedRevision: number
) {
  const sessionId = diff.sessionId
  const tree = tx.objectStore(MESSAGE_TREE)
  const threads = tx.objectStore(SESSION_ROW_THREAD_STORE)
  const threadIds = async () =>
    (await requestValue<ThreadRow[]>(threads.index(SESSION_INDEX).getAll(sessionId)))
      .filter((row) => !isRevisionHeadRow(row))
      .map((row) => row.threadId)
  const plan = await prepareThreadLinksWriteSet(
    {
      yieldTask: async () => {
        await requestValue(threads.get([sessionId, REVISION_HEAD_THREAD_ID]))
      },
      thread: async (id) => (await requestValue<ThreadRow | undefined>(threads.get([sessionId, id]))) ?? null,
      message: (id) => readTreeMessage(tx, sessionId, id),
      threadIds,
      loadThreadLinks: (threadId) => loadTreeLinks(tx, sessionId, threadId, expectedRevision),
    },
    diff,
    commit
  )
  for (const id of plan.deleted) deleteStoredMessage(tx, sessionId, id)
  for (const [id, row] of plan.metadata) {
    const previous = await readTreeMessage(tx, sessionId, id)
    const body = plan.bodies.get(id)
    const payloadBytes = body ? new TextEncoder().encode(JSON.stringify(body)).length : previous!.payloadBytes
    tree.put(encodeTreeMetadata({ ...row, payloadBytes, tokenPayloadId: body ? uuid() : previous?.tokenPayloadId }))
    if (body)
      await new Promise<void>((resolve, reject) =>
        putStoredMessages(tx, [{ ...row, message: body }], resolve, reject, false)
      )
  }
  for (const thread of plan.threads.values()) {
    threads.put(thread)
  }
  const removed = new Set(diff.threads.delete)
  if (diff.deleteArchivedThreads)
    for (const id of await threadIds()) if (id !== commit.record.activeThreadId) removed.add(id)
  for (const id of removed) {
    threads.delete([sessionId, id])
    tree.delete(IDBKeyRange.bound([sessionId, id], [sessionId, id, []]))
  }
  return {
    result: { ...plan.result, messageMetadata: plan.result.messageMetadata.map(messageMetadata) },
    graphs: plan.graphs,
  }
}

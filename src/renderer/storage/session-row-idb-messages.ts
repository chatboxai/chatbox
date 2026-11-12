import { treeMessageRequest, decodeTreeMetadata, MESSAGE_TREE } from './session-row-idb-tree'
import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { MessageRowMetadata } from '@chatbox/core/session/session-tree'
import { putTranscriptMessage } from './session-row-idb-transcript'
import { SESSION_ROW_MESSAGE_STORE, SESSION_ROW_TOKEN_CACHE_STORE } from './session-row-idb-records'

export type StoredMessageRow = MessageRow

export function readStoredMessage(
  tx: IDBTransaction,
  row: StoredMessageRow,
  done: (row: MessageRow) => void,
  fail: (error: unknown) => void
): void {
  if (!row.message || row.message.id !== row.messageId) {
    fail(new Error('Message body is missing or has an inconsistent identity'))
    return
  }
  const request = treeMessageRequest(tx, row.sessionId, row.messageId)
  request.onerror = () => fail(request.error)
  request.onsuccess = () => {
    if (!request.result) {
      fail(new Error('Message metadata is missing'))
      return
    }
    done({ ...messageMetadata(decodeTreeMetadata(request.result)), message: row.message })
  }
}

export function putStoredMessages(
  tx: IDBTransaction,
  rows: Iterable<MessageRow>,
  done: () => void,
  fail: (error: unknown) => void,
  publishMetadata = true
): void {
  const iterator = rows[Symbol.iterator]()
  const next = () => {
    try {
      const item = iterator.next()
      if (item.done) return done()
      const row = item.value
      if (!row.message || row.message.id !== row.messageId) throw new Error('Message body identity is inconsistent')
      if (publishMetadata) putTranscriptMessage(tx, row)
      const request = tx.objectStore(SESSION_ROW_MESSAGE_STORE).put({ ...messageMetadata(row), message: row.message })
      request.onsuccess = next
      request.onerror = () => fail(request.error)
    } catch (error) {
      fail(error)
    }
  }
  next()
}

export function deleteStoredMessage(tx: IDBTransaction, sessionId: string, messageId: string): void {
  tx.objectStore(SESSION_ROW_MESSAGE_STORE).delete([sessionId, messageId])
  const request = treeMessageRequest(tx, sessionId, messageId)
  request.onsuccess = () => {
    if (request.result) tx.objectStore(MESSAGE_TREE).delete([sessionId, request.result.threadId, messageId])
  }
  tx.objectStore(SESSION_ROW_TOKEN_CACHE_STORE).delete(
    IDBKeyRange.bound([sessionId, messageId], [sessionId, messageId, []])
  )
}

/** Physical index fields are not part of a logical message row. */
export function messageMetadata(
  value: MessageRowMetadata & { tokenPayloadId?: string; payloadBytes?: number }
): MessageRowMetadata {
  const { tokenPayloadId: _tokenPayloadId, selected: _selected, payloadBytes: _bytes, ...metadata } = value
  return metadata
}

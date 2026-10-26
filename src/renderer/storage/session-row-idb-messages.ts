import type { MessageRow } from '@chatbox/core/session/session-tree'
import type { MessageRowMetadata } from '@chatbox/core/session/session-tree'
import { putTranscriptMessage, TRANSCRIPT_MESSAGES } from './session-row-idb-transcript'
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
  const request = tx.objectStore(TRANSCRIPT_MESSAGES).get([row.sessionId, row.messageId])
  request.onerror = () => fail(request.error)
  request.onsuccess = () => {
    if (!request.result && row.selected !== undefined) {
      fail(new Error('Message metadata is missing'))
      return
    }
    done({ ...messageMetadata(row), ...(request.result ? messageMetadata(request.result) : {}), message: row.message })
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
      const request = tx.objectStore(SESSION_ROW_MESSAGE_STORE).put(row)
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
  tx.objectStore(TRANSCRIPT_MESSAGES).delete([sessionId, messageId])
  tx.objectStore(SESSION_ROW_TOKEN_CACHE_STORE).delete(
    IDBKeyRange.bound([sessionId, messageId], [sessionId, messageId, []])
  )
}

/** Physical index fields are not part of a logical message row. */
export function messageMetadata(
  value: MessageRowMetadata & {
    navigation?: unknown
    tokenPayloadId?: string
    payloadBytes?: number
    selectedDepth?: number | null
    parentKey?: string
    branchKey?: string
    pausedKey?: number
    conversationKey?: number
    namingRole?: string
  }
): MessageRowMetadata {
  const {
    navigation: _navigation,
    tokenPayloadId: _tokenPayloadId,
    payloadBytes: _bytes,
    selectedDepth: _depth,
    parentKey: _parent,
    branchKey: _branch,
    pausedKey: _paused,
    conversationKey: _conversation,
    namingRole: _naming,
    ...metadata
  } = value
  return metadata
}

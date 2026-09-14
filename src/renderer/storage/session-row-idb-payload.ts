import { v4 as uuid } from 'uuid'
import { fitsInlineBackupJson, jsonUtf8Blocks, throwIfAborted } from '@chatbox/core/backup'
import type { MessageRow } from '@chatbox/core/session/session-tree'
import {
  SESSION_ROW_MESSAGE_STORE as MESSAGES,
  SESSION_ROW_PAYLOAD_STORE as PAYLOADS,
  MESSAGE_PAYLOAD_INDEX,
} from './session-row-idb-records'

export interface PayloadRef {
  id: string
  size: number
  count: number
}
export type StoredMessageRow = Omit<MessageRow, 'message'> & { message?: MessageRow['message']; payload?: PayloadRef }
export interface PayloadChunk {
  payloadId: string
  index: number
  sessionId: string
  data: Uint8Array
}
export const payloadRange = (id: string) => IDBKeyRange.bound([id], [id, []])
function validatePayload(ref: PayloadRef) {
  if (
    typeof ref.id !== 'string' ||
    !ref.id.length ||
    ref.id.length > 1024 ||
    !Number.isSafeInteger(ref.size) ||
    ref.size < 1 ||
    !Number.isSafeInteger(ref.count) ||
    ref.count < 1 ||
    ref.count > 100_000
  )
    throw new Error('Invalid IndexedDB payload manifest')
}

export function readStoredMessage(
  tx: IDBTransaction,
  row: StoredMessageRow,
  done: (row: MessageRow) => void,
  fail: (error: unknown) => void
) {
  if (!row.payload) {
    done(row as MessageRow)
    return
  }
  const ref = row.payload
  try {
    validatePayload(ref)
  } catch (error) {
    fail(error)
    return
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const parts: string[] = []
  let count = 0
  let size = 0
  const request = tx.objectStore(PAYLOADS).openCursor(payloadRange(ref.id))
  request.onsuccess = () => {
    try {
      const cursor = request.result
      if (!cursor) {
        if (count !== ref.count || size !== ref.size) throw new Error('IndexedDB message payload is incomplete')
        parts.push(decoder.decode())
        const { payload, ...metadata } = row
        done({ ...metadata, message: JSON.parse(parts.join('')) as MessageRow['message'] })
        return
      }
      const chunk = cursor.value as PayloadChunk
      if (
        chunk.index !== count ||
        chunk.sessionId !== row.sessionId ||
        !(chunk.data instanceof Uint8Array) ||
        chunk.data.length > 128 * 1024
      )
        throw new Error('Invalid IndexedDB message payload block')
      count++
      size += chunk.data.length
      if (count > ref.count || size > ref.size) throw new Error('IndexedDB message payload exceeds manifest')
      parts.push(decoder.decode(chunk.data, { stream: true }))
      cursor.continue()
    } catch (error) {
      fail(error)
    }
  }
}

function deleteOldPayload(tx: IDBTransaction, sessionId: string, messageId: string) {
  const request = tx
    .objectStore(MESSAGES)
    .index(MESSAGE_PAYLOAD_INDEX)
    .openKeyCursor(IDBKeyRange.bound([sessionId, messageId], [sessionId, messageId, []]))
  request.onsuccess = () => {
    const key = request.result?.key
    if (Array.isArray(key) && typeof key[2] === 'string') tx.objectStore(PAYLOADS).delete(payloadRange(key[2]))
  }
}

export function putStoredMessages(
  tx: IDBTransaction,
  rows: Iterable<MessageRow>,
  done: () => void,
  fail: (error: unknown) => void
) {
  const iterator = rows[Symbol.iterator]()
  const nextRow = () => {
    try {
      const next = iterator.next()
      if (next.done) {
        done()
        return
      }
      const row = next.value
      deleteOldPayload(tx, row.sessionId, row.messageId)
      if (fitsInlineBackupJson(row, 128 * 1024)) {
        tx.objectStore(MESSAGES).put(row).onsuccess = nextRow
        return
      }
      const payload: PayloadRef = { id: uuid(), size: 0, count: 0 }
      const chunks = jsonUtf8Blocks(row.message)
      const nextChunk = () => {
        try {
          const part = chunks.next()
          if (part.done) {
            const { message, ...metadata } = row
            tx.objectStore(MESSAGES).put({ ...metadata, payload } satisfies StoredMessageRow).onsuccess = nextRow
            return
          }
          if (payload.count >= 100_000) throw new Error('IndexedDB message payload exceeds block budget')
          payload.size += part.value.length
          tx
            .objectStore(PAYLOADS)
            .add({
              payloadId: payload.id,
              index: payload.count++,
              sessionId: row.sessionId,
              data: part.value,
            } satisfies PayloadChunk).onsuccess = nextChunk
        } catch (error) {
          fail(error)
        }
      }
      nextChunk()
    } catch (error) {
      fail(error)
    }
  }
  nextRow()
}

export function deleteStoredMessage(tx: IDBTransaction, sessionId: string, messageId: string) {
  deleteOldPayload(tx, sessionId, messageId)
  tx.objectStore(MESSAGES).delete([sessionId, messageId])
}

export async function* readBackupPayload(
  db: IDBDatabase,
  sessionId: string,
  ref: PayloadRef,
  signal?: AbortSignal
): AsyncGenerator<Uint8Array> {
  validatePayload(ref)
  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(PAYLOADS, 'readonly')
    const request = tx.objectStore(PAYLOADS).count(payloadRange(ref.id))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
  if (count !== ref.count) throw new Error('IndexedDB backup payload block count mismatch')
  let size = 0
  for (let index = 0; index < ref.count; index++) {
    throwIfAborted(signal)
    const chunk = await new Promise<PayloadChunk>((resolve, reject) => {
      const tx = db.transaction(PAYLOADS, 'readonly')
      const request = tx.objectStore(PAYLOADS).get([ref.id, index])
      tx.oncomplete = () => resolve(request.result as PayloadChunk)
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
    if (
      !chunk ||
      chunk.sessionId !== sessionId ||
      !(chunk.data instanceof Uint8Array) ||
      chunk.data.length > 128 * 1024
    )
      throw new Error('Invalid IndexedDB backup payload block')
    size += chunk.data.length
    if (size > ref.size) throw new Error('IndexedDB backup payload exceeds manifest')
    yield chunk.data
  }
  if (size !== ref.size) throw new Error('IndexedDB backup payload is incomplete')
}

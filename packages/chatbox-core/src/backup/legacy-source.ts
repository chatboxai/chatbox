import { type Message, type Session, SessionSchema } from '@shared/types'
import { migrateMessage } from '@shared/utils/message'
import { migrateSession } from '../application/session/compatibility/session-load'
import { encodeSessionTree } from '../session/session-tree/encode'
import { throwIfAborted } from './abort'
import { jsonUtf8Blocks } from './json-stream'
import { legacyMessageChunks } from './legacy-message'
import { BackupMessageValidator } from './payload'
import { BackupReadError } from './read-error'
import type { BackupRow, BackupSessionStore } from './session-port'
import { compareBackupIds } from './sharded-format'
import { type BackupFile, readBackupFileBytes } from './types'

/** Open returns a repeatable view for the duration of the exclusive backup operation.
 * IndexedDB can instead materialize its historical structured-clone value once per scan. */
export interface LegacyBackupSource {
  listSessionIds(): Promise<string[]>
  open?(id: string): Promise<BackupFile | null>
  readValue?(id: string): Promise<Session | null>
}
export class LegacyBackupTopologyError extends Error {
  constructor(readonly topologyReason: string) {
    super(`Legacy session topology is invalid: ${topologyReason}`)
    this.name = 'LegacyBackupTopologyError'
  }
}

const BLOCK = 64 * 1024
const MAX_STRUCTURE = 16 * 1024 * 1024
interface Range {
  start: number
  end: number
  legacy?: Message
}
type Frame = { array: boolean; path: Array<string | number>; key?: string; index: number; expectingKey: boolean }
function messagePath(path: Array<string | number>) {
  return (
    (path.length === 2 && path[0] === 'messages' && typeof path[1] === 'number') ||
    (path.length === 4 &&
      path[0] === 'threads' &&
      typeof path[1] === 'number' &&
      path[2] === 'messages' &&
      typeof path[3] === 'number') ||
    (path.length === 6 &&
      path[0] === 'messageForksHash' &&
      path[2] === 'lists' &&
      typeof path[3] === 'number' &&
      path[4] === 'messages' &&
      typeof path[5] === 'number')
  )
}
async function* rangeBytes(file: BackupFile, start: number, end: number, signal?: AbortSignal) {
  for (let offset = start; offset < end; offset += BLOCK) {
    throwIfAborted(signal)
    yield await readBackupFileBytes(file, offset, Math.min(BLOCK, end - offset))
  }
}

/** Retains only the bounded topology and message projections; bodies remain in the source. */
async function scanLegacy(file: BackupFile, signal?: AbortSignal) {
  const frames: Frame[] = []
  const ranges = new Map<string, Range>()
  const exterior: string[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let structureBytes = 0
  const retain = (text: string) => {
    structureBytes += text.length * 2
    if (structureBytes > MAX_STRUCTURE) throw new Error('Legacy backup topology exceeds budget')
    exterior.push(text)
  }
  let quoted = false
  let escaped = false
  let key = ''
  let readingKey = false
  let message: { start: number; depth: number; validator: BackupMessageValidator } | undefined
  for (let offset = 0; offset < file.size; offset += BLOCK) {
    throwIfAborted(signal)
    const bytes = await readBackupFileBytes(file, offset, Math.min(BLOCK, file.size - offset))
    let segment = 0
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i]
      if (message) {
        if (quoted) {
          if (escaped) escaped = false
          else if (c === 92) escaped = true
          else if (c === 34) quoted = false
        } else if (c === 34) quoted = true
        else if (c === 123 || c === 91) message.depth++
        else if (c === 125 || c === 93) {
          if (--message.depth === 0) {
            message.validator.write(bytes.subarray(segment, i + 1))
            const { message: value, addContentParts } = message.validator.finishLegacy()
            if (ranges.has(value.id)) throw new Error('Legacy backup contains duplicate message IDs')
            const legacy = addContentParts || 'content' in value || 'webBrowsing' in value ? value : undefined
            ranges.set(value.id, { start: message.start, end: offset + i + 1, legacy })
            retain(
              JSON.stringify(legacy ? migrateMessage({ ...legacy, contentParts: [...legacy.contentParts] }) : value)
            )
            message = undefined
            segment = i + 1
          }
        }
        continue
      }
      const frame = frames.at(-1)
      if (quoted) {
        if (readingKey) {
          key += String.fromCharCode(c)
          if (key.length > 8192) throw new Error('Legacy backup key exceeds budget')
        }
        if (escaped) escaped = false
        else if (c === 92) escaped = true
        else if (c === 34) {
          quoted = false
          if (readingKey && frame) {
            // JSON key bytes may contain UTF-8, so decode them before parsing.
            frame.key = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(key, (char) => char.charCodeAt(0)))
            )
            frame.expectingKey = false
            readingKey = false
          }
        }
        continue
      }
      if (c === 34) {
        quoted = true
        readingKey = Boolean(frame && !frame.array && frame.expectingKey)
        key = readingKey ? '"' : ''
      } else if (c === 123 || c === 91) {
        const path = frame ? [...frame.path, frame.array ? frame.index : (frame.key ?? '')] : []
        if (c === 123 && messagePath(path)) {
          retain(decoder.decode(bytes.subarray(segment, i), { stream: true }))
          message = { start: offset + i, depth: 1, validator: new BackupMessageValidator() }
          segment = i
        } else {
          if (frames.length >= 128) throw new Error('Legacy backup nesting exceeds budget')
          frames.push({ array: c === 91, path, index: 0, expectingKey: c === 123 })
        }
      } else if (c === 125 || c === 93) frames.pop()
      else if (c === 44 && frame) {
        if (frame.array) frame.index++
        else frame.expectingKey = true
      }
    }
    if (message) message.validator.write(bytes.subarray(segment))
    else retain(decoder.decode(bytes.subarray(segment), { stream: true }))
  }
  if (message || quoted || frames.length) throw new Error('Legacy session JSON is incomplete')
  retain(decoder.decode())
  const session: unknown = JSON.parse(exterior.join(''))
  if (!SessionSchema.safeParse(session).success) throw new Error('Legacy session structure is invalid')
  return { session: session as Session, ranges }
}

/** Combines row storage with a read-only legacy fallback; never triggers migration. */
export function legacyBackupSource(rows: BackupSessionStore, source: LegacyBackupSource): BackupSessionStore {
  return {
    async listSessionIds() {
      return [...new Set([...(await rows.listSessionIds()), ...(await source.listSessionIds())])]
    },
    beginBackupRestore: (id) => rows.beginBackupRestore(id),
    async readLegacySession(id, maxBytes, signal) {
      throwIfAborted(signal)
      if ((await rows.listSessionIds()).includes(id)) return null
      const file = await source.open?.(id)
      let value: Session | null | undefined
      if (file) {
        // 孤立分支仍可能保存用户消息，不能为通过树校验而删除；仅在有界范围内读取完整旧 JSON。
        if (file.size > maxBytes) throw new Error('Legacy conversation exceeds the single-file backup limit')
        const bytes = new Uint8Array(file.size)
        let offset = 0
        for await (const chunk of rangeBytes(file, 0, file.size, signal)) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } else value = await source.readValue?.(id)
      if (!value) return null
      let size = 0
      for (const chunk of jsonUtf8Blocks(value)) {
        throwIfAborted(signal)
        size += chunk.length
        if (size > maxBytes) throw new Error('Legacy conversation exceeds the single-file backup limit')
      }
      if (!SessionSchema.safeParse(value).success) throw new Error('Legacy session structure is invalid')
      if (value.id !== id)
        throw new BackupReadError('session-id-mismatch', 'Legacy session ID does not match its storage key')
      return migrateSession(value)
    },
    async *iterateBackupRows(id, limits, signal): AsyncGenerator<BackupRow> {
      if ((await rows.listSessionIds()).includes(id)) {
        yield* rows.iterateBackupRows(id, limits, signal)
        return
      }
      throwIfAborted(signal)
      const file = await source.open?.(id)
      const scanned = file ? await scanLegacy(file, signal) : undefined
      const value = scanned?.session ?? (await source.readValue?.(id))
      const session = value && !scanned ? migrateSession(value) : value
      if (!session) throw new BackupReadError('session-missing', 'Legacy session data is missing')
      if (session.id !== id)
        throw new BackupReadError('session-id-mismatch', 'Legacy session ID does not match its storage key')
      const encoded = encodeSessionTree(session, { activeThreadId: `backup-active:${id}`, now: 0 })
      if (!encoded.ok) throw new LegacyBackupTopologyError(encoded.reason)
      const { tree } = encoded
      yield { kind: 'header', record: tree.session }
      for (const thread of tree.threads.sort((a, b) => a.seq - b.seq)) {
        throwIfAborted(signal)
        yield { kind: 'thread', thread }
      }
      for (const message of tree.messages.sort((a, b) => compareBackupIds(a.threadId, b.threadId) || a.seq - b.seq)) {
        throwIfAborted(signal)
        const range = scanned?.ranges.get(message.messageId)
        if (file && !range) throw new Error('Legacy message source is missing')
        yield {
          kind: 'message',
          message,
          payload: {
            size: range && !range.legacy ? range.end - range.start : undefined,
            chunks:
              file && range
                ? () =>
                    range.legacy
                      ? legacyMessageChunks(file, range.start, range.end, range.legacy, signal)
                      : rangeBytes(file, range.start, range.end, signal)
                : async function* () {
                    yield* jsonUtf8Blocks(message.message)
                  },
          },
        }
      }
    },
  }
}

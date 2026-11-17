import { emptyBackupCounts, parseBackupRecord, resolveBackupLimits } from '../backup-v3/schema'
import { encodeJson, sourceChunks } from '../backup-v3/streams'
import type { BackupProgress, BackupSession, BackupThread } from '../backup-v3/types'
import type { Message } from '../types/session'
import { throwIfAborted } from '../utils/abort'
import { createTaskYielder } from '../utils/task-yield'
import { createLegacySessionWriter, type LegacySessionWriter } from './session'
import type { BackupExportOptions, BackupExportResult } from './types'

function conversationHeader(session: BackupSession): BackupSession {
  const { id, name, type, starred, hidden, activeThreadId } = session
  return { id, name, type, starred, hidden, activeThreadId }
}

function conversationMessage(message: Message): Message {
  const { id, role, name, reasoningContent, timestamp, updatedAt, isSummary, model, aiProvider } = message
  return {
    id,
    role,
    name,
    reasoningContent,
    timestamp,
    updatedAt,
    isSummary,
    model,
    aiProvider,
    contentParts: message.contentParts.flatMap((part): Message['contentParts'] => {
      if (part.type === 'text' && !part.protocolOnly) return [{ type: 'text', text: part.text }]
      if (part.type === 'reasoning' && !part.protocolOnly)
        return [{ type: 'reasoning', text: part.text, startTime: part.startTime, duration: part.duration }]
      return []
    }),
  }
}

function conversationThread(thread: BackupThread): BackupThread {
  const { sessionId, threadId, threadOrder, name, createdAt, rootMessageId, compactionPoints } = thread
  return { sessionId, threadId, threadOrder, name, createdAt, rootMessageId, compactionPoints }
}

/** Emits the released V1 key/value JSON contract from conversation rows. */
export async function* exportBackupV1Stream(
  options: Omit<BackupExportOptions, 'output'>
): AsyncGenerator<Uint8Array, BackupExportResult> {
  const { source, workspace, signal } = options
  const selection = { ...options.selection, sessions: true, settings: false, copilots: false, credentials: false }
  const selected = selection.sessionIds ? new Set(selection.sessionIds) : undefined
  const limits = resolveBackupLimits(options.limits)
  const counts = emptyBackupCounts()
  const metadata = new Map<string, Omit<BackupSession, 'activeThreadId'> & { sortOrder: number; createdAt: number }>()
  let metadataBytes = 0
  let bytesWritten = 0
  let active: { id: string; writer: LegacySessionWriter } | undefined
  let result: BackupExportResult | undefined
  let failure: unknown
  let notifiedAt = 0
  const yieldTask = createTaskYielder()
  const notify = (phase: BackupProgress['phase']) => {
    const now = Date.now()
    if (phase === 'records' && now - notifiedAt < 100) return
    notifiedAt = now
    try {
      options.onProgress?.({
        phase,
        records: counts.session + counts.thread + counts.message,
        messages: counts.message,
        resources: 0,
        bytes: bytesWritten,
      })
    } catch {
      /* Progress observers do not control the export. */
    }
  }
  const emit = (bytes: Uint8Array) => {
    throwIfAborted(signal)
    bytesWritten += bytes.length
    if (bytesWritten > Math.min(limits.maxDataBytes, limits.maxArchiveBytes, limits.maxUncompressedBytes))
      throw new Error('V1 backup exceeds its byte budget')
    return bytes
  }
  async function* finishSession(): AsyncGenerator<Uint8Array> {
    if (!active) return
    const name = `v1-session-${counts.session}`
    const output = await workspace.createFile(name)
    let size = 0
    try {
      await active.writer.write({
        write: async (bytes) => {
          size += bytes.length
          if (size + bytesWritten > limits.maxDataBytes) throw new Error('V1 backup exceeds its byte budget')
          await output.write(bytes)
        },
        close: async () => {},
        abort: () => output.abort(),
      })
      await output.close()
    } catch (error) {
      try {
        await output.abort()
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Conversation export failed and temporary cleanup is incomplete')
      }
      throw error
    }
    yield emit(encodeJson(`session:${active.id}`))
    yield emit(new Uint8Array([58]))
    const file = await workspace.openFile(name)
    try {
      for await (const bytes of sourceChunks(file, signal)) yield emit(bytes)
    } finally {
      await file.close()
    }
    yield emit(new Uint8Array([44]))
    active = undefined
  }
  notify('preparing')
  try {
    throwIfAborted(signal)
    yield emit(
      encodeJson({
        configVersion: 15,
        __exported_items: ['conversations'],
        __exported_at: options.createdAt ?? new Date().toISOString(),
      }).slice(0, -1)
    )
    yield emit(new Uint8Array([44]))
    for await (const input of source.records(selection, signal)) {
      throwIfAborted(signal)
      if (input.type === 'global') continue
      if (input.type === 'warning') {
        counts.warning++
        continue
      }
      const record = parseBackupRecord(input)
      if (encodeJson(record).length > limits.maxRecordBytes) throw new Error('Backup record exceeds its byte budget')
      if (record.type === 'session') {
        yield* finishSession()
        const session = conversationHeader(record.session)
        if (selected && !selected.has(session.id))
          throw new Error('The export source included an unselected conversation')
        if (metadata.has(session.id)) throw new Error('A conversation was exported more than once')
        const { activeThreadId: _activeThreadId, ...header } = session
        const meta = {
          ...header,
          sortOrder: record.meta?.sortOrder ?? metadata.size,
          createdAt: record.meta?.createdAt ?? 0,
        }
        metadataBytes += encodeJson(meta).length
        if (metadataBytes > limits.maxGlobalBytes) throw new Error('Conversation list exceeds its byte budget')
        metadata.set(session.id, meta)
        counts.session++
        active = {
          id: session.id,
          writer: await createLegacySessionWriter({
            session,
            workspace,
            fileName: `v1-messages-${counts.session}`,
            signal,
            maxBytes: limits.maxDataBytes - bytesWritten,
          }),
        }
      } else if (record.type === 'thread' || record.type === 'message') {
        if (!active) throw new Error('Backup conversation header is missing')
        await active.writer.append(
          record.type === 'thread'
            ? { type: 'thread', thread: conversationThread(record.thread) }
            : { type: 'message', message: { ...record.message, message: conversationMessage(record.message.message) } }
        )
        counts[record.type]++
      }
      notify('records')
      await yieldTask()
    }
    yield* finishSession()
    if (selected && selected.size !== metadata.size) throw new Error('A selected conversation is missing')
    yield emit(new TextEncoder().encode('"chat-sessions-list":['))
    let first = true
    for (const meta of metadata.values()) {
      if (!first) yield emit(new Uint8Array([44]))
      yield emit(encodeJson(meta))
      first = false
    }
    yield emit(new TextEncoder().encode(']}'))
    throwIfAborted(signal)
    result = {
      manifest: null,
      complete: {
        archiveId: options.archiveId,
        counts,
        resourceBytes: 0,
        dataBytes: bytesWritten,
        entryCount: 1,
        uncompressedBytes: bytesWritten,
      },
      cleanupPending: false,
    }
    notify('complete')
    return result
  } catch (error) {
    failure = error
    throw error
  } finally {
    const cleanup = await Promise.allSettled([active?.writer.abort(), workspace.dispose()])
    const errors = cleanup.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason)
    if (errors.length) {
      if (result) result.cleanupPending = true
      else {
        // biome-ignore lint/correctness/noUnsafeFinally: Preserve the original failure together with cleanup errors.
        throw new AggregateError(
          [...(failure === undefined ? [] : [failure]), ...errors],
          'Backup export failed and temporary cleanup is incomplete'
        )
      }
    }
  }
}

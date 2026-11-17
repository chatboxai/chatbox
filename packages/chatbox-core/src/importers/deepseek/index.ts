import { createSessionMetaRecord } from '../../application/session/session-metadata'
import type { BackupHostOptions } from '../../backup-host'
import type { BackupCodec, BackupWorkspace } from '../../backup-v3'
import { type ByteSource, readFileBytes, readZipFileEntries } from '../../io'
import { isAbortError, throwIfAborted } from '../../utils/abort'
import { createTaskYielder } from '../../utils/task-yield'
import { convertDeepSeekSession, type SourceFile, sourceSession } from './convert'

export { type ImportedSource, sourcesSchema } from './convert'
export interface DeepSeekImportIssue {
  session?: string
  code: string
  detail?: string
}
export interface DeepSeekImportResult {
  total: number
  processed: number
  importedSessions: number
  importedMessages: number
  importedImages: number
  skippedSessions: number
  issueCount: number
  issues: DeepSeekImportIssue[]
  cancelled: boolean
  error?: string
  firstSessionId?: string
  cleanupPending?: boolean
  refreshPending?: boolean
}
export interface DeepSeekImportProgress {
  phase: 'reading' | 'importing'
  total: number
  processed: number
  importedSessions: number
}
export interface DeepSeekArchive {
  sessions: { path: string; file: string }[]
}
export interface DeepSeekImportHost {
  jobId: string
  workspace: BackupWorkspace
  rows: Pick<BackupHostOptions['rows'], 'initialize' | 'stageImportRows'>
  metadata: Pick<BackupHostOptions['metadata'], 'createMany'>
  resources: BackupHostOptions['resources']
  getSettings?: BackupHostOptions['getSettings']
}
const decode = (bytes: Uint8Array, codec?: BackupCodec) =>
  codec ? codec.decodeUtf8(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
async function readJson(workspace: BackupWorkspace, name: string, codec?: BackupCodec): Promise<unknown> {
  const file = await workspace.openFile(name)
  try {
    return JSON.parse(decode(await readFileBytes(file, 0, file.size), codec))
  } finally {
    await file.close()
  }
}

export async function inspectDeepSeekArchive(
  source: ByteSource,
  signal?: AbortSignal,
  codec?: BackupCodec
): Promise<number> {
  let version: unknown,
    count = 0
  await readZipFileEntries(
    source,
    (entry) => {
      if (entry.path === 'manifest.json')
        version = (JSON.parse(decode(entry.data, codec)) as { export_format_version?: unknown }).export_format_version
      if (/^chat_sessions\/[^/]+\.json$/.test(entry.path)) count++
    },
    {
      bounded: true,
      signal,
      filter: (path) => path === 'manifest.json' || /^chat_sessions\/[^/]+\.json$/.test(path),
      streamEntry: (path) => path !== 'manifest.json',
      onStreamEntry: async (entry) => {
        count++
        for await (const _ of entry.data) throwIfAborted(signal)
      },
    }
  )
  if (version !== 3) throw new Error('Unsupported DeepSeek export. Please select a version 3 ZIP archive.')
  return count
}

async function extract(
  source: ByteSource,
  workspace: BackupWorkspace,
  signal?: AbortSignal,
  codec?: BackupCodec
): Promise<DeepSeekArchive> {
  const sessions: DeepSeekArchive['sessions'] = []
  let version: unknown,
    sequence = 0
  await readZipFileEntries(
    source,
    (entry) => {
      version = (JSON.parse(decode(entry.data, codec)) as { export_format_version?: unknown }).export_format_version
      if (version !== 3) throw new Error('Unsupported DeepSeek export. Please select a version 3 ZIP archive.')
    },
    {
      bounded: true,
      signal,
      filter: (path) => path === 'manifest.json' || path.startsWith('chat_sessions/'),
      streamEntry: (path) => path !== 'manifest.json',
      onStreamEntry: async (entry) => {
        const name = `deepseek-${sequence++}`
        const sink = await workspace.createFile(name)
        try {
          for await (const chunk of entry.data) {
            throwIfAborted(signal)
            await sink.write(chunk)
          }
          await sink.close()
        } catch (error) {
          await sink.abort()
          throw error
        }
        await workspace.put('deepseek-paths', entry.path.normalize('NFC'), name)
        if (/^chat_sessions\/[^/]+\.json$/.test(entry.path)) sessions.push({ path: entry.path, file: name })
      },
    }
  )
  if (version !== 3) throw new Error('Unsupported DeepSeek export. Please select a version 3 ZIP archive.')
  return { sessions }
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  const text = String.fromCharCode(...bytes)
  if (text.startsWith('GIF8')) return 'image/gif'
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp'
  if (text.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(text.slice(8, 12))) return 'image/avif'
  return null
}

/** Each conversation publishes independently. Cancellation never rolls back published rows. */
export async function importDeepSeekArchive(options: {
  source: ByteSource
  host: DeepSeekImportHost
  createId(): string
  codec?: BackupCodec
  signal?: AbortSignal
  onProgress?(progress: DeepSeekImportProgress): void
  failureLabel: string
}): Promise<DeepSeekImportResult> {
  const { host, signal } = options
  const result: DeepSeekImportResult = {
    total: 0,
    processed: 0,
    importedSessions: 0,
    importedMessages: 0,
    importedImages: 0,
    skippedSessions: 0,
    issueCount: 0,
    issues: [],
    cancelled: false,
  }
  const issue = (value: DeepSeekImportIssue) => {
    result.issueCount++
    if (result.issues.length < 100) result.issues.push(value)
  }
  const notify = (phase: DeepSeekImportProgress['phase']) =>
    options.onProgress?.({
      phase,
      total: result.total,
      processed: result.processed,
      importedSessions: result.importedSessions,
    })
  const yieldTask = createTaskYielder()
  try {
    notify('reading')
    const archive = await extract(options.source, host.workspace, signal, options.codec)
    result.total = archive.sessions.length
    if (!host.rows.stageImportRows) throw new Error('Conversation import is unavailable')
    await host.rows.initialize()
    const batchTime = Date.now()
    for (const [index, entry] of archive.sessions.entries()) {
      throwIfAborted(signal)
      notify('importing')
      const sessionId = options.createId(),
        importedAt = Date.now()
      let writer: Awaited<ReturnType<NonNullable<typeof host.rows.stageImportRows>>> | undefined
      let published = false,
        title = entry.path
      const images = new Map<string, string>()
      try {
        const raw = sourceSession.parse(await readJson(host.workspace, entry.file, options.codec))
        if (raw.id !== entry.path.slice('chat_sessions/'.length, -'.json'.length))
          throw new Error('Conversation identity mismatch')
        title = raw.title || entry.path
        const defaults = host.getSettings?.()
        const converted = await convertDeepSeekSession(raw, {
          sessionId,
          importedAt,
          failureLabel: options.failureLabel,
          signal,
          model: defaults?.defaultChatModel
            ? { provider: defaults.defaultChatModel.provider, modelId: defaults.defaultChatModel.model }
            : undefined,
          issue: (value) => issue({ ...value, session: title }),
          resolveImage: async (file: SourceFile) => {
            throwIfAborted(signal)
            if (images.has(file.id)) return images.get(file.id)!
            const path = file.export_path?.normalize('NFC')
            const sourceId = entry.path.slice('chat_sessions/'.length, -'.json'.length)
            if (!path?.startsWith(`chat_sessions/${sourceId}_files/`)) return null
            const name = await host.workspace.get('deepseek-paths', path)
            if (!name) return null
            const input = await host.workspace.openFile(name)
            try {
              const mimeType = imageMime(await readFileBytes(input, 0, Math.min(16, input.size)))
              if (!mimeType) return null
              const key = `picture:${options.createId()}`
              const sink = await host.resources.stage(host.jobId, {
                type: 'resource',
                resourceId: key,
                path,
                mimeType,
                contentType: 'binary',
                size: input.size,
              })
              try {
                if (input.chunks)
                  for await (const chunk of input.chunks()) {
                    throwIfAborted(signal)
                    await sink.write(chunk)
                  }
                else
                  for (let offset = 0; offset < input.size; offset += 65536) {
                    throwIfAborted(signal)
                    await sink.write(await readFileBytes(input, offset, Math.min(65536, input.size - offset)))
                  }
                await sink.close()
                await host.resources.publish(host.jobId, key)
              } catch (error) {
                await sink.abort().catch(() => {})
                throw error
              }
              images.set(file.id, key)
              return key
            } finally {
              await input.close()
            }
          },
        })
        title = converted.record.name || entry.path
        writer = await host.rows.stageImportRows(converted.record, host.jobId)
        await writer.appendThread(converted.thread)
        for (let offset = 0; offset < converted.rows.length; offset += 128) {
          throwIfAborted(signal)
          await writer.appendRows(
            converted.rows.slice(offset, offset + 128).map((message) => ({ kind: 'message', message }))
          )
          await yieldTask()
        }
        const prepared = await writer.prepare((value) => issue({ session: title, code: value.reason }))
        if (prepared?.skipSession) throw new Error('No usable messages')
        throwIfAborted(signal)
        await writer.publish()
        published = true
        result.importedSessions++
        result.importedMessages += converted.sourceMessageCount
        result.importedImages += images.size
        result.firstSessionId ??= sessionId
        await host.metadata.createMany([
          // Preserve ZIP entry order in Chatbox's descending session list.
          createSessionMetaRecord(converted.record, batchTime - index / Math.max(1, result.total), importedAt),
        ])
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) throw error
        if (!published) result.skippedSessions++
        issue({
          session: title,
          code: published ? 'session-list' : 'skipped-session',
          detail: error instanceof Error ? error.message.slice(0, 300) : 'Import failed',
        })
      } finally {
        if (!published) await writer?.dispose()
      }
      result.processed++
      notify('importing')
      await yieldTask()
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) result.cancelled = true
    else result.error = error instanceof Error ? error.message : 'Import failed'
  } finally {
    try {
      await host.resources.cleanup(host.jobId)
      await host.workspace.dispose()
    } catch {
      result.cleanupPending = true
    }
  }
  return result
}

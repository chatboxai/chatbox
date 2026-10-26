import { sha256 } from '@noble/hashes/sha256'
import { createSessionMetaRecord } from '../application/session/session-metadata'
import { BackupConfigurations, backupResourcePath, backupSessionPath } from '../backup-v3/layout'
import { backupResourceReferences, RecordOrder } from '../backup-v3/records'
import {
  emptyBackupCounts,
  parseBackupManifest,
  parseBackupRecord,
  portableBackupRecord,
  resolveBackupLimits,
} from '../backup-v3/schema'
import { encodeJson, sourceChunks } from '../backup-v3/streams'
import type { BackupProgress, BackupWarningRecord } from '../backup-v3/types'
import { createZipStream, type ByteSink, type ZipArchiveEntry } from '../io'
import type { ResourceReference } from '../resources'
import { throwIfAborted } from '../utils/abort'
import { createTaskYielder } from '../utils/task-yield'
import { createLegacySessionWriter } from './session'
import type {
  BackupExportOptions,
  BackupExportResult,
  LegacyBackupEntry,
  LegacyBackupManifest,
  LegacyBackupSession,
} from './types'

const JSON_BYTES = 128 * 1024 * 1024
const MANIFEST_BYTES = 32 * 1024 * 1024
const MAX_ITEMS = 50_000
type Resource = ResourceReference & { id: string; sessionIds: Set<string>; global: boolean }

/** V2 describes every entry, including its checksum, in the final ZIP manifest. */
export async function* exportBackupV2Stream(
  options: Omit<BackupExportOptions, 'output'>
): AsyncGenerator<Uint8Array, BackupExportResult> {
  const { source, workspace, signal, selection } = options
  const limits = resolveBackupLimits(options.limits)
  limits.maxUncompressedBytes = Math.min(limits.maxUncompressedBytes, 4 * 1024 * 1024 * 1024)
  const counts = emptyBackupCounts()
  const progress: BackupProgress = { phase: 'preparing', records: 0, messages: 0, resources: 0, bytes: 0 }
  let notifiedAt = 0
  const notify = (update: Partial<BackupProgress> = {}) => {
    const changedPhase = update.phase !== undefined && update.phase !== progress.phase
    Object.assign(progress, update)
    const now = Date.now()
    if (!changedPhase && now - notifiedAt < 100) return
    notifiedAt = now
    try {
      options.onProgress?.({ ...progress })
    } catch {
      /* Progress observers do not control the export. */
    }
  }
  const manifest: LegacyBackupManifest = {
    format: 'chatbox-backup',
    formatVersion: 2,
    exportedAt: options.createdAt ?? new Date().toISOString(),
    application: {
      name: 'Chatbox',
      version: options.application?.version ?? options.producer,
      platform: options.application?.platform ?? 'unknown',
    },
    exportItems: [],
    data: {},
    sessions: [],
    resources: [],
    warnings: [],
    stats: { sessionCount: 0, resourceCount: 0, deduplicatedResourceCount: 0, warningCount: 0 },
  }
  if (selection.sessions) manifest.exportItems.push('conversations')
  if (selection.settings) manifest.exportItems.push('setting')
  if (selection.settings && selection.credentials) manifest.exportItems.push('key')
  if (selection.copilots) manifest.exportItems.push('copilot')
  const order = new RecordOrder(
    workspace,
    parseBackupManifest({
      format: 'chatbox-backup',
      formatVersion: 3,
      layout: 'rows',
      archiveId: options.archiveId,
      createdAt: manifest.exportedAt,
      producer: options.producer,
      selection: {
        sessions: selection.sessions,
        settings: selection.settings,
        copilots: selection.copilots,
        credentials: selection.credentials,
      },
    })
  )
  const configurations = new BackupConfigurations(selection)
  const resources = new Map<string, Resource>()
  const sessionResources = new Map<string, Set<string>>()
  const files: Array<{ path: string; name: string }> = []
  const selected = selection.sessionIds ? new Set(selection.sessionIds) : undefined
  let active:
    | {
        writer: Awaited<ReturnType<typeof createLegacySessionWriter>>
        entry: Omit<LegacyBackupSession, 'size' | 'checksum'>
      }
    | undefined
  let globalBytes = 0
  let dataBytes = 0
  let resourceBytes = 0
  let metadataBytes = 0
  let failure: unknown
  let result: BackupExportResult | undefined
  const budgetMetadata = (value: unknown) => {
    metadataBytes += encodeJson(value).length
    if (metadataBytes > MANIFEST_BYTES) throw new Error('Legacy backup manifest exceeds its size limit')
  }
  const checkEntries = () => {
    if (files.length + resources.size + 1 > limits.maxEntries) throw new Error('Backup contains too many ZIP entries')
  }
  const addDataBytes = (bytes: number) => {
    dataBytes += bytes
    if (dataBytes > limits.maxDataBytes || dataBytes + resourceBytes > limits.maxUncompressedBytes)
      throw new Error('Backup data exceeds its byte budget')
  }
  const addWarning = (warning: BackupWarningRecord) => {
    if (manifest.warnings.length >= MAX_ITEMS) throw new Error('Legacy backup contains too many warnings')
    const value: LegacyBackupManifest['warnings'][number] = {
      code: 'external-resource-skipped',
      itemType: 'session',
      itemId: warning.objectId,
      message: warning.message,
    }
    budgetMetadata(value)
    manifest.warnings.push(value)
    counts.warning++
  }
  const writeJson = async (path: string, write: (sink: ByteSink) => Promise<void>): Promise<LegacyBackupEntry> => {
    const name = `legacy-json-${files.length}`
    const sink = await workspace.createFile(name)
    const hash = sha256.create()
    let size = 0
    try {
      await write({
        write: async (bytes) => {
          throwIfAborted(signal)
          size += bytes.length
          if (size > Math.min(JSON_BYTES, limits.maxDataBytes))
            throw new Error('This conversation or configuration is too large for a V2 backup (128 MiB per JSON file).')
          addDataBytes(bytes.length)
          hash.update(bytes)
          await sink.write(bytes)
        },
        close: async () => {},
        abort: () => sink.abort(),
      })
      await sink.close()
      files.push({ path, name })
      checkEntries()
      return {
        path,
        size,
        checksum: {
          algorithm: 'sha256',
          value: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join(''),
        },
      }
    } catch (error) {
      try {
        await sink.abort()
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Backup JSON export failed and temporary cleanup is incomplete')
      }
      throw error
    } finally {
      hash.destroy()
    }
  }
  const finishSession = async () => {
    if (!active) return
    const current = active
    const descriptor = await writeJson(current.entry.path, (sink) => current.writer.write(sink))
    manifest.sessions.push({ ...current.entry, ...descriptor })
    sessionResources.delete(current.entry.id)
    active = undefined
  }
  notify()
  try {
    throwIfAborted(signal)
    for await (const input of source.records(selection, signal)) {
      throwIfAborted(signal)
      const parsed = parseBackupRecord(input)
      if (parsed.type === 'resource') throw new Error('The export source must not supply resources')
      if (parsed.type === 'warning') {
        addWarning(parsed)
        continue
      }
      const portable = portableBackupRecord(parsed)
      const record = portable.record
      if (portable.warning) addWarning(portable.warning)
      await order.accept(record)
      if (encodeJson(record).length > limits.maxRecordBytes) throw new Error('Backup record exceeds its byte budget')
      counts[record.type]++
      if (record.type === 'global') {
        globalBytes += encodeJson(record).length
        if (globalBytes > limits.maxGlobalBytes) throw new Error('Backup globals exceed their byte budget')
        configurations.add(record)
      } else if (record.type === 'session') {
        await finishSession()
        if (selected && !selected.has(record.session.id))
          throw new Error('The export source included an unselected conversation')
        if (counts.session > MAX_ITEMS) throw new Error('Legacy backup contains too many conversations')
        const path = backupSessionPath(record.session.id).replace(/\.jsonl$/, '/session.json')
        if (!(await workspace.put('legacy-paths', path.toLowerCase(), '1')))
          throw new Error('Backup conversation filenames collide')
        const meta = createSessionMetaRecord(
          record.session,
          record.meta?.sortOrder ?? manifest.sessions.length,
          record.meta?.createdAt ?? 0
        )
        budgetMetadata({ path, meta })
        const entry = { path, id: record.session.id, meta, resourceIds: [] as string[] }
        active = {
          entry,
          writer: await createLegacySessionWriter({
            session: record.session,
            workspace,
            fileName: `legacy-payload-${counts.session}`,
            signal,
            maxBytes: Math.min(JSON_BYTES, limits.maxDataBytes - dataBytes),
          }),
        }
        sessionResources.set(record.session.id, new Set())
      } else {
        if (!active) throw new Error('Backup conversation header is missing')
        await active.writer.append(record)
      }
      for (const reference of backupResourceReferences(record)) {
        let resource = resources.get(reference.storageKey)
        if (!resource) {
          if (resources.size >= MAX_ITEMS) throw new Error('Legacy backup contains too many resources')
          const id = `resource-${String(resources.size + 1).padStart(6, '0')}`
          budgetMetadata({ ...reference, id })
          resource = { ...reference, id, sessionIds: new Set(), global: false }
          resources.set(reference.storageKey, resource)
        }
        if (reference.sessionId) {
          const owned = sessionResources.get(reference.sessionId)
          if (!owned || active?.entry.id !== reference.sessionId)
            throw new Error('Backup resource belongs to an unavailable conversation')
          if (!owned.has(resource.id)) {
            budgetMetadata([reference.sessionId, resource.id])
            owned.add(resource.id)
            active.entry.resourceIds.push(resource.id)
            resource.sessionIds.add(reference.sessionId)
          }
        } else resource.global = true
      }
      checkEntries()
      notify({
        phase: 'records',
        records: counts.session + counts.thread + counts.message + counts.global,
        messages: counts.message,
        bytes: dataBytes + globalBytes,
      })
    }
    await finishSession()
    if (selected && selection.sessions && counts.session !== selected.size)
      throw new Error('The export source omitted a selected conversation')
    let configurationBytes = 0
    for (const { path, value } of configurations.files()) {
      const bytes = encodeJson(value)
      configurationBytes += bytes.length
      if (configurationBytes > limits.maxGlobalBytes) throw new Error('Backup globals exceed their byte budget')
      const key = path === 'settings.json' ? 'settings' : path === 'copilots.json' ? 'copilots' : 'sessionSettings'
      manifest.data[key] = await writeJson(path, (sink) => sink.write(bytes))
    }
    async function* entries(): AsyncGenerator<ZipArchiveEntry> {
      for (const file of files) {
        const opened = await workspace.openFile(file.name)
        try {
          yield { path: file.path, data: sourceChunks(opened, signal) }
        } finally {
          await opened.close()
        }
      }
      for (const resource of resources.values()) {
        throwIfAborted(signal)
        notify({ phase: 'resources', resources: counts.resource, bytes: resourceBytes })
        const opened = await source.openResource(resource.storageKey, signal)
        if (!opened) throw new Error(`Missing backup resource: ${resource.storageKey}`)
        const path = backupResourcePath(counts.resource, opened.mimeType)
        const hash = sha256.create()
        let size = 0
        const yieldTask = createTaskYielder()
        async function* chunks() {
          for await (const bytes of sourceChunks(opened!.source, signal)) {
            size += bytes.length
            if (size > Math.min(limits.maxResourceBytes, 512 * 1024 * 1024))
              throw new Error('Legacy backup resource exceeds its size limit')
            if (dataBytes + resourceBytes + size > limits.maxUncompressedBytes)
              throw new Error('Backup exceeds its total uncompressed byte budget')
            hash.update(bytes)
            yield bytes
            notify({ phase: 'resources', bytes: resourceBytes + size })
            await yieldTask()
          }
        }
        try {
          yield { path, compress: false, data: chunks() }
          const sessionIds = [...resource.sessionIds]
          manifest.resources.push({
            path,
            id: resource.id,
            originalStorageKeys: [resource.storageKey],
            sessionIds,
            scope:
              sessionIds.length === 0 ? 'global' : sessionIds.length === 1 && !resource.global ? 'session' : 'shared',
            encoding: opened.contentType === 'text' ? 'utf8' : 'data-url-base64',
            mimeType: opened.mimeType,
            kind: resource.kind,
            ...(resource.filename ? { filename: resource.filename } : {}),
            size,
            checksum: {
              algorithm: 'sha256',
              value: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join(''),
            },
          })
          resourceBytes += size
          counts.resource++
        } finally {
          hash.destroy()
          await opened.source.close()
        }
      }
      manifest.stats = {
        sessionCount: manifest.sessions.length,
        resourceCount: manifest.resources.length,
        deduplicatedResourceCount: 0,
        warningCount: manifest.warnings.length,
      }
      const bytes = encodeJson(manifest)
      if (bytes.length > MANIFEST_BYTES) throw new Error('Legacy backup manifest exceeds its size limit')
      addDataBytes(bytes.length)
      yield { path: 'manifest.json', data: bytes }
    }
    let archiveBytes = 0
    for await (const bytes of createZipStream(entries(), signal, { compressionLevel: options.compressionLevel })) {
      archiveBytes += bytes.length
      if (archiveBytes > limits.maxArchiveBytes) throw new Error('Backup exceeds classic ZIP capacity')
      yield bytes
    }
    throwIfAborted(signal)
    result = {
      manifest,
      complete: {
        archiveId: options.archiveId,
        counts,
        resourceBytes,
        dataBytes,
        entryCount: files.length + resources.size + 1,
        uncompressedBytes: dataBytes + resourceBytes,
      },
      cleanupPending: false,
    }
    notify({ phase: 'complete', bytes: archiveBytes, resources: counts.resource })
    return result
  } catch (error) {
    failure = error
    throw error
  } finally {
    const cleanup = await Promise.allSettled([active?.writer.abort(), workspace.dispose()])
    const errors = cleanup.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason)
    if (errors.length) {
      if (result) result.cleanupPending = true
      else
        throw new AggregateError(
          [...(failure === undefined ? [] : [failure]), ...errors],
          'Backup export failed and temporary cleanup is incomplete'
        )
    }
  }
}

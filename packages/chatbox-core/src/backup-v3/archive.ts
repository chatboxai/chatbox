import {
  createZipStream,
  readZipFileEntries,
  type ByteSink,
  type ByteSource,
  type ZipArchiveEntry,
  type ZipReadOptions,
} from '../io'
import { throwIfAborted } from '../utils/abort'
import { backupResourceReferences, RecordOrder } from './records'
import { BackupImportError } from './errors'
import {
  BackupConfigurations,
  backupResourcePath,
  backupSessionId,
  backupSessionPath,
  configurationKeys,
  configurationRecords,
  isConfigPath,
  RESOURCE_PATH_PATTERN,
  type ConfigPath,
} from './layout'
import {
  emptyBackupCounts,
  parseBackupComplete,
  parseBackupManifest,
  parseBackupRecord,
  portableBackupRecord,
  resolveBackupLimits,
  settleBackupRecord,
} from './schema'
import { countChunks, decodeJson, decodeJsonLines, encodeJson, encodeLine, sourceChunks } from './streams'
import type {
  BackupBusinessRecord,
  BackupComplete,
  BackupImportIssueReporter,
  BackupImportReport,
  BackupStatistics,
  BackupLimits,
  BackupManifest,
  BackupOptions,
  BackupProgress,
  BackupResourceRecord,
  BackupResult,
  ExportBackupV3Options,
  ImportBackupV3Options,
} from './types'

const CONTROL_BYTES = 128 * 1024
const progress = (options: BackupOptions) => {
  const state: BackupProgress = { phase: 'preparing', records: 0, messages: 0, resources: 0, bytes: 0 }
  let lastNotifiedAt = 0
  return (update: Partial<BackupProgress> = {}) => {
    const changedPhase = update.phase !== undefined && update.phase !== state.phase
    Object.assign(state, update)
    const now = Date.now()
    if (!changedPhase && state.phase !== 'complete' && now - lastNotifiedAt < 100) return
    lastNotifiedAt = now
    try {
      options.onProgress?.({ ...state })
    } catch {
      /* Observers do not control storage transactions. */
    }
  }
}
function zipOptions(limits: BackupLimits, signal?: AbortSignal): ZipReadOptions {
  return {
    bounded: true,
    signal,
    limits: {
      maxEntries: limits.maxEntries,
      maxEntryUncompressedBytes: limits.maxResourceBytes,
      maxTotalUncompressedBytes: limits.maxUncompressedBytes,
      maxCompressionRatio: 2000,
    },
    entryLimits: (path) => ({
      maxEntryUncompressedBytes:
        path.startsWith('sessions/') || path === 'resources.jsonl' || path === 'warnings.jsonl'
          ? limits.maxDataBytes
          : isConfigPath(path)
            ? limits.maxGlobalBytes
            : path === 'manifest.json' || path === 'complete.json'
              ? CONTROL_BYTES
              : limits.maxResourceBytes,
    }),
  }
}
function checkTotal(bytes: number, limits: BackupLimits) {
  if (bytes > limits.maxUncompressedBytes) throw new Error('Backup exceeds its total uncompressed byte budget')
}

/** Exports bounded source rows and resources into one archive. */
export async function exportBackupV3(options: ExportBackupV3Options): Promise<BackupResult> {
  const { source, workspace, output, signal } = options
  const limits = resolveBackupLimits(options.limits)
  const notify = progress(options)
  const manifest = parseBackupManifest({
    format: 'chatbox-backup',
    formatVersion: 3,
    layout: 'rows',
    archiveId: options.archiveId,
    createdAt: options.createdAt ?? new Date().toISOString(),
    producer: options.producer,
    selection: {
      sessions: options.selection.sessions,
      settings: options.selection.settings,
      copilots: options.selection.copilots,
      credentials: options.selection.credentials,
    },
  })
  let committed = false
  let cleanupPending = false
  const counts = emptyBackupCounts()
  let complete: BackupStatistics | undefined
  let resourceBytes = 0
  let dataBytes = 0
  let globalBytes = 0
  let resourceCount = 0
  let missingResources = 0
  let configurationCount = 0
  const checkData = (added: number) => {
    dataBytes += added
    if (dataBytes > limits.maxDataBytes) throw new Error('Backup data exceeds its byte budget')
  }
  const entryCount = () => resourceCount + counts.session + configurationCount + (counts.warning ? 1 : 0) + 3
  const checkEntries = () => {
    if (entryCount() > limits.maxEntries) throw new Error('Backup contains too many ZIP entries')
  }
  notify()
  try {
    throwIfAborted(signal)
    const warnings = await workspace.createFile('warnings.jsonl')
    const configurations = new BackupConfigurations(manifest.selection)
    let sessionFile: ByteSink | undefined
    const order = new RecordOrder(workspace, manifest)
    const selected = options.selection.sessionIds ? new Set(options.selection.sessionIds) : undefined
    for await (const input of source.records(options.selection, signal)) {
      throwIfAborted(signal)
      let record = parseBackupRecord(input)
      if (record.type === 'resource') throw new Error('The export source must not supply resource declarations')
      if (record.type !== 'warning') {
        const portable = portableBackupRecord(record)
        record = portable.record
        if (portable.warning) {
          const warningBytes = encodeLine(portable.warning)
          if (warningBytes.length > limits.maxRecordBytes) throw new Error('Backup warning exceeds its byte budget')
          checkData(warningBytes.length)
          await warnings.write(warningBytes)
          counts.warning++
        }
        await order.accept(record)
      }
      if (record.type === 'session' && selected && !selected.has(record.session.id))
        throw new Error('The export source included an unselected session')
      const bytes = encodeLine(record)
      if (bytes.length > limits.maxRecordBytes) throw new Error('Backup record exceeds its byte budget')
      counts[record.type]++
      if (record.type === 'global') {
        globalBytes += bytes.length
        if (globalBytes > limits.maxGlobalBytes) throw new Error('Backup globals exceed their byte budget')
        configurations.add(record)
      } else {
        checkData(bytes.length)
        if (record.type === 'warning') await warnings.write(bytes)
        else {
          if (record.type === 'session') {
            await sessionFile?.close()
            const path = backupSessionPath(record.session.id)
            if (!(await workspace.put('session-paths', path.toLowerCase(), '1')))
              throw new Error('Backup conversation filenames collide')
            const name = `session-${counts.session}.jsonl`
            await workspace.put('session-files', path, name)
            sessionFile = await workspace.createFile(name)
          }
          if (!sessionFile) throw new Error('Backup conversation header is missing')
          await sessionFile.write(bytes)
        }
      }
      if (record.type !== 'warning') {
        for (const reference of backupResourceReferences(record)) {
          if (await workspace.put('resource-refs', reference.storageKey, '1')) resourceCount++
        }
      }
      checkEntries()
      notify({
        phase: 'records',
        records: counts.session + counts.thread + counts.message + counts.global,
        messages: counts.message,
        bytes: dataBytes + globalBytes,
      })
    }
    if (selected && options.selection.sessions && counts.session !== selected.size)
      throw new Error('The export source omitted a selected session')
    await sessionFile?.close()
    await warnings.close()
    let configurationBytes = 0
    for (const { path, value } of configurations.files()) {
      const bytes = encodeJson(value)
      configurationBytes += bytes.length
      if (configurationBytes > limits.maxGlobalBytes) throw new Error('Backup globals exceed their byte budget')
      checkData(bytes.length)
      const file = await workspace.createFile(path)
      await file.write(bytes)
      await file.close()
      await workspace.put('configuration-files', path, path)
      configurationCount++
    }
    checkEntries()

    async function* temporaryFile(name: string): AsyncGenerator<Uint8Array> {
      const file = await workspace.openFile(name)
      try {
        yield* sourceChunks(file, signal)
      } finally {
        await file.close()
      }
    }
    async function* entries(): AsyncGenerator<ZipArchiveEntry> {
      const manifestBytes = encodeJson(manifest)
      if (manifestBytes.length > CONTROL_BYTES) throw new Error('Backup manifest exceeds its byte budget')
      yield { path: 'manifest.json', data: manifestBytes }
      let index = 0
      for await (const { key } of workspace.entries('resource-refs')) {
        throwIfAborted(signal)
        notify({ phase: 'resources', resources: counts.resource, bytes: resourceBytes })
        const opened = await source.openResource(key, signal)
        if (!opened) {
          missingResources++
          resourceCount--
          continue
        }
        const path = backupResourcePath(index++, opened.mimeType)
        let size: number | undefined
        try {
          yield {
            path,
            compress: false,
            data: countChunks(
              sourceChunks(opened.source, signal),
              path,
              limits.maxResourceBytes,
              (value) => {
                size = value
              },
              signal,
              (bytes) => notify({ phase: 'resources', resources: counts.resource, bytes: resourceBytes + bytes })
            ),
          }
        } finally {
          await opened.source.close()
        }
        if (size === undefined) throw new Error('Resource stream was not consumed')
        const resource: BackupResourceRecord = {
          type: 'resource',
          resourceId: key,
          path,
          mimeType: opened.mimeType,
          contentType: opened.contentType,
          size,
        }
        parseBackupRecord(resource)
        const encoded = encodeLine(resource)
        if (encoded.length > limits.maxRecordBytes) throw new Error('Resource description exceeds its byte budget')
        checkData(encoded.length)
        await workspace.put('resource-catalog', key, JSON.stringify(resource))
        counts.resource++
        resourceBytes += size
        checkTotal(manifestBytes.length + resourceBytes + dataBytes, limits)
        notify({ phase: 'resources', resources: counts.resource, bytes: resourceBytes })
      }
      async function* resourceIndex(): AsyncGenerator<Uint8Array> {
        for await (const { value } of workspace.entries('resource-catalog')) yield encodeLine(JSON.parse(value))
      }
      yield { path: 'resources.jsonl', data: resourceIndex() }
      for await (const { key, value } of workspace.entries('configuration-files'))
        yield { path: key, data: temporaryFile(value) }
      for await (const { key, value } of workspace.entries('session-files'))
        yield { path: key, data: temporaryFile(value) }
      if (counts.warning) yield { path: 'warnings.jsonl', data: temporaryFile('warnings.jsonl') }
      complete = {
        archiveId: manifest.archiveId,
        counts,
        resourceBytes,
        dataBytes,
        entryCount: entryCount(),
        uncompressedBytes: manifestBytes.length + resourceBytes + dataBytes,
      }
      const completeBytes = encodeJson(complete)
      checkTotal(complete.uncompressedBytes + completeBytes.length, limits)
      yield { path: 'complete.json', data: completeBytes }
    }
    let outputBytes = 0
    for await (const chunk of createZipStream(entries(), signal, { compressionLevel: options.compressionLevel })) {
      outputBytes += chunk.length
      if (outputBytes > limits.maxArchiveBytes) throw new Error('Backup exceeds classic ZIP capacity')
      await output.write(chunk)
    }
    throwIfAborted(signal)
    if (!complete) throw new Error('Backup completion marker was not written')
    await output.close()
    committed = true
    notify({ phase: 'cleaning' })
    try {
      await workspace.dispose()
    } catch {
      cleanupPending = true
    }
    notify({ phase: 'complete', bytes: outputBytes })
    return { manifest, complete, cleanupPending, missingResources }
  } catch (error) {
    if (!committed) {
      const cleanup = await Promise.allSettled([output.abort(), workspace.dispose()])
      const failures = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason)
      if (failures.length)
        throw new AggregateError([error, ...failures], 'Backup export failed and temporary cleanup is incomplete')
    }
    throw error
  }
}

interface ScannedArchive {
  manifest: BackupManifest
  manifestBytes: number
  entries: number
}
async function scanArchive(source: ByteSource, options: BackupOptions, limits: BackupLimits): Promise<ScannedArchive> {
  if (source.size > limits.maxArchiveBytes) throw new Error('Backup exceeds classic ZIP capacity')
  let manifest: BackupManifest | undefined
  let manifestBytes = 0
  let hasResources = false
  const sessionPaths = new Set<string>()
  let entries = 0
  await readZipFileEntries(
    source,
    (entry) => {
      if (entry.path === 'manifest.json') {
        manifest = parseBackupManifest(decodeJson(entry.data, options.codec))
        manifestBytes = entry.data.length
      }
    },
    {
      ...zipOptions(limits, options.signal),
      filter: (path) => {
        entries++
        if (path === 'resources.jsonl') hasResources = true
        else if (path.startsWith('sessions/')) {
          backupSessionId(path)
          const folded = path.toLowerCase()
          if (sessionPaths.has(folded)) throw new Error('Backup conversation filenames collide')
          sessionPaths.add(folded)
        } else if (
          path !== 'manifest.json' &&
          path !== 'complete.json' &&
          path !== 'warnings.jsonl' &&
          !isConfigPath(path) &&
          !RESOURCE_PATH_PATTERN.test(path)
        )
          throw new Error(`Unexpected backup ZIP entry: ${path}`)
        return path === 'manifest.json'
      },
    }
  )
  if (!manifest || !hasResources) throw new Error('Backup control files are missing')
  return { manifest, manifestBytes, entries }
}

export async function readBackupV3Manifest(source: ByteSource, options: BackupOptions = {}): Promise<BackupManifest> {
  return (await scanArchive(source, options, resolveBackupLimits(options.limits))).manifest
}

/** Reads business rows once and retains each resource/value/session as soon as it is published. */
export async function importBackupV3(options: ImportBackupV3Options): Promise<BackupResult> {
  const { source, workspace, target, signal } = options
  const limits = resolveBackupLimits(options.limits)
  const notify = progress(options)
  const importReport: BackupImportReport = {
    importedSessions: 0,
    importedMessages: 0,
    importedResources: 0,
    importedGlobals: 0,
    skippedRecords: 0,
    issueCount: 0,
    issues: [],
  }
  let codecSkipped = 0
  const reportIssue: BackupImportIssueReporter = (issue) => {
    importReport.issueCount++
    if (importReport.issues.length < 100) importReport.issues.push(issue)
  }
  let scanned: ScannedArchive | undefined
  let started = false
  let cleanupPending = false
  const counts = emptyBackupCounts()
  let dataBytes = 0,
    resourceBytes = 0,
    resources = 0
  const result = (): BackupResult => {
    if (!scanned) throw new Error('Backup manifest is unavailable')
    Object.assign(importReport, target.getSummary())
    importReport.skippedRecords += codecSkipped
    return {
      manifest: scanned.manifest,
      cleanupPending,
      importReport: { ...importReport, issues: [...importReport.issues] },
      complete: {
        archiveId: scanned.manifest.archiveId,
        counts: { ...counts, resource: resources },
        dataBytes,
        resourceBytes,
        entryCount: scanned.entries,
        uncompressedBytes: scanned.manifestBytes + resourceBytes + dataBytes,
      },
    }
  }
  const cleanup = async () => {
    try {
      if (started) await target.cleanup()
      await workspace.dispose()
      cleanupPending = false
    } catch {
      cleanupPending = true
    }
  }
  notify()
  try {
    scanned = await scanArchive(source, options, limits)
    throwIfAborted(signal)
    const configurations: { path: ConfigPath; value: unknown }[] = []
    let globalBytes = 0
    const includedGlobalKeys: string[] = []
    const addDataBytes = (bytes: number) => {
      dataBytes += bytes
      if (dataBytes > limits.maxDataBytes) throw new Error('Backup data exceeds its byte budget')
      checkTotal(scanned!.manifestBytes + dataBytes + resourceBytes, limits)
    }
    await readZipFileEntries(
      source,
      (entry) => {
        if (!isConfigPath(entry.path)) throw new Error('Unexpected backup configuration')
        globalBytes += entry.data.length
        if (globalBytes > limits.maxGlobalBytes) throw new Error('Backup globals exceed their byte budget')
        addDataBytes(entry.data.length)
        const value = decodeJson(entry.data, options.codec)
        includedGlobalKeys.push(...configurationKeys(entry.path, value, scanned!.manifest.selection))
        configurations.push({ path: entry.path, value })
      },
      { ...zipOptions(limits, signal), filter: isConfigPath }
    )
    started = true
    await target.begin(scanned.manifest, reportIssue, signal, { includedGlobalKeys })
    const order = new RecordOrder(workspace, scanned.manifest, reportIssue)
    const trackedData = (chunks: AsyncIterable<Uint8Array>, path: string) => {
      let processed = 0
      return countChunks(
        chunks,
        path,
        limits.maxDataBytes,
        () => {},
        signal,
        (size) => {
          addDataBytes(size - processed)
          processed = size
        }
      )
    }
    await readZipFileEntries(
      source,
      () => {
        throw new Error('Expected streaming resource index')
      },
      {
        ...zipOptions(limits, signal),
        filter: (path) => path === 'resources.jsonl',
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          for await (const line of decodeJsonLines(
            trackedData(entry.data, entry.path),
            limits.maxRecordBytes,
            signal,
            options.codec
          )) {
            const record = parseBackupRecord(line.value)
            if (record.type !== 'resource') throw new Error('Resource index contains a non-resource record')
            counts.resource++
            await order.accept(record)
            if (
              (await workspace.get('resource-catalog', record.resourceId)) !== null ||
              (await workspace.get('resource-paths', record.path)) !== null
            ) {
              reportIssue({
                code: 'duplicate-resource',
                objectId: record.resourceId,
                message: 'A duplicate resource declaration was skipped.',
              })
              codecSkipped++
              continue
            }
            await workspace.put('resource-catalog', record.resourceId, JSON.stringify(record))
            await workspace.put('resource-paths', record.path, record.resourceId)
          }
        },
      }
    )
    await readZipFileEntries(
      source,
      () => {
        throw new Error('Expected streaming resource')
      },
      {
        ...zipOptions(limits, signal),
        filter: (path) => path.startsWith('resources/'),
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          const key = await workspace.get('resource-paths', entry.path)
          const value = key === null ? null : await workspace.get('resource-catalog', key)
          notify({ phase: 'resources', resources, bytes: resourceBytes })
          let currentBytes = 0
          const chunks = countChunks(
            entry.data,
            entry.path,
            limits.maxResourceBytes,
            () => {},
            signal,
            (size) => {
              resourceBytes += size - currentBytes
              currentBytes = size
              checkTotal(scanned!.manifestBytes + dataBytes + resourceBytes, limits)
              notify({ phase: 'resources', resources, bytes: resourceBytes })
            }
          )
          if (value === null) {
            for await (const _ of chunks) {
              /* Validate and drain unindexed entries. */
            }
            reportIssue({
              code: 'unindexed-resource',
              objectId: entry.path,
              message: 'An attachment without a resource declaration was skipped.',
            })
            codecSkipped++
          } else {
            const declared = parseBackupRecord(JSON.parse(value))
            if (declared.type !== 'resource') throw new Error('Invalid resource catalog')
            const sink = await target.createResource({ ...declared, size: entry.uncompressedSize })
            try {
              for await (const chunk of chunks) await sink.write(chunk)
              throwIfAborted(signal)
              await sink.close()
              await workspace.put('restored-resources', declared.resourceId, '1')
            } catch (error) {
              try {
                await sink.abort()
              } catch {
                cleanupPending = true
              }
              throw error
            }
          }
          notify({ phase: 'resources', resources: ++resources, bytes: resourceBytes })
        },
      }
    )
    let batch: BackupBusinessRecord[] = []
    let batchBytes = 0
    const flush = async () => {
      if (!batch.length) return
      await target.appendRecords(batch)
      batch = []
      batchBytes = 0
    }
    const append = async (record: BackupBusinessRecord, bytes: number) => {
      const context =
        record.type === 'message'
          ? { objectId: record.message.messageId, sessionId: record.message.sessionId }
          : record.type === 'session'
            ? { objectId: record.session.id, sessionId: record.session.id }
            : record.type === 'global'
              ? { objectId: record.id }
              : { objectId: record.thread.threadId, sessionId: record.thread.sessionId }
      for (const reference of backupResourceReferences(record))
        await workspace.put('resource-refs', reference.storageKey, JSON.stringify(context))
      if (batch.length && (record.type === 'session' || batch.length >= 128 || batchBytes + bytes > 512 * 1024))
        await flush()
      batch.push(settleBackupRecord(record))
      batchBytes += bytes
      if (record.type === 'session') await flush()
    }
    const notifyRecords = () =>
      notify({
        phase: 'records',
        records: counts.session + counts.thread + counts.message + counts.global,
        messages: counts.message,
        bytes: dataBytes + resourceBytes,
      })
    for (const configuration of configurations) {
      for (const input of configurationRecords(configuration.path, configuration.value)) {
        throwIfAborted(signal)
        const record = parseBackupRecord(input)
        if (record.type !== 'global') throw new Error('Expected a global configuration record')
        const bytes = encodeLine(record)
        if (bytes.length > limits.maxRecordBytes) throw new Error('Backup record exceeds its byte budget')
        counts.global++
        if (await order.accept(record)) await append(record, bytes.length)
        else codecSkipped++
        notifyRecords()
      }
    }
    configurations.length = 0
    await flush()
    await target.prepare()
    await readZipFileEntries(
      source,
      () => {
        throw new Error('Expected streaming conversation')
      },
      {
        ...zipOptions(limits, signal),
        filter: (path) => path.startsWith('sessions/'),
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          const expectedId = backupSessionId(entry.path)
          let hasHeader = false
          for await (const line of decodeJsonLines(
            trackedData(entry.data, entry.path),
            limits.maxRecordBytes,
            signal,
            options.codec
          )) {
            const record = parseBackupRecord(line.value)
            if (record.type !== 'session' && record.type !== 'thread' && record.type !== 'message')
              throw new Error('Conversation file contains a non-conversation record')
            counts[record.type]++
            try {
              const sessionId =
                record.type === 'session'
                  ? record.session.id
                  : record.type === 'thread'
                    ? record.thread.sessionId
                    : record.message.sessionId
              if (
                sessionId !== expectedId ||
                (record.type === 'session' && hasHeader) ||
                (record.type !== 'session' && !hasHeader)
              ) {
                const objectId =
                  record.type === 'session'
                    ? record.session.id
                    : record.type === 'thread'
                      ? record.thread.threadId
                      : record.message.messageId
                reportIssue({
                  code: record.type === 'session' ? 'record-order' : 'missing-session',
                  objectId,
                  sessionId,
                  message:
                    record.type === 'session'
                      ? 'The record was skipped because it is outside its owning data section.'
                      : 'The record was skipped because its owning conversation is missing or out of order.',
                })
                codecSkipped++
                continue
              }
              if (!(await order.accept(record))) {
                codecSkipped++
                continue
              }
              if (record.type === 'session') hasHeader = true
              await append(record, line.bytes)
            } finally {
              notifyRecords()
            }
          }
          // The iterator must finish CRC/length validation before the candidate can become visible.
          await flush()
          if (hasHeader) await target.prepare()
        },
      }
    )
    await readZipFileEntries(
      source,
      () => {
        throw new Error('Expected streaming warnings')
      },
      {
        ...zipOptions(limits, signal),
        filter: (path) => path === 'warnings.jsonl',
        streamEntry: () => true,
        onStreamEntry: async (entry) => {
          for await (const line of decodeJsonLines(
            trackedData(entry.data, entry.path),
            limits.maxRecordBytes,
            signal,
            options.codec
          )) {
            const record = parseBackupRecord(line.value)
            if (record.type !== 'warning') throw new Error('Warning file contains a non-warning record')
            counts.warning++
            await order.accept(record)
          }
        },
      }
    )
    const reportMissing = async (key: string, context: { objectId?: string; sessionId?: string } = {}) => {
      if (
        (await workspace.get('restored-resources', key)) !== null ||
        !(await workspace.put('missing-resource-reports', key, '1'))
      )
        return
      reportIssue({
        code: 'missing-resource',
        ...context,
        objectId: context.objectId ?? key,
        message: 'An attachment referenced by the backup is missing.',
      })
    }
    for await (const { key, value } of workspace.entries('resource-refs')) await reportMissing(key, JSON.parse(value))
    for await (const { key } of workspace.entries('resource-catalog')) await reportMissing(key)
    throwIfAborted(signal)
    notify({ phase: 'publishing' })
    await target.prepare()
    notify({ phase: 'validating' })
    let complete: BackupComplete | undefined
    await readZipFileEntries(
      source,
      (entry) => {
        complete = parseBackupComplete(decodeJson(entry.data, options.codec))
      },
      { ...zipOptions(limits, signal), filter: (path) => path === 'complete.json' }
    )
    if (!complete) throw new Error('Backup completion marker is missing')
    if (complete.archiveId !== scanned.manifest.archiveId) throw new Error('Backup archive IDs do not match')
    throwIfAborted(signal)
    notify({ phase: 'cleaning' })
    await cleanup()
    const completed = result()
    notify({ phase: 'complete', bytes: completed.complete.uncompressedBytes })
    return completed
  } catch (error) {
    await cleanup()
    if (scanned) throw new BackupImportError(error, result())
    throw error
  }
}

/** Pull-driven adapter for hosts whose file exporter consumes an async byte iterator. */
export async function* exportBackupV3Stream(
  options: Omit<ExportBackupV3Options, 'output'>
): AsyncGenerator<Uint8Array, BackupResult> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  let pending: { bytes: Uint8Array; resolve: () => void; reject: (reason: unknown) => void } | undefined
  let wake: (() => void) | undefined
  let result: BackupResult | undefined
  let error: unknown
  let finished = false
  const notify = () => {
    wake?.()
    wake = undefined
  }
  const job = exportBackupV3({
    ...options,
    signal: controller.signal,
    output: {
      write: (bytes) =>
        new Promise<void>((resolve, reject) => {
          pending = { bytes, resolve, reject }
          notify()
        }),
      close: async () => {},
      abort: async () => {
        pending?.reject(controller.signal.reason ?? new Error('Export aborted'))
        pending = undefined
        notify()
      },
    },
  })
    .then(
      (value) => {
        result = value
      },
      (reason: unknown) => {
        error = reason
      }
    )
    .finally(() => {
      finished = true
      notify()
    })
  try {
    while (!finished || pending) {
      if (pending) {
        const item = pending
        pending = undefined
        try {
          yield item.bytes
        } finally {
          item.resolve()
        }
      } else
        await new Promise<void>((resolve) => {
          wake = resolve
        })
    }
    if (error !== undefined) throw error
    if (!result) throw new Error('Backup export did not complete')
    return result
  } finally {
    controller.abort()
    pending?.reject(controller.signal.reason)
    pending = undefined
    notify()
    await job
    options.signal?.removeEventListener('abort', abort)
  }
}

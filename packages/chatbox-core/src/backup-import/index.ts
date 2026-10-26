import { importBackupV3, readBackupV3Manifest } from '../backup-v3/archive'
import { BackupImportError } from '../backup-v3/errors'
import { backupResourceReferences } from '../backup-v3/records'
import { emptyBackupCounts, parseBackupRecord, portableBackupRecord, settleBackupRecord } from '../backup-v3/schema'
import { sourceChunks } from '../backup-v3/streams'
import type {
  BackupBusinessRecord,
  BackupImportIssue,
  BackupImportReport,
  BackupManifest,
  BackupOptions,
  BackupProgress,
  BackupResult,
  ImportBackupV3Options,
} from '../backup-v3/types'
import type { ByteSource, ByteSink } from '../io'
import { throwIfAborted } from '../utils/abort'
import { createTaskYielder } from '../utils/task-yield'
import { convertSession, globalRecords, object, type ConvertedLegacySession } from './legacy'
import {
  isZip,
  readV1,
  readV2,
  zipManifest,
  type BackupInspection,
  type LegacyInput,
  type LegacyResource,
} from './readers'

export type { BackupInspection } from './readers'

export interface ImportBackupOptions extends ImportBackupV3Options {
  archiveId: string
}

/** Identifies published formats from file contents, independent of the filename. */
export async function inspectBackup(source: ByteSource, options: BackupOptions = {}): Promise<BackupInspection> {
  throwIfAborted(options.signal)
  if (!(await isZip(source))) {
    const input = await readV1(source, options, true)
    return { formatVersion: 1, selection: input.selection }
  }
  const manifest = object(await zipManifest(source, options))
  if (manifest.formatVersion === 3) {
    const value = await readBackupV3Manifest(source, options)
    return { formatVersion: 3, selection: value.selection }
  }
  const input = await readV2(source, manifest, options)
  return { formatVersion: 2, selection: input.selection }
}

/** Adapts external JSON objects to the shared incremental import target. */
export async function importBackup(options: ImportBackupOptions): Promise<BackupResult> {
  throwIfAborted(options.signal)
  let input: LegacyInput
  try {
    if (await isZip(options.source)) {
      const manifest = object(await zipManifest(options.source, options))
      if (manifest.formatVersion === 3) return importBackupV3(options)
      input = await readV2(options.source, manifest, options)
    } else input = await readV1(options.source, options)
  } catch (error) {
    await options.workspace.dispose().catch(() => undefined)
    throw error
  }
  return importLegacy(input, options)
}

async function importLegacy(input: LegacyInput, options: ImportBackupOptions): Promise<BackupResult> {
  const { target, workspace, signal } = options
  const manifest: BackupManifest = {
    format: 'chatbox-backup',
    formatVersion: 3,
    layout: 'rows',
    archiveId: options.archiveId,
    createdAt: new Date().toISOString(),
    producer: `Chatbox V${input.formatVersion} import`,
    selection: input.selection,
  }
  const report: BackupImportReport = {
    importedSessions: 0,
    importedMessages: 0,
    importedResources: 0,
    importedGlobals: 0,
    skippedRecords: 0,
    issueCount: 0,
    issues: [],
  }
  const issue = (value: BackupImportIssue) => {
    report.issueCount++
    if (report.issues.length < 100) report.issues.push(value)
  }
  let skipped = 0,
    dataBytes = input.dataBytes,
    resourceBytes = 0,
    resourceFileIndex = 0,
    cleanupPending = false,
    started = false
  const counts = emptyBackupCounts()
  const progress: BackupProgress = { phase: 'preparing', records: 0, messages: 0, resources: 0, bytes: 0 }
  let notifiedAt = 0
  const notify = (phase: BackupProgress['phase']) => {
    const changed = phase !== progress.phase
    progress.phase = phase
    const now = Date.now()
    if (!changed && now - notifiedAt < 100 && phase !== 'complete') return
    notifiedAt = now
    progress.bytes = dataBytes + resourceBytes
    try {
      options.onProgress?.({ ...progress })
    } catch {
      /* Progress observers do not control writes. */
    }
  }
  const result = (): BackupResult => ({
    manifest,
    cleanupPending,
    complete: {
      archiveId: manifest.archiveId,
      counts: { ...counts },
      dataBytes,
      resourceBytes,
      entryCount: input.entryCount,
      uncompressedBytes: dataBytes + resourceBytes,
    },
    importReport: {
      ...report,
      ...target.getSummary(),
      skippedRecords: target.getSummary().skippedRecords + skipped,
      issues: [...report.issues],
    },
  })
  const cleanup = async () => {
    try {
      if (started) await target.cleanup()
      await workspace.dispose()
      cleanupPending = false
    } catch {
      cleanupPending = true
    }
  }
  const missingResource = async (id: string, sessionId?: string) => {
    if (await workspace.put('legacy-missing-resources', id, '1'))
      issue({
        code: 'missing-resource',
        objectId: id,
        sessionId,
        message: 'An attachment referenced by the backup is missing.',
      })
  }
  const readResource = async (resource: LegacyResource) => {
    const keys: string[] = []
    for (const key of resource.keys) {
      if (await workspace.put('legacy-resource-keys', key, '1')) keys.push(key)
      else {
        skipped++
        issue({ code: 'duplicate-resource', objectId: key, message: 'A duplicate resource was skipped.' })
      }
    }
    if (!keys.length) {
      for await (const _chunk of resource.data) throwIfAborted(signal)
      return
    }
    const makeSink = (key: string) =>
      target.createResource({
        type: 'resource',
        resourceId: key,
        path: resource.path,
        mimeType: resource.mimeType,
        contentType: resource.contentType,
        size: resource.size,
      })
    const first = await makeSink(keys[0])
    const temporaryName = `legacy-resource-${resourceFileIndex++}`
    let temporary: ByteSink | undefined
    const decoder = resource.contentType === 'text' ? new TextDecoder('utf-8', { fatal: true }) : undefined
    try {
      if (keys.length > 1) temporary = await workspace.createFile(temporaryName)
      for await (const chunk of resource.data) {
        throwIfAborted(signal)
        decoder?.decode(chunk, { stream: true })
        await first.write(chunk)
        await temporary?.write(chunk)
        resourceBytes += chunk.length
        notify('resources')
      }
      decoder?.decode()
      await temporary?.close()
      throwIfAborted(signal)
      await first.close()
      await workspace.put('legacy-restored-resources', keys[0], '1')
      counts.resource++
      progress.resources++
      for (const key of keys.slice(1)) {
        throwIfAborted(signal)
        const source = await workspace.openFile(temporaryName)
        let sink: ByteSink | undefined
        try {
          sink = await makeSink(key)
          for await (const bytes of sourceChunks(source, signal)) await sink.write(bytes)
          throwIfAborted(signal)
          await sink.close()
          await workspace.put('legacy-restored-resources', key, '1')
          counts.resource++
          progress.resources++
        } catch (error) {
          await sink?.abort().catch(() => undefined)
          throw error
        } finally {
          await source.close()
        }
      }
    } catch (error) {
      await first.abort().catch(() => undefined)
      await temporary?.abort().catch(() => undefined)
      throw error
    }
  }
  notify('preparing')
  try {
    started = true
    await target.begin(manifest, issue, signal, { includedGlobalKeys: [...input.globals.keys()] })
    const missing: string[] = []
    await input.readResources(readResource, (id) => missing.push(id))
    for (const id of missing) await missingResource(id)
    const globalRows: BackupBusinessRecord[] = []
    for (const [key, value] of input.globals)
      for (const record of globalRecords(key, value, input.configVersion, options.archiveId)) globalRows.push(record)
    for (let offset = 0; offset < globalRows.length; offset += 128) {
      throwIfAborted(signal)
      const batch = globalRows.slice(offset, offset + 128)
      for (const record of batch)
        for (const reference of backupResourceReferences(record)) {
          if (!(await workspace.get('legacy-restored-resources', reference.storageKey)))
            await missingResource(reference.storageKey)
        }
      await target.appendRecords(batch)
      counts.global += batch.length
      progress.records += batch.length
    }
    await target.prepare()
    const settings = input.globals.has('settings') ? object(input.globals.get('settings')) : {}
    const yieldTask = createTaskYielder()
    await input.readSessions(
      async (source) => {
        throwIfAborted(signal)
        dataBytes += source.bytes
        let converted: ConvertedLegacySession
        try {
          converted = convertSession(source.value, source.expectedId, settings, input.configVersion, options.archiveId)
          for (const record of converted.records) parseBackupRecord(record)
        } catch (error) {
          skipped++
          issue({
            code: 'invalid-legacy-session',
            objectId: source.expectedId,
            sessionId: source.expectedId,
            message: `The conversation was skipped: ${error instanceof Error ? error.message : String(error)}`,
          })
          notify('records')
          return
        }
        const { records, forks } = converted
        const first = records[0]
        if (first.type !== 'session') throw new Error('Converted conversation header is missing')
        const id = first.session.id
        if (!(await workspace.put('legacy-session-ids', id, '1'))) {
          skipped++
          issue({
            code: 'duplicate-session',
            objectId: id,
            sessionId: id,
            message: 'A duplicate conversation was skipped.',
          })
          return
        }
        const meta = source.meta
        if (
          meta &&
          typeof meta.sortOrder === 'number' &&
          Number.isFinite(meta.sortOrder) &&
          typeof meta.createdAt === 'number' &&
          Number.isFinite(meta.createdAt)
        )
          first.meta = { sortOrder: meta.sortOrder, createdAt: meta.createdAt }
        for (let offset = 0; offset < records.length; offset += 128) {
          throwIfAborted(signal)
          const batch = records.slice(offset, offset + 128).map((record) => {
            const portable = portableBackupRecord(record)
            if (portable.warning) {
              const warning = portable.warning
              counts.warning++
              issue({ code: warning.category, objectId: warning.objectId, sessionId: id, message: warning.message })
            }
            return settleBackupRecord(portable.record)
          })
          for (const record of batch) {
            for (const reference of backupResourceReferences(record)) {
              if (!(await workspace.get('legacy-restored-resources', reference.storageKey)))
                await missingResource(reference.storageKey, id)
            }
            counts[record.type]++
            progress.records++
            if (record.type === 'message') progress.messages++
          }
          await target.appendRecords(batch)
          notify('records')
          await yieldTask()
        }
        await target.prepare({ sessionId: id, forks })
      },
      (id) => {
        skipped++
        issue({
          code: 'missing-session',
          objectId: id,
          sessionId: id,
          message: 'The conversation file is missing from the backup.',
        })
      }
    )
    notify('cleaning')
    await cleanup()
    notify('complete')
    return result()
  } catch (error) {
    await cleanup()
    throw new BackupImportError(error, result())
  }
}

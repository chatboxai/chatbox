import { SessionMetaRecordSchema, type SessionMetaRecord } from '@shared/types'
import type { BackupExportOptions, BackupExportResult } from './export-backup'
import { safeSessionPathComponent } from './export-backup'
import type { BackupImportOptions, BackupImportResult } from './import-backup'
import { throwIfAborted } from './abort'
import { sha256Checksum } from './codec'
import {
  backupPageLimits,
  type BackupPageLimits,
  type BackupSessionCandidate,
  type BackupSessionStore,
} from './session-port'
import {
  BackupGraphValidator,
  BackupManifestV3Schema,
  fromLogicalBackupRow,
  LogicalBackupRowSchema,
  type LogicalBackupRow,
  toLogicalBackupRow,
  type BackupManifestV3,
} from './sharded-format'
import { collectSessionResourceReferences } from './resources'
import { type BackupFile, type BackupJsonEntry, validateBackupManifestGraph } from './types'
import { createZipStream, DEFAULT_ZIP_LIMITS, readZipFileEntries, type ZipArchiveEntry } from './zip'

export interface ShardedBackupOptions {
  store: BackupSessionStore
  limits?: Partial<BackupPageLimits>
}
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_INDEX_BYTES = 16 * 1024 * 1024
const parse = (bytes: Uint8Array): unknown => JSON.parse(decoder.decode(bytes))
function replacementMeta(meta: SessionMetaRecord): SessionMetaRecord {
  return Object.assign(
    Object.fromEntries(Object.keys(SessionMetaRecordSchema.shape).map((key) => [key, undefined])),
    meta
  ) as SessionMetaRecord
}

function checkResources(row: LogicalBackupRow) {
  const session =
    row.kind === 'header'
      ? { ...row.session, messages: [] }
      : row.kind === 'message'
        ? { id: 'backup', name: '', messages: [row.value] }
        : undefined
  if (session) {
    const collected = collectSessionResourceReferences(session)
    if (collected.references.length || collected.warnings.length)
      throw new Error('This backup data source requires managed-resource support')
  }
}

export async function exportShardedBackup(
  options: BackupExportOptions,
  sharded: ShardedBackupOptions
): Promise<BackupExportResult> {
  if (options.exportItems.length !== 1 || options.exportItems[0] !== 'conversations')
    throw new Error('Sharded validation export requires conversations only')
  const limits = backupPageLimits(sharded.limits)
  const checksum = options.checksum ?? sha256Checksum
  const meta = await options.metaStorage
  const ids = [...new Set(options.selectedSessionIds ?? (await sharded.store.listSessionIds()))]
  if (ids.length > 50_000) throw new Error('Backup contains too many sessions')
  let manifest: BackupManifestV3 | undefined
  const entries = async function* (): AsyncGenerator<ZipArchiveEntry> {
    const sessions: BackupManifestV3['sessions'] = []
    let total = 0
    let entryCount = 0
    let indexBytes = 0
    let headerBytes = 0
    const encode = async (path: string, value: unknown, budget: number) => {
      throwIfAborted(options.signal)
      const data = encoder.encode(JSON.stringify(value))
      if (data.length > budget) throw new Error(`Backup entry exceeds budget: ${path}`)
      total += data.length
      if (++entryCount > DEFAULT_ZIP_LIMITS.maxEntries || total > DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes)
        throw new Error('Backup archive exceeds safety budget')
      return { archive: { path, data }, descriptor: { path, size: data.length, checksum: await checksum(data) } }
    }
    for (const [index, id] of ids.entries()) {
      options.onProgress?.({ phase: 'sessions', current: index, total: ids.length })
      const prefix = `sessions/${await safeSessionPathComponent(id, checksum)}`
      const graph = new BackupGraphValidator(id)
      let session: BackupManifestV3['sessions'][number] | undefined
      let batch: LogicalBackupRow[] = []
      let batchBytes = 2
      const flush = async () => {
        if (!session || !batch.length) throw new Error('Empty backup batch')
        const kind = batch[0].kind
        if (kind === 'header') throw new Error('Header cannot appear in a backup batch')
        const entry = await encode(
          `${prefix}/${kind}s/${String(session.shards.length).padStart(6, '0')}.json`,
          batch,
          limits.maxPageBytes
        )
        const descriptor = { ...entry.descriptor, kind, index: session.shards.length, count: batch.length }
        indexBytes += encoder.encode(JSON.stringify(descriptor)).length
        if (indexBytes > MAX_MANIFEST_BYTES / 2) throw new Error('Backup manifest exceeds budget')
        session.shards.push(descriptor)
        batch = []
        batchBytes = 2
        return entry.archive
      }
      for await (const row of sharded.store.iterateBackupRows(id, limits, options.signal)) {
        throwIfAborted(options.signal)
        const logical = LogicalBackupRowSchema.parse(toLogicalBackupRow(row))
        graph.add(logical)
        checkResources(logical)
        if (logical.kind === 'header') {
          const entry = await encode(`${prefix}/header.json`, logical, limits.maxRecordBytes)
          headerBytes += entry.descriptor.size
          if (headerBytes > MAX_INDEX_BYTES) throw new Error('Backup headers exceed budget')
          const existing = await meta.getById(id)
          const info = logical.session
          session = {
            ...entry.descriptor,
            layout: 'sharded',
            id,
            resourceIds: [],
            shards: [],
            counts: { threads: 1, messages: 0 },
            meta: existing ?? {
              id,
              name: info.name,
              type: info.type,
              starred: info.starred,
              hidden: info.hidden,
              archivedAt: info.archivedAt,
              sortOrder: index,
              createdAt: Date.now(),
            },
          }
          sessions.push(session)
          yield entry.archive
        } else {
          const bytes = encoder.encode(JSON.stringify(logical)).length
          if (bytes > limits.maxRecordBytes) throw new Error('Backup record requires payload blocks')
          if (
            batch.length &&
            (batch[0].kind !== logical.kind ||
              batch.length >= limits.maxPageRows ||
              batchBytes + bytes + 1 > limits.maxPageBytes)
          )
            yield await flush()
          batch.push(logical)
          batchBytes += bytes + (batch.length > 1 ? 1 : 0)
        }
      }
      if (batch.length) yield await flush()
      if (!session) throw new Error('Backup session is missing')
      session.counts = graph.finish()
    }
    manifest = BackupManifestV3Schema.parse({
      format: 'chatbox-backup',
      formatVersion: 3,
      exportedAt: (options.exportedAt ?? new Date()).toISOString(),
      application: {
        name: 'Chatbox',
        version: await options.application.version,
        platform: await options.application.platform,
      },
      exportItems: ['conversations'],
      data: {},
      sessions,
      resources: [],
      warnings: [],
      stats: { sessionCount: sessions.length, resourceCount: 0, deduplicatedResourceCount: 0, warningCount: 0 },
    })
    validateBackupManifestGraph(manifest)
    yield (await encode('manifest.json', manifest, MAX_MANIFEST_BYTES)).archive
  }
  const result = await options.writeArchive(() => createZipStream(entries(), options.signal))
  if (!manifest) throw new Error('Backup was not completely consumed')
  return { ...result, manifest }
}

export async function importShardedBackup(
  file: BackupFile,
  options: BackupImportOptions,
  sharded: ShardedBackupOptions
): Promise<BackupImportResult | undefined> {
  const limits = backupPageLimits(sharded.limits)
  const checksum = options.checksum ?? sha256Checksum
  let declaredVersion: unknown
  await readZipFileEntries(
    file,
    (entry) => {
      const value = parse(entry.data)
      if (typeof value === 'object' && value && 'formatVersion' in value) declaredVersion = value.formatVersion
    },
    {
      bounded: true,
      signal: options.signal,
      filter: (path) => path === 'manifest.json',
      entryLimits: (path) => ({
        maxEntryUncompressedBytes: path === 'manifest.json' ? 128 * 1024 * 1024 : 512 * 1024 * 1024,
      }),
    }
  )
  if (declaredVersion === 2) return undefined
  if (declaredVersion !== 3) throw new Error('Unsupported backup version')
  const batchFacts = new Map<string, { kind: string; count: number; index: number }>()
  let shardIndex = 0
  const observed = new Map<string, BackupJsonEntry>()
  const summaries = new Map<string, { threads: number; messages: number }>()
  let manifest: BackupManifestV3 | undefined
  let current: { id: string; graph: BackupGraphValidator } | undefined
  let indexBytes = 0
  let graphBytes = 0
  let headerBytes = 0
  const finishGraph = () => {
    if (current) summaries.set(current.id, current.graph.finish())
    current = undefined
  }
  const readOptions = {
    bounded: true,
    signal: options.signal,
    entryLimits: (path: string) => ({
      maxEntryUncompressedBytes:
        path === 'manifest.json'
          ? MAX_MANIFEST_BYTES
          : path.endsWith('/session.json')
            ? 128 * 1024 * 1024
            : limits.maxPageBytes,
    }),
  }
  const rows = (data: Uint8Array, path: string) => {
    const value = parse(data)
    const values = path.endsWith('/header.json') ? [value] : value
    if (!Array.isArray(values) || !values.length || values.length > limits.maxPageRows)
      throw new Error('Invalid backup batch')
    return values.map((value) => {
      if (encoder.encode(JSON.stringify(value)).length > limits.maxRecordBytes)
        throw new Error('Backup record requires payload blocks')
      return LogicalBackupRowSchema.parse(value)
    })
  }
  await readZipFileEntries(
    file,
    async (entry) => {
      throwIfAborted(options.signal)
      const descriptor = { path: entry.path, size: entry.data.length, checksum: await checksum(entry.data) }
      indexBytes += encoder.encode(JSON.stringify(descriptor)).length
      if (indexBytes > MAX_INDEX_BYTES) throw new Error('Backup entry index exceeds budget')
      observed.set(entry.path, descriptor)
      if (entry.path === 'manifest.json') {
        finishGraph()
        const value = parse(entry.data)
        manifest = BackupManifestV3Schema.parse(value)
        return
      }
      if (!/^sessions\/[^/]+\/(header\.json|(?:threads|messages)\/\d{6}\.json)$/.test(entry.path)) return
      if (manifest) throw new Error('Backup manifest must be last')
      const batch = rows(entry.data, entry.path)
      if (entry.path.endsWith('/header.json')) {
        if (batch.length !== 1 || batch[0].kind !== 'header') throw new Error('Invalid backup header entry')
        shardIndex = 0
        graphBytes = 0
        headerBytes += entry.data.length
        if (headerBytes > MAX_INDEX_BYTES) throw new Error('Backup headers exceed budget')
      } else {
        const kind = entry.path.includes('/threads/') ? 'thread' : 'message'
        if (batch.some((row) => row.kind !== kind)) throw new Error('Backup shard kind mismatch')
        batchFacts.set(entry.path, { kind, count: batch.length, index: shardIndex++ })
      }
      for (const row of batch) {
        if (row.kind === 'header') {
          finishGraph()
          const id = row.session.id
          if (
            summaries.has(id) ||
            entry.path !== `sessions/${await safeSessionPathComponent(id, checksum)}/header.json`
          )
            throw new Error('Invalid backup session path')
          current = { id, graph: new BackupGraphValidator(id) }
        }
        if (!current || !entry.path.startsWith(`sessions/${await safeSessionPathComponent(current.id, checksum)}/`))
          throw new Error('Backup row appears outside its session')
        checkResources(row)
        const structural = row.kind === 'message' ? (({ value, ...rest }) => rest)(row) : row
        graphBytes += encoder.encode(JSON.stringify(structural)).length
        if (graphBytes > MAX_INDEX_BYTES) throw new Error('Backup graph index exceeds budget')
        current.graph.add(row)
      }
    },
    readOptions
  )
  if (!manifest) throw new Error('Backup manifest is missing')
  const validated: BackupManifestV3 = manifest
  validateBackupManifestGraph(validated)
  if (
    validated.resources.length ||
    Object.keys(validated.data).length ||
    validated.exportItems.some((item) => item !== 'conversations')
  )
    throw new Error('This backup requires managed-resource support')
  const expected = new Map<string, BackupJsonEntry>()
  for (const session of validated.sessions) {
    if (JSON.stringify(session.counts) !== JSON.stringify(summaries.get(session.id)))
      throw new Error('Backup session counts mismatch')
    const prefix = `sessions/${await safeSessionPathComponent(session.id, checksum)}`
    if (session.path !== `${prefix}/header.json`) throw new Error('Invalid backup header path')
    for (const [index, shard] of session.shards.entries()) {
      const fact = batchFacts.get(shard.path)
      if (!fact || fact.count !== shard.count || fact.kind !== shard.kind || fact.index !== index)
        throw new Error('Backup shard count or order mismatch')
      if (shard.index !== index || shard.path !== `${prefix}/${shard.kind}s/${String(index).padStart(6, '0')}.json`)
        throw new Error('Invalid backup shard order')
    }
    for (const descriptor of [session, ...session.shards]) {
      if (expected.has(descriptor.path)) throw new Error('Duplicate backup descriptor')
      expected.set(descriptor.path, descriptor)
      const actual = observed.get(descriptor.path)
      if (!actual || actual.size !== descriptor.size || actual.checksum.value !== descriptor.checksum.value)
        throw new Error(`Backup entry missing or checksum mismatch: ${descriptor.path}`)
    }
  }
  if (observed.size !== expected.size + 1) throw new Error('Backup contains undeclared entries')
  const candidates: Array<{ id: string; candidate: BackupSessionCandidate; oldMeta: SessionMetaRecord | null }> = []
  let active: (typeof candidates)[number] | undefined
  const preserveCandidates = new Set<BackupSessionCandidate>()
  const failures: unknown[] = []
  try {
    await readZipFileEntries(
      file,
      async (entry) => {
        throwIfAborted(options.signal)
        const known = observed.get(entry.path)
        if (!known || entry.data.length !== known.size || (await checksum(entry.data)).value !== known.checksum.value)
          throw new Error('Backup changed during restore')
        if (entry.path === 'manifest.json') return
        const batch = rows(entry.data, entry.path)
        const descriptor = expected.get(entry.path)
        if (descriptor && 'count' in descriptor && batch.length !== descriptor.count)
          throw new Error('Backup shard count mismatch')
        for (const row of batch) {
          if (row.kind === 'header') {
            const id = row.session.id
            const oldMeta = await options.metaStorage.getById(id)
            active = { id, candidate: await sharded.store.beginBackupRestore(id), oldMeta }
            candidates.push(active)
          }
          if (!active) throw new Error('Backup header is missing')
          await active.candidate.append(fromLogicalBackupRow(row, active.id))
        }
      },
      readOptions
    )
    for (const [index, item] of candidates.entries()) {
      throwIfAborted(options.signal)
      await item.candidate.publish()
      const meta = validated.sessions.find((session) => session.id === item.id)!.meta
      if (item.oldMeta) await options.metaStorage.update(item.id, replacementMeta(meta))
      else await options.metaStorage.create(meta)
      options.onProgress?.({ phase: 'restoring', current: index + 1, total: candidates.length })
    }
  } catch (error) {
    failures.push(error)
    for (const item of candidates.toReversed()) {
      try {
        await item.candidate.rollback()
        if (item.oldMeta) await options.metaStorage.update(item.id, replacementMeta(item.oldMeta))
        else await options.metaStorage.delete(item.id)
      } catch (rollbackError) {
        preserveCandidates.add(item.candidate)
        failures.push(rollbackError)
      }
    }
  } finally {
    for (const item of candidates) {
      if (!preserveCandidates.has(item.candidate)) {
        try {
          await item.candidate.dispose()
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
      }
    }
  }
  if (failures.length > 1) throw new AggregateError(failures, 'Backup restore or cleanup failed')
  if (failures.length) throw failures[0]
  return {
    manifest: validated,
    warnings: validated.warnings,
    restoredSessionCount: candidates.length,
    restoredResourceCount: 0,
  }
}

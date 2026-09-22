import {
  type CopilotDetail,
  type Message,
  type Session,
  type SessionMetaRecord,
  SessionMetaRecordSchema,
  SessionSchema,
  type Settings,
} from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { encodeSessionTree } from '../session/session-tree/encode'
import { throwIfAborted } from './abort'
import {
  BACKUP_COPILOTS_PATH,
  BACKUP_SESSION_SETTINGS_PATH,
  BACKUP_SETTINGS_PATH,
  isBackupResourcePath,
} from './archive-layout'
import { fingerprintResource, resourceExists, resourceHash, storedResourceChunks } from './blob-stream'
import { sha256Checksum } from './codec'
import type { BackupExportOptions, BackupExportResult } from './export-backup'
import { backupGlobalEntries, deriveSessionMeta, enforceArchiveLimits, safeSessionPathComponent } from './export-backup'
import { normalizeBackupExportItems } from './export-items'
import { prepareGlobalRestore } from './global-restore'
import type { BackupImportOptions, BackupImportResult } from './import-backup'
import { fitsInlineBackupJson, jsonUtf8Blocks } from './json-stream'
import {
  BACKUP_PAYLOAD_BLOCK_BYTES,
  BackupMessageValidator,
  NATIVE_PAYLOAD_LIMIT_BYTES,
  payloadBlocksOf,
  projectBackupMessage,
  serializeBackupPayload,
} from './payload'
import { preparedSessionReader } from './preflight'
import { createBackupProgressReporter } from './progress'
import { BackupResourceCatalog } from './resource-catalog'
import { BackupResourcePayloadTransform, prepareBackupMessagePayload } from './resource-payload'
import { validateResourceReferences } from './resource-validation'
import {
  collectGlobalResourceReferences,
  collectSessionResourceReferences,
  prepareSessionForBackup,
  rehydrateSessionAttachmentsAsInline,
  restoreSessionMetaResourceKeys,
  restoreSessionResourceKeys,
} from './resources'
import { BackupPresentation } from './restore-presentation'
import {
  type BackupPageLimits,
  type BackupSessionCandidate,
  type BackupSessionStore,
  backupPageLimits,
} from './session-port'
import {
  BackupGraphValidator,
  type BackupManifestV3,
  BackupManifestV3Schema,
  compareBackupIds,
  fromLogicalBackupRow,
  type LogicalBackupRow,
  LogicalBackupRowSchema,
  toLogicalBackupRow,
} from './sharded-format'
import { checkedBackupRows } from './source-check'
import {
  type BackupFile,
  type BackupJsonEntry,
  type BackupProgress,
  MAX_BACKUP_JSON_ENTRY_BYTES,
  MAX_BACKUP_RESOURCE_ENTRY_BYTES,
  validateBackupManifestGraph,
} from './types'
import {
  createZipStream,
  DEFAULT_ZIP_LIMITS,
  readZipFileEntries,
  type ZipArchiveEntry,
  type ZipReadOptions,
} from './zip'

export interface ShardedBackupOptions {
  prepared?: import('./preflight').BackupExportPlan
  store: BackupSessionStore
  limits?: Partial<BackupPageLimits>
  /** Payloads up to this many bytes are parsed natively; larger ones stream. Tests set 0 to force streaming. */
  nativePayloadLimit?: number
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

function rowResources(row: LogicalBackupRow, id: string) {
  const session =
    row.kind === 'header'
      ? { ...row.session, messages: [] }
      : row.kind === 'message'
        ? { id, name: '', messages: [row.value] }
        : undefined
  return session ? collectSessionResourceReferences(session) : { references: [], warnings: [] }
}
function prepareRow(row: LogicalBackupRow, id: string, keys?: ReadonlyMap<string, string>): LogicalBackupRow {
  if (row.kind === 'thread') return row
  const session = row.kind === 'header' ? { ...row.session, messages: [] } : { id, name: '', messages: [row.value] }
  const prepared = keys
    ? rehydrateSessionAttachmentsAsInline(restoreSessionResourceKeys(session, keys))
    : prepareSessionForBackup(session)
  if (row.kind === 'message') return { ...row, value: prepared.messages[0] }
  const { messages, ...header } = prepared
  return { ...row, session: header }
}

export async function exportShardedBackup(
  options: BackupExportOptions,
  sharded: ShardedBackupOptions
): Promise<BackupExportResult> {
  const limits = backupPageLimits(sharded.limits)
  const nativePayloadLimit = sharded.nativePayloadLimit ?? NATIVE_PAYLOAD_LIMIT_BYTES
  const checksum = options.checksum ?? sha256Checksum
  const report = createBackupProgressReporter(options.onProgress)
  let sessionProgress: BackupProgress = { phase: 'sessions', current: 0, total: 0, processedBytes: 0 }
  const meta = await options.metaStorage
  const ids = sharded.prepared
    ? sharded.prepared.sessions.map((session) => session.id)
    : [...new Set(options.selectedSessionIds ?? (await sharded.store.listSessionIds()))]
  if (ids.length > 50_000) throw new Error('Backup contains too many sessions')
  const sourceWarnings = sharded.prepared?.warnings ?? []
  let manifest: BackupManifestV3 | undefined
  const entries = async function* (): AsyncGenerator<ZipArchiveEntry> {
    const sessions: BackupManifestV3['sessions'] = []
    const catalog = new BackupResourceCatalog()
    catalog.warnings.push(...sourceWarnings)
    const globalData: import('./types').BackupManifest['data'] = {}
    yield* backupGlobalEntries(options, catalog, globalData, await options.storage.getAllKeys())
    let total = 0
    let entryCount = 0
    let indexBytes = 0
    let headerBytes = 0
    const encodeBytes = async (path: string, data: Uint8Array, budget: number) => {
      throwIfAborted(options.signal)
      if (data.length > budget) throw new Error(`Backup entry exceeds budget: ${path}`)
      total += data.length
      if (++entryCount > DEFAULT_ZIP_LIMITS.maxEntries || total > DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes)
        throw new Error('Backup archive exceeds safety budget')
      const digest = await checksum(data)
      if (path.startsWith('sessions/')) {
        sessionProgress = { ...sessionProgress, processedBytes: (sessionProgress.processedBytes ?? 0) + data.length }
        report(sessionProgress)
      }
      return { archive: { path, data }, descriptor: { path, size: data.length, checksum: digest } }
    }
    const encode = (path: string, value: unknown, budget: number) =>
      encodeBytes(path, encoder.encode(JSON.stringify(value)), budget)
    for (const [index, id] of ids.entries()) {
      sessionProgress = {
        phase: 'sessions',
        current: index,
        total: ids.length,
        label: sharded.prepared?.sessions[index]?.name ?? (await meta.getById(id))?.name,
        processedBytes: 0,
      }
      report(sessionProgress, true)
      const prefix = `sessions/${await safeSessionPathComponent(id, checksum)}`
      const selected = sharded.prepared?.sessions.find((session) => session.id === id)
      if (selected?.layout === 'single' && sharded.prepared) {
        const session = await preparedSessionReader({ ...options, sessionStore: sharded.store }, sharded.prepared)(
          id,
          (warnings) => catalog.warnings.push(...warnings)
        )
        const collected = collectSessionResourceReferences(session)
        catalog.add(collected.references)
        catalog.warnings.push(...collected.warnings)
        const entry = await encode(`${prefix}/session.json`, session, 64 * 1024 * 1024)
        let messages = session.messages.length
        for (const thread of session.threads ?? []) messages += thread.messages.length
        for (const fork of Object.values(session.messageForksHash ?? {}))
          for (const list of fork.lists) messages += list.messages.length
        sessions.push({
          ...entry.descriptor,
          id,
          layout: 'single',
          legacyTopology: selected.legacyTopology,
          meta: deriveSessionMeta(session, (await meta.getById(id)) ?? undefined),
          resourceIds: [],
          shards: [],
          payloads: [],
          counts: { threads: (session.threads?.length ?? 0) + 1, messages },
        })
        yield entry.archive
        continue
      }
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
      for await (const row of checkedBackupRows(sharded.store, id, limits, options.signal, nativePayloadLimit)) {
        throwIfAborted(options.signal)
        let logical = LogicalBackupRowSchema.parse(toLogicalBackupRow(row))
        if (row.kind === 'message' && row.payload) {
          if (!session || !row.payload.chunks || logical.kind !== 'message')
            throw new Error('Backup payload source is missing')
          if (batch.length) yield await flush()
          const firstBlock = session.payloads.length
          let size = 0
          let rawSize = row.payload.size ?? 0
          let prepared: Message | undefined
          let transformed: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
          if (row.payload.value) {
            // Materialized payload: one native serialization plus the projection pass importers rely on.
            const serialized = serializeBackupPayload(
              prepareSessionForBackup({ id, name: '', messages: [row.payload.value] }).messages[0]
            )
            prepared = serialized.projection
            transformed = serialized.blocks
          } else {
            rawSize = 0
            const source = row.payload.chunks()
            const raw = (async function* () {
              for await (const data of source) {
                rawSize += data.length
                yield data
              }
            })()
            // checkedBackupRows validated the raw stream; the transform validates only its output.
            transformed = prepareBackupMessagePayload(raw, undefined, {
              validateInput: false,
              onFinish: (message) => {
                prepared = message
              },
            })
          }
          for await (const data of transformed) {
            size += data.length
            const entry = await encodeBytes(
              `${prefix}/payloads/${String(session.payloads.length).padStart(6, '0')}.bin`,
              data,
              BACKUP_PAYLOAD_BLOCK_BYTES
            )
            indexBytes += encoder.encode(JSON.stringify(entry.descriptor)).length
            if (indexBytes > MAX_MANIFEST_BYTES / 2) throw new Error('Backup manifest exceeds budget')
            session.payloads.push(entry.descriptor)
            yield entry.archive
          }
          if (!prepared || !row.payload.original) throw new Error('Backup payload projection is missing')
          const originalResources = rowResources({ ...logical, value: row.payload.original() }, id)
          catalog.warnings.push(...originalResources.warnings)
          if (row.payload.size !== undefined && rawSize !== row.payload.size)
            throw new Error('Backup payload size mismatch')
          logical = LogicalBackupRowSchema.parse({
            ...logical,
            value: prepared,
            payload: { encoding: 'json-utf8', size, firstBlock, blockCount: session.payloads.length - firstBlock },
          })
        }
        graph.add(logical)
        const collected = rowResources(logical, id)
        catalog.add(collected.references)
        catalog.warnings.push(...collected.warnings)
        if (!(logical.kind === 'message' && logical.payload)) logical = prepareRow(logical, id)
        if (logical.kind === 'header') {
          const entry = await encode(`${prefix}/header.json`, logical, limits.maxRecordBytes)
          headerBytes += entry.descriptor.size
          if (headerBytes > MAX_INDEX_BYTES) throw new Error('Backup headers exceed budget')
          const existing = await meta.getById(id)
          const info = logical.session
          sessionProgress = { ...sessionProgress, label: info.name }
          session = {
            ...entry.descriptor,
            layout: 'sharded',
            id,
            resourceIds: [],
            shards: [],
            payloads: [],
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
    report({ ...sessionProgress, current: ids.length, total: ids.length }, true)
    yield* catalog.entries(options)
    for (const session of sessions)
      session.resourceIds = catalog.resources
        .filter((resource) => resource.sessionIds.includes(session.id))
        .map((resource) => resource.id)
    const warnings = [...new Map(catalog.warnings.map((warning) => [JSON.stringify(warning), warning])).values()]
    manifest = BackupManifestV3Schema.parse({
      format: 'chatbox-backup',
      formatVersion: 3,
      exportedAt: (options.exportedAt ?? new Date()).toISOString(),
      application: {
        name: 'Chatbox',
        version: await options.application.version,
        platform: await options.application.platform,
      },
      exportItems: normalizeBackupExportItems(options.exportItems),
      data: globalData,
      sessions,
      resources: catalog.resources,
      warnings,
      stats: {
        sessionCount: sessions.length,
        resourceCount: catalog.resources.length,
        deduplicatedResourceCount: catalog.successfulKeys - catalog.resources.length,
        warningCount: warnings.length,
      },
    })
    validateBackupManifestGraph(manifest)
    report({ phase: 'finishing', current: 0, total: 0 }, true)
    yield (await encode('manifest.json', manifest, MAX_MANIFEST_BYTES)).archive
  }
  const result = await options.writeArchive(() => createZipStream(enforceArchiveLimits(entries()), options.signal))
  if (!manifest) throw new Error('Backup was not completely consumed')
  return { ...result, manifest }
}

export async function importShardedBackup(
  file: BackupFile,
  options: BackupImportOptions,
  sharded: ShardedBackupOptions
): Promise<BackupImportResult | undefined> {
  const report = createBackupProgressReporter(options.onProgress)
  let phase: BackupProgress['phase'] = 'reading'
  let processedBytes = 0
  const beginPhase = (next: BackupProgress['phase']) => {
    phase = next
    processedBytes = 0
    report({ phase, current: 0, total: 0, processedBytes }, true)
  }
  const advance = (bytes: number) => {
    processedBytes += bytes
    report({ phase, current: 0, total: 0, processedBytes })
  }
  const readEntries: typeof readZipFileEntries = async (input, consume, readOptions = {}) => {
    const streamConsumer = readOptions.onStreamEntry
    const tracked: ZipReadOptions = {
      ...readOptions,
      onStreamEntry: streamConsumer
        ? async (entry) => {
            const data = (async function* () {
              for await (const bytes of entry.data) {
                yield bytes
                advance(bytes.length)
              }
            })()
            await streamConsumer({ ...entry, data })
          }
        : undefined,
    }
    await readZipFileEntries(
      input,
      async (entry) => {
        await consume(entry)
        advance(entry.data.length)
      },
      tracked
    )
    report({ phase, current: 0, total: 0, processedBytes }, true)
  }
  beginPhase('reading')
  const limits = backupPageLimits(sharded.limits)
  const checksum = options.checksum ?? sha256Checksum
  const referenceCatalog = new BackupResourceCatalog()
  let declaredVersion: unknown
  await readEntries(
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
  beginPhase('validating')
  const globalValues = new Map<string, unknown>()
  const globalPaths = new Set([BACKUP_SETTINGS_PATH, BACKUP_COPILOTS_PATH, BACKUP_SESSION_SETTINGS_PATH])
  const batchFacts = new Map<string, { kind: string; count: number; index: number }>()
  let shardIndex = 0
  const observed = new Map<string, BackupJsonEntry>()
  const summaries = new Map<string, { threads: number; messages: number }>()
  const presentations = new Map<string, BackupPresentation>()
  let manifest: BackupManifestV3 | undefined
  let current: { id: string; graph: BackupGraphValidator } | undefined
  let indexBytes = 0
  let graphBytes = 0
  let headerBytes = 0
  let payloadIndex = 0
  let pendingPayload: { validator: BackupMessageValidator; firstBlock: number; count: number; size: number } | undefined
  const nativePayloadLimit = sharded.nativePayloadLimit ?? NATIVE_PAYLOAD_LIMIT_BYTES
  /** Total bytes of each payload group, keyed by session id and first block index. */
  const payloadGroupSizes = new Map<string, number>()
  const finishGraph = () => {
    if (pendingPayload) throw new Error('Backup payload has no owning message')
    if (current) summaries.set(current.id, current.graph.finish())
    current = undefined
  }
  const readOptions = {
    bounded: true,
    signal: options.signal,
    entryLimits: (path: string) => ({
      maxEntryUncompressedBytes: isBackupResourcePath(path)
        ? MAX_BACKUP_RESOURCE_ENTRY_BYTES
        : path === 'manifest.json'
          ? MAX_MANIFEST_BYTES
          : globalPaths.has(path) || path.endsWith('/session.json')
            ? MAX_BACKUP_JSON_ENTRY_BYTES
            : path.endsWith('.bin')
              ? BACKUP_PAYLOAD_BLOCK_BYTES
              : limits.maxPageBytes,
    }),
  }
  const legacyTopologies = new Map<string, string>()
  const singleTree = (data: Uint8Array) => {
    const value = parse(data)
    SessionSchema.parse(value)
    const session = value as Session
    const encoded = encodeSessionTree(session, { activeThreadId: `backup-active:${session.id}`, now: 0 })
    return { session, tree: encoded.ok ? encoded.tree : undefined, topology: encoded.ok ? undefined : encoded.reason }
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
  await readEntries(
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
      if (globalPaths.has(entry.path)) {
        if (manifest || entry.data.length > MAX_BACKUP_JSON_ENTRY_BYTES) throw new Error('Invalid global backup entry')
        globalValues.set(entry.path, parse(entry.data))
        return
      }
      if (entry.path.endsWith('/session.json')) {
        if (manifest) throw new Error('Backup manifest must be last')
        finishGraph()
        const { session, tree, topology } = singleTree(entry.data)
        if (!tree) {
          // 混合分片备份也可携带旧 JSON。先保留诊断，清单校验后才允许按旧记录恢复，不能丢掉孤立消息。
          legacyTopologies.set(session.id, topology!)
          let messages = session.messages.length
          for (const thread of session.threads ?? []) messages += thread.messages.length
          for (const fork of Object.values(session.messageForksHash ?? {}))
            for (const list of fork.lists) messages += list.messages.length
          summaries.set(session.id, { threads: (session.threads?.length ?? 0) + 1, messages })
          referenceCatalog.add(collectSessionResourceReferences(session).references)
          return
        }
        const graph = new BackupGraphValidator(session.id)
        graph.add(toLogicalBackupRow({ kind: 'header', record: tree.session }))
        for (const thread of tree.threads.sort((a, b) => a.seq - b.seq))
          graph.add(toLogicalBackupRow({ kind: 'thread', thread }))
        for (const message of tree.messages.sort((a, b) => compareBackupIds(a.threadId, b.threadId) || a.seq - b.seq))
          graph.add(toLogicalBackupRow({ kind: 'message', message }))
        summaries.set(session.id, graph.finish())
        referenceCatalog.add(collectSessionResourceReferences(session).references)
        return
      }
      if (/^sessions\/[^/]+\/payloads\/\d{6}\.bin$/.test(entry.path)) {
        if (
          manifest ||
          !current ||
          entry.path !==
            `sessions/${await safeSessionPathComponent(current.id, checksum)}/payloads/${String(payloadIndex).padStart(6, '0')}.bin`
        )
          throw new Error('Invalid backup payload order')
        pendingPayload ??= { validator: new BackupMessageValidator(), firstBlock: payloadIndex, count: 0, size: 0 }
        pendingPayload.validator.write(entry.data)
        pendingPayload.count++
        pendingPayload.size += entry.data.length
        payloadIndex++
        return
      }
      if (!/^sessions\/[^/]+\/(header\.json|(?:threads|messages)\/\d{6}\.json)$/.test(entry.path)) return
      if (manifest) throw new Error('Backup manifest must be last')
      const batch = rows(entry.data, entry.path)
      if (entry.path.endsWith('/header.json')) {
        if (batch.length !== 1 || batch[0].kind !== 'header') throw new Error('Invalid backup header entry')
        shardIndex = 0
        payloadIndex = 0
        graphBytes = 0
        headerBytes += entry.data.length
        if (headerBytes > MAX_INDEX_BYTES) throw new Error('Backup headers exceed budget')
      } else {
        const kind = entry.path.includes('/threads/') ? 'thread' : 'message'
        if (batch.some((row) => row.kind !== kind)) throw new Error('Backup shard kind mismatch')
        batchFacts.set(entry.path, { kind, count: batch.length, index: shardIndex++ })
      }
      for (const row of batch) {
        if (row.kind === 'message' && row.payload) {
          const p = row.payload
          if (
            !pendingPayload ||
            p.firstBlock !== pendingPayload.firstBlock ||
            p.blockCount !== pendingPayload.count ||
            p.size !== pendingPayload.size ||
            JSON.stringify(pendingPayload.validator.finish()) !== JSON.stringify(row.value)
          )
            throw new Error('Backup payload reference mismatch')
          if (current) payloadGroupSizes.set(`${current.id}:${p.firstBlock}`, p.size)
          pendingPayload = undefined
        } else if (pendingPayload) throw new Error('Backup payload has no owning message')
        if (row.kind === 'header') {
          finishGraph()
          const id = row.session.id
          if (
            summaries.has(id) ||
            entry.path !== `sessions/${await safeSessionPathComponent(id, checksum)}/header.json`
          )
            throw new Error('Invalid backup session path')
          current = { id, graph: new BackupGraphValidator(id) }
          presentations.set(id, new BackupPresentation())
        }
        if (!current || !entry.path.startsWith(`sessions/${await safeSessionPathComponent(current.id, checksum)}/`))
          throw new Error('Backup row appears outside its session')
        referenceCatalog.add(rowResources(row, current.id).references)
        const structural = row.kind === 'message' ? (({ value, payload, ...rest }) => rest)(row) : row
        graphBytes += encoder.encode(JSON.stringify(structural)).length
        if (graphBytes > MAX_INDEX_BYTES) throw new Error('Backup graph index exceeds budget')
        current.graph.add(row)
        presentations.get(current.id)!.add(row)
      }
    },
    {
      ...readOptions,
      streamEntry: isBackupResourcePath,
      onStreamEntry: async (entry) => {
        if (manifest) throw new Error('Backup manifest must be the final entry')
        finishGraph()
        const hash = resourceHash()
        for await (const bytes of entry.data) {
          throwIfAborted(options.signal)
          hash.write(bytes)
        }
        const descriptor = { path: entry.path, ...hash.finish() }
        indexBytes += encoder.encode(JSON.stringify(descriptor)).length
        if (indexBytes > MAX_INDEX_BYTES) throw new Error('Backup entry index exceeds budget')
        observed.set(entry.path, descriptor)
      },
    }
  )
  if (!manifest) throw new Error('Backup manifest is missing')
  const validated: BackupManifestV3 = manifest
  validateBackupManifestGraph(validated)
  referenceCatalog.add(
    collectGlobalResourceReferences(
      globalValues.get(BACKUP_SETTINGS_PATH) as Partial<Settings> | undefined,
      globalValues.get(BACKUP_COPILOTS_PATH) as CopilotDetail[] | undefined
    )
  )
  const expected = new Map<string, BackupJsonEntry>()
  for (const session of validated.sessions) {
    const topology = legacyTopologies.get(session.id)
    if (topology && (session.layout !== 'single' || !session.legacyTopology)) throw new Error(topology)
    if (topology && !sharded.store.beginLegacyRestore)
      throw new Error('Backup storage does not support legacy conversation restoration')
    if (JSON.stringify(session.counts) !== JSON.stringify(summaries.get(session.id)))
      throw new Error('Backup session counts mismatch')
    const prefix = `sessions/${await safeSessionPathComponent(session.id, checksum)}`
    if (session.path !== `${prefix}/${session.layout === 'single' ? 'session' : 'header'}.json`)
      throw new Error('Invalid backup session path')
    if (session.layout === 'single' && (session.shards.length || session.payloads.length))
      throw new Error('Single-file session cannot contain shards')
    for (const [index, shard] of session.shards.entries()) {
      const fact = batchFacts.get(shard.path)
      if (!fact || fact.count !== shard.count || fact.kind !== shard.kind || fact.index !== index)
        throw new Error('Backup shard count or order mismatch')
      if (shard.index !== index || shard.path !== `${prefix}/${shard.kind}s/${String(index).padStart(6, '0')}.json`)
        throw new Error('Invalid backup shard order')
    }
    for (const [index, block] of session.payloads.entries()) {
      if (
        block.path !== `${prefix}/payloads/${String(index).padStart(6, '0')}.bin` ||
        block.size < 1 ||
        block.size > BACKUP_PAYLOAD_BLOCK_BYTES
      )
        throw new Error('Invalid backup payload descriptor')
    }
    for (const descriptor of [session, ...session.shards, ...session.payloads]) {
      if (expected.has(descriptor.path)) throw new Error('Duplicate backup descriptor')
      expected.set(descriptor.path, descriptor)
      const actual = observed.get(descriptor.path)
      if (!actual || actual.size !== descriptor.size || actual.checksum.value !== descriptor.checksum.value)
        throw new Error(`Backup entry missing or checksum mismatch: ${descriptor.path}`)
    }
  }
  for (const [kind, descriptor] of Object.entries(validated.data)) {
    const path = {
      settings: BACKUP_SETTINGS_PATH,
      copilots: BACKUP_COPILOTS_PATH,
      sessionSettings: BACKUP_SESSION_SETTINGS_PATH,
    }[kind]
    if (descriptor.path !== path || expected.has(descriptor.path)) throw new Error('Invalid global backup path')
    const actual = observed.get(descriptor.path)
    if (!actual || actual.size !== descriptor.size || actual.checksum.value !== descriptor.checksum.value)
      throw new Error('Global backup checksum mismatch')
    expected.set(descriptor.path, descriptor)
  }
  for (const resource of validated.resources) {
    if (!isBackupResourcePath(resource.path) || expected.has(resource.path))
      throw new Error('Invalid backup resource path')
    expected.set(resource.path, resource)
    const actual = observed.get(resource.path)
    if (!actual || actual.size !== resource.size || actual.checksum.value !== resource.checksum.value)
      throw new Error(`Backup resource missing or checksum mismatch: ${resource.path}`)
  }
  if (observed.size !== expected.size + 1) throw new Error('Backup contains undeclared entries')
  const missingResources = validateResourceReferences(
    validated,
    [...referenceCatalog.candidates.values()].flatMap((candidate) => candidate.references)
  )
  const candidates: Array<{ id: string; candidate: BackupSessionCandidate; oldMeta: SessionMetaRecord | null }> = []
  let active: (typeof candidates)[number] | undefined
  const preserveCandidates = new Set<BackupSessionCandidate>()
  const failures: unknown[] = []
  const keys = new Map<string, string>()
  const newResources: string[] = []
  let globals: Awaited<ReturnType<typeof prepareGlobalRestore>> | undefined
  let preserveGlobals = false
  let activeSourceSession: Session | undefined
  let payloadTransform: { transform: BackupResourcePayloadTransform; size: number } | undefined
  let payloadBuffer: { data: Uint8Array; offset: number } | undefined
  let restoreBlockIndex = 0
  try {
    beginPhase('restoring')
    const reserved = new Set<string>()
    const targets = new Map<string, { key: string; write: boolean }>()
    const allocate = async () => {
      for (let i = 0; i < 100; i++) {
        throwIfAborted(options.signal)
        const key = `resource:imported:${await (options.createId ?? uuidv4)()}`
        if (!reserved.has(key) && !(await resourceExists(options.storage, key))) {
          reserved.add(key)
          return key
        }
      }
      throw new Error('Could not allocate backup resource key')
    }
    for (const resource of validated.resources) {
      let chosen: { key: string; write: boolean } | undefined
      for (const key of resource.originalStorageKeys) {
        const existing = await fingerprintResource(options.storage, key, resource, options.signal)
        if (
          existing &&
          existing.size === resource.size &&
          existing.checksum.value === resource.checksum.value &&
          existing.encoding === resource.encoding &&
          existing.mimeType === resource.mimeType
        ) {
          chosen = { key, write: false }
          break
        }
        if (!existing && !reserved.has(key) && !chosen) chosen = { key, write: true }
      }
      chosen ??= { key: await allocate(), write: true }
      reserved.add(chosen.key)
      targets.set(resource.path, chosen)
      for (const key of resource.originalStorageKeys) keys.set(key, chosen.key)
    }
    for (const key of missingResources) keys.set(key, await allocate())
    globals = await prepareGlobalRestore(
      validated,
      globalValues,
      options.storage,
      keys,
      options.signal,
      options.createId
    )
    const { translateMessage, translateMemoryToolContext } = globals
    await readEntries(
      file,
      () => {
        throw new Error('Expected resource stream')
      },
      {
        ...readOptions,
        filter: isBackupResourcePath,
        streamEntry: isBackupResourcePath,
        onStreamEntry: async (entry) => {
          const resource = validated.resources.find((resource) => resource.path === entry.path)!
          const target = targets.get(entry.path)!
          const hash = resourceHash()
          const bytes = (async function* () {
            for await (const chunk of entry.data) {
              throwIfAborted(options.signal)
              hash.write(chunk)
              yield chunk
            }
            const actual = hash.finish()
            if (actual.size !== resource.size || actual.checksum.value !== resource.checksum.value)
              throw new Error('Backup resource changed during restore')
          })()
          if (target.write) {
            if (options.storage.blobStreams) {
              await options.storage.blobStreams.write(target.key, storedResourceChunks(bytes, resource))
              newResources.push(target.key)
            } else {
              const parts: string[] = []
              for await (const text of storedResourceChunks(bytes, resource)) parts.push(text)
              newResources.push(target.key)
              await options.storage.setBlob(target.key, parts.join(''))
            }
          } else {
            for await (const _ of bytes) {
            }
          }
        },
      }
    )
    await readEntries(
      file,
      async (entry) => {
        throwIfAborted(options.signal)
        const known = observed.get(entry.path)
        if (!known || entry.data.length !== known.size || (await checksum(entry.data)).value !== known.checksum.value)
          throw new Error('Backup changed during restore')
        if (entry.path === 'manifest.json' || globalPaths.has(entry.path)) return
        if (isBackupResourcePath(entry.path)) return
        if (entry.path.endsWith('/session.json')) {
          const restored = globals!.translate(
            rehydrateSessionAttachmentsAsInline(restoreSessionResourceKeys(singleTree(entry.data).session, keys))
          )
          const encoded = encodeSessionTree(restored, { activeThreadId: `backup-active:${restored.id}`, now: 0 })
          const oldMeta = await options.metaStorage.getById(restored.id)
          if (!encoded.ok) {
            if (!legacyTopologies.has(restored.id) || !sharded.store.beginLegacyRestore) throw new Error(encoded.reason)
            const candidate = await sharded.store.beginLegacyRestore(restored)
            active = { id: restored.id, candidate, oldMeta }
            candidates.push(active)
            return
          }
          const candidate = await sharded.store.beginBackupRestore(restored.id)
          active = { id: restored.id, candidate, oldMeta }
          candidates.push(active)
          await candidate.append({ kind: 'header', record: encoded.tree.session })
          for (const thread of encoded.tree.threads) {
            throwIfAborted(options.signal)
            await candidate.append({ kind: 'thread', thread })
          }
          for (const message of encoded.tree.messages) {
            throwIfAborted(options.signal)
            if (fitsInlineBackupJson({ kind: 'message', message }, limits.maxRecordBytes))
              await candidate.append({ kind: 'message', message })
            else {
              if (!candidate.appendPayload) throw new Error('Backup storage does not support payload restoration')
              const validator = new BackupMessageValidator()
              let size = 0
              for (const bytes of jsonUtf8Blocks(message.message)) {
                throwIfAborted(options.signal)
                validator.write(bytes)
                size += bytes.length
                await candidate.appendPayload(bytes)
              }
              await candidate.append({
                kind: 'message',
                message: { ...message, message: validator.finish() },
                payload: { size },
              })
            }
          }
          return
        }
        if (entry.path.endsWith('.bin')) {
          if (!active?.candidate.appendPayload) throw new Error('Backup storage does not support payload restoration')
          // Every payload block was validated and checksummed before restoring began.
          if (!payloadTransform && !payloadBuffer) {
            const groupSize = payloadGroupSizes.get(`${active.id}:${restoreBlockIndex}`)
            if (groupSize !== undefined && groupSize <= nativePayloadLimit)
              payloadBuffer = { data: new Uint8Array(groupSize), offset: 0 }
          }
          restoreBlockIndex++
          if (payloadBuffer) {
            if (payloadBuffer.offset + entry.data.length > payloadBuffer.data.length)
              throw new Error('Backup payload size mismatch')
            payloadBuffer.data.set(entry.data, payloadBuffer.offset)
            payloadBuffer.offset += entry.data.length
            return
          }
          payloadTransform ??= {
            transform: new BackupResourcePayloadTransform(keys, translateMemoryToolContext, { validateInput: false }),
            size: 0,
          }
          for (const bytes of payloadTransform.transform.write(entry.data)) {
            payloadTransform.size += bytes.length
            await active.candidate.appendPayload(bytes)
          }
          return
        }
        const batch = rows(entry.data, entry.path)
        const descriptor = expected.get(entry.path)
        if (descriptor && 'count' in descriptor && batch.length !== descriptor.count)
          throw new Error('Backup shard count mismatch')
        for (let row of batch) {
          if (row.kind === 'header') {
            activeSourceSession = { ...row.session, messages: [] }
            const { messages: _messages, threads: _threads, ...translated } = globals!.translate(activeSourceSession)
            row = { ...row, session: translated }
            const id = row.session.id
            const oldMeta = await options.metaStorage.getById(id)
            active = { id, candidate: await sharded.store.beginBackupRestore(id), oldMeta }
            candidates.push(active)
            restoreBlockIndex = 0
          }
          if (!active) throw new Error('Backup header is missing')
          if (row.kind === 'message' && row.payload && payloadBuffer) {
            if (!active.candidate.appendPayload) throw new Error('Missing backup message payload')
            if (payloadBuffer.offset !== payloadBuffer.data.length) throw new Error('Backup payload size mismatch')
            // Materialized group: rebuild the message with the same object-level steps inline rows use.
            const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBuffer.data)) as Message
            const restored = prepareRow({ ...row, value: translateMessage(parsed) }, active.id, keys)
            if (restored.kind !== 'message') throw new Error('Backup payload row changed kind')
            const bytes = encoder.encode(JSON.stringify(restored.value))
            for (const block of payloadBlocksOf(bytes)) await active.candidate.appendPayload(block)
            row = {
              ...restored,
              value: projectBackupMessage(restored.value),
              payload: { ...row.payload, size: bytes.length },
            }
            payloadBuffer = undefined
          } else if (row.kind === 'message' && row.payload) {
            if (!payloadTransform || !active.candidate.appendPayload) throw new Error('Missing backup message payload')
            const final = payloadTransform.transform.finish()
            for (const bytes of final.bytes) {
              payloadTransform.size += bytes.length
              await active.candidate.appendPayload(bytes)
            }
            row = { ...row, value: final.message, payload: { ...row.payload, size: payloadTransform.size } }
            payloadTransform = undefined
          } else {
            if (row.kind === 'message') row = { ...row, value: translateMessage(row.value) }
            if (row.kind === 'thread' && row.sessionPromptContextSnapshot && activeSourceSession) {
              const translated = globals!.translate({
                ...activeSourceSession,
                threads: [
                  {
                    id: row.id,
                    name: row.name ?? '',
                    createdAt: row.createdAt,
                    messages: [],
                    sessionPromptContextSnapshot: row.sessionPromptContextSnapshot,
                  },
                ],
              })
              row = { ...row, sessionPromptContextSnapshot: translated.threads![0].sessionPromptContextSnapshot }
            }
            row = prepareRow(row, active.id, keys)
          }
          const stored = fromLogicalBackupRow(row, active.id)
          if (stored.kind === 'header') stored.record.presentation = presentations.get(active.id)!.value
          await active.candidate.append(stored)
        }
      },
      { ...readOptions, filter: (path) => !isBackupResourcePath(path) }
    )
    beginPhase('finishing')
    for (const [index, item] of candidates.entries()) {
      throwIfAborted(options.signal)
      await item.candidate.publish(options.signal)
      throwIfAborted(options.signal)
      const meta = restoreSessionMetaResourceKeys(
        validated.sessions.find((session) => session.id === item.id)!.meta,
        keys
      )
      if (item.oldMeta) await options.metaStorage.update(item.id, replacementMeta(meta))
      else await options.metaStorage.create(meta)
      report({ phase: 'finishing', current: index + 1, total: candidates.length }, true)
      throwIfAborted(options.signal)
    }
    await globals!.publish()
  } catch (error) {
    failures.push(error)
    try {
      await globals?.rollback()
    } catch (rollbackError) {
      preserveGlobals = true
      failures.push(rollbackError)
    }
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
    if (!preserveCandidates.size && !preserveGlobals) {
      for (const key of newResources.reverse()) {
        try {
          await options.storage.delBlob(key)
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
      }
    }
  } finally {
    if (!preserveGlobals)
      try {
        await globals?.dispose()
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
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
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      `Backup restore or cleanup failed; retained sessions: ${candidates
        .filter((item) => preserveCandidates.has(item.candidate))
        .map((item) => item.id)
        .join(', ')}`
    )
  if (failures.length) throw failures[0]
  return {
    manifest: validated,
    warnings: validated.warnings,
    restoredSessionCount: candidates.length,
    restoredResourceCount: validated.resources.length,
  }
}

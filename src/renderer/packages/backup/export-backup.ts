import type { CopilotDetail, Session, SessionMetaRecord, Settings } from '@shared/types'
import { cleanSettingsForBackup } from '@shared/utils/backup'
import type { StreamingExportResult } from '@/platform/interfaces'
import {
  BACKUP_COPILOTS_PATH,
  BACKUP_MANIFEST_PATH,
  BACKUP_SESSION_SETTINGS_PATH,
  BACKUP_SETTINGS_PATH,
  backupEntryByteLimit,
  isBackupSession,
} from './archive-layout'
import { encodeStoredBlob, sha256Checksum, shouldCompressMimeType } from './codec'
import {
  collectGlobalResourceReferences,
  collectSessionResourceReferences,
  prepareSessionForBackup,
  type ResourceReference,
} from './resources'
import {
  AGENT_PERSONA_BACKUP_KEYS,
  BackupStorageKey,
  backupSessionStorageKey,
  COPILOT_BACKUP_KEYS,
} from './storage-keys'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupExportItem,
  type BackupJsonEntry,
  type BackupManifest,
  BackupManifestSchema,
  type BackupMetaStorage,
  type BackupProgress,
  type BackupResourceEntry,
  type BackupSessionEntry,
  type BackupStorage,
  type BackupWarning,
  MAX_BACKUP_JSON_ENTRY_BYTES,
  MAX_BACKUP_RESOURCE_ENTRY_BYTES,
  validateBackupManifestGraph,
} from './types'
import { createZipStream, DEFAULT_ZIP_LIMITS, type ZipArchiveEntry } from './zip'

interface ResourceCandidate {
  references: ResourceReference[]
}

interface SessionEntryState {
  entry: BackupSessionEntry
  resourceStorageKeys: Set<string>
}

export interface BackupExportOptions {
  exportItems: BackupExportItem[]
  includeKeys: boolean
  exportedAt?: Date
  storage: BackupStorage
  metaStorage: BackupMetaStorage | Promise<BackupMetaStorage>
  application: { version: string | Promise<string>; platform: string | Promise<string> }
  signal?: AbortSignal
  onProgress?: (progress: BackupProgress) => void
  writeArchive: (dataCallback: () => AsyncGenerator<Uint8Array, void, unknown>) => Promise<StreamingExportResult>
}

export interface BackupExportResult extends StreamingExportResult {
  manifest: BackupManifest
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation canceled', 'AbortError')
  }
}

async function safeSessionPathComponent(sessionId: string): Promise<string> {
  const encoded = encodeURIComponent(sessionId).replaceAll('.', '%2E')
  if (new TextEncoder().encode(encoded).length <= 200) return encoded
  const checksum = await sha256Checksum(new TextEncoder().encode(sessionId))
  return `id-${checksum.value}`
}

function deriveSessionMeta(session: Session, existing?: SessionMetaRecord): SessionMetaRecord {
  return {
    id: session.id,
    name: session.name,
    starred: session.starred,
    hidden: session.hidden,
    archivedAt: session.archivedAt,
    assistantAvatarKey: session.assistantAvatarKey,
    picUrl: session.picUrl,
    backgroundImage: session.backgroundImage,
    type: session.type,
    sortOrder: existing?.sortOrder ?? Date.now(),
    createdAt: existing?.createdAt ?? Date.now(),
  }
}

async function jsonEntry(
  path: string,
  value: unknown
): Promise<{ archive: ZipArchiveEntry; descriptor: BackupJsonEntry }> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  if (bytes.length > MAX_BACKUP_JSON_ENTRY_BYTES) throw new Error(`Backup JSON entry is too large: ${path}`)
  return {
    archive: { path, data: bytes, compress: true },
    descriptor: { path, size: bytes.length, checksum: await sha256Checksum(bytes) },
  }
}

async function* enforceArchiveLimits(
  entries: AsyncIterable<ZipArchiveEntry>
): AsyncGenerator<ZipArchiveEntry, void, unknown> {
  let entryCount = 0
  let totalUncompressedBytes = 0
  for await (const entry of entries) {
    entryCount++
    if (entryCount > DEFAULT_ZIP_LIMITS.maxEntries) throw new Error('Backup contains too many entries')
    const maxEntryBytes = backupEntryByteLimit(entry.path)
    if (entry.data instanceof Uint8Array) {
      if (entry.data.length > maxEntryBytes) throw new Error(`Backup entry is too large: ${entry.path}`)
      totalUncompressedBytes += entry.data.length
      if (totalUncompressedBytes > DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes) {
        throw new Error('Backup uncompressed size exceeds the safety limit')
      }
      yield entry
      continue
    }
    let entryBytes = 0
    const data = entry.data
    yield {
      ...entry,
      data: (async function* () {
        for await (const chunk of data) {
          entryBytes += chunk.length
          totalUncompressedBytes += chunk.length
          if (entryBytes > maxEntryBytes) throw new Error(`Backup entry is too large: ${entry.path}`)
          if (totalUncompressedBytes > DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes) {
            throw new Error('Backup uncompressed size exceeds the safety limit')
          }
          yield chunk
        }
      })(),
    }
  }
}

function addResourceReferences(resourceCandidates: Map<string, ResourceCandidate>, references: ResourceReference[]) {
  for (const reference of references) {
    const candidate = resourceCandidates.get(reference.storageKey)
    if (candidate) {
      candidate.references.push(reference)
    } else {
      resourceCandidates.set(reference.storageKey, { references: [reference] })
    }
  }
}

function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

function resolveResourceScope(candidate: ResourceCandidate): BackupResourceEntry['scope'] {
  const sessionIds = unique(
    candidate.references.flatMap((reference) => (reference.sessionId ? [reference.sessionId] : []))
  )
  const hasGlobalReference = candidate.references.some((reference) => !reference.sessionId)
  if (sessionIds.length === 0) return 'global'
  if (sessionIds.length === 1 && !hasGlobalReference) return 'session'
  return 'shared'
}

async function resourcePath(
  id: string,
  extension: string,
  scope: BackupResourceEntry['scope'],
  sessionIds: string[]
): Promise<string> {
  if (scope === 'session' && sessionIds.length === 1) {
    return `sessions/${await safeSessionPathComponent(sessionIds[0])}/resources/${id}.${extension}`
  }
  return `resources/${id}.${extension}`
}

export async function exportBackupArchive(options: BackupExportOptions): Promise<BackupExportResult> {
  let completedManifest: BackupManifest | undefined
  const exportedAt = options.exportedAt ?? new Date()

  const generateEntries = async function* (): AsyncGenerator<ZipArchiveEntry> {
    const warnings: BackupWarning[] = []
    const sessions: SessionEntryState[] = []
    const resources: BackupResourceEntry[] = []
    const resourceCandidates = new Map<string, ResourceCandidate>()
    const storageKeyToResourceId = new Map<string, string>()
    const deduplicatedResources = new Map<string, BackupResourceEntry>()
    const data: BackupManifest['data'] = {}
    let successfullyReadResourceKeys = 0

    throwIfAborted(options.signal)
    options.onProgress?.({ phase: 'preparing', current: 0, total: 1 })
    const allStorageKeys = await options.storage.getAllKeys()
    const sourceConfigVersion = await options.storage.getItem<number | undefined>(
      BackupStorageKey.ConfigVersion,
      undefined
    )

    let cleanedSettings: Record<string, unknown> | undefined
    if (options.exportItems.includes('setting')) {
      const settings = await options.storage.getItem<Settings | null>(BackupStorageKey.Settings, null)
      if (settings) {
        cleanedSettings = cleanSettingsForBackup(settings, options.includeKeys)
        addResourceReferences(
          resourceCandidates,
          collectGlobalResourceReferences(cleanedSettings as Partial<Settings>, undefined)
        )
        const { archive, descriptor } = await jsonEntry(BACKUP_SETTINGS_PATH, cleanedSettings)
        data.settings = descriptor
        yield archive
      }
    }

    if (options.exportItems.includes('copilot')) {
      const copilots = await options.storage.getItem<CopilotDetail[] | null>(BackupStorageKey.MyCopilots, null)
      if (copilots) {
        addResourceReferences(resourceCandidates, collectGlobalResourceReferences(undefined, copilots))
        const { archive, descriptor } = await jsonEntry(BACKUP_COPILOTS_PATH, copilots)
        data.copilots = descriptor
        yield archive
      }
    }

    // The session-settings entry is a generic storage key-value map. It also
    // carries the agent persona keys (exported with 'setting'): older importers
    // read the map through a fixed key allowlist and ignore unknown keys, so no
    // new archive entry or format bump is needed.
    const keyValueEntries: Record<string, unknown> = {}
    const collectKeyValueEntries = async (keys: readonly string[]) => {
      for (const key of keys) {
        if (!allStorageKeys.includes(key)) continue
        const value = await options.storage.getItem<unknown>(key, null)
        if (value !== null) keyValueEntries[key] = value
      }
    }
    if (options.exportItems.includes('conversations')) {
      await collectKeyValueEntries([BackupStorageKey.ChatSessionSettings, BackupStorageKey.PictureSessionSettings])
    }
    if (options.exportItems.includes('setting')) {
      await collectKeyValueEntries(AGENT_PERSONA_BACKUP_KEYS)
    }
    if (options.exportItems.includes('copilot')) {
      await collectKeyValueEntries(COPILOT_BACKUP_KEYS)
    }
    if (Object.keys(keyValueEntries).length > 0) {
      const { archive, descriptor } = await jsonEntry(BACKUP_SESSION_SETTINGS_PATH, keyValueEntries)
      data.sessionSettings = descriptor
      yield archive
    }

    if (options.exportItems.includes('conversations')) {
      const metaStorage = await options.metaStorage
      const allMeta = await metaStorage.getAllIncludingHidden()
      const metaById = new Map(allMeta.map((meta) => [meta.id, meta]))
      const sessionIds = unique([
        ...allMeta.map((meta) => meta.id),
        ...allStorageKeys.filter((key) => key.startsWith('session:')).map((key) => key.slice('session:'.length)),
      ])

      for (let index = 0; index < sessionIds.length; index++) {
        throwIfAborted(options.signal)
        const sessionId = sessionIds[index]
        options.onProgress?.({
          phase: 'sessions',
          current: index,
          total: sessionIds.length,
          label: metaById.get(sessionId)?.name,
        })
        try {
          const session = await options.storage.getItem<Session | null>(backupSessionStorageKey(sessionId), null)
          if (session === null && !metaById.has(sessionId)) continue
          if (!isBackupSession(session)) throw new Error('Session is missing or invalid')
          if (session.id !== sessionId) throw new Error('Session id does not match its storage key')
          const collected = collectSessionResourceReferences(session)
          const preparedSession = prepareSessionForBackup(session)
          const path = `sessions/${await safeSessionPathComponent(session.id)}/session.json`
          const { archive, descriptor } = await jsonEntry(path, preparedSession)
          warnings.push(...collected.warnings)
          addResourceReferences(resourceCandidates, collected.references)
          sessions.push({
            entry: {
              ...descriptor,
              id: session.id,
              meta: deriveSessionMeta(preparedSession, metaById.get(session.id)),
              resourceIds: [],
            },
            resourceStorageKeys: new Set(collected.references.map((reference) => reference.storageKey)),
          })
          yield archive
        } catch (error) {
          warnings.push({
            code: 'session-read-failed',
            itemType: 'session',
            itemId: sessionId,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      options.onProgress?.({ phase: 'sessions', current: sessionIds.length, total: sessionIds.length })
    }

    const resourceCandidateEntries = Array.from(resourceCandidates.entries())
    for (let index = 0; index < resourceCandidateEntries.length; index++) {
      throwIfAborted(options.signal)
      const [storageKey, candidate] = resourceCandidateEntries[index]
      options.onProgress?.({
        phase: 'resources',
        current: index,
        total: resourceCandidateEntries.length,
        label: candidate.references.find((reference) => reference.filename)?.filename,
      })
      try {
        const storedValue = await options.storage.getBlob(storageKey)
        if (storedValue === null) throw new Error('Managed resource is missing from blob storage')
        const firstReference = candidate.references[0]
        const encoded = encodeStoredBlob(storedValue, firstReference)
        if (encoded.bytes.length > MAX_BACKUP_RESOURCE_ENTRY_BYTES) {
          throw new Error('Managed resource exceeds the backup size limit')
        }
        const checksum = await sha256Checksum(encoded.bytes)
        successfullyReadResourceKeys++
        const dedupeKey = `${checksum.value}:${encoded.encoding}:${encoded.mimeType}`
        const existingResource = deduplicatedResources.get(dedupeKey)
        const sessionIds = unique(
          candidate.references.flatMap((reference) => (reference.sessionId ? [reference.sessionId] : []))
        )
        if (existingResource) {
          existingResource.originalStorageKeys.push(storageKey)
          existingResource.sessionIds = unique([...existingResource.sessionIds, ...sessionIds])
          const candidateScope = resolveResourceScope(candidate)
          if (
            existingResource.scope !== candidateScope ||
            (existingResource.scope === 'session' && existingResource.sessionIds.length !== 1)
          ) {
            existingResource.scope = 'shared'
          }
          storageKeyToResourceId.set(storageKey, existingResource.id)
          continue
        }

        const id = `resource-${String(resources.length + 1).padStart(6, '0')}`
        const scope = resolveResourceScope(candidate)
        const path = await resourcePath(id, encoded.extension, scope, sessionIds)
        const resource: BackupResourceEntry = {
          id,
          path,
          originalStorageKeys: [storageKey],
          sessionIds,
          scope,
          encoding: encoded.encoding,
          mimeType: encoded.mimeType,
          kind: firstReference.kind,
          filename: firstReference.filename,
          size: encoded.bytes.length,
          checksum,
        }
        resources.push(resource)
        deduplicatedResources.set(dedupeKey, resource)
        storageKeyToResourceId.set(storageKey, id)
        yield {
          path,
          data: encoded.bytes,
          compress: shouldCompressMimeType(encoded.mimeType),
        }
      } catch (error) {
        warnings.push({
          code: 'resource-read-failed',
          itemType: 'resource',
          itemId: storageKey,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    options.onProgress?.({
      phase: 'resources',
      current: resourceCandidateEntries.length,
      total: resourceCandidateEntries.length,
    })

    for (const session of sessions) {
      session.entry.resourceIds = unique(
        Array.from(session.resourceStorageKeys)
          .map((storageKey) => storageKeyToResourceId.get(storageKey))
          .filter((resourceId): resourceId is string => Boolean(resourceId))
      )
    }

    const manifest = BackupManifestSchema.parse({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: exportedAt.toISOString(),
      application: {
        name: 'Chatbox',
        version: await options.application.version,
        platform: await options.application.platform,
      },
      exportItems: options.exportItems,
      sourceConfigVersion,
      data,
      sessions: sessions.map((session) => session.entry),
      resources,
      warnings,
      stats: {
        sessionCount: sessions.length,
        resourceCount: resources.length,
        deduplicatedResourceCount: Math.max(0, successfullyReadResourceKeys - resources.length),
        warningCount: warnings.length,
      },
    })
    validateBackupManifestGraph(manifest)
    completedManifest = manifest
    options.onProgress?.({ phase: 'packing', current: 0, total: 1 })
    const manifestEntry = await jsonEntry(BACKUP_MANIFEST_PATH, completedManifest)
    yield manifestEntry.archive
    options.onProgress?.({ phase: 'packing', current: 1, total: 1 })
  }

  const writeResult = await options.writeArchive(() =>
    createZipStream(enforceArchiveLimits(generateEntries()), options.signal)
  )
  if (!completedManifest) throw new Error('Backup archive was not fully generated')
  return {
    manifest: completedManifest,
    boundedMemory: writeResult.boundedMemory,
    pendingDownload: writeResult.pendingDownload,
  }
}

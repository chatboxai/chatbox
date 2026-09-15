import type { CopilotDetail, Message, Session, Settings } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { migrateSession } from '../application/session/compatibility/session-load'
import { hasPausedToolCall } from '../application/session/session-metadata'
import {
  combineMemoryStateTokens,
  createMemoryStateToken,
  getSnapshotCopilotLifecycleToken,
  isMemoryStateToken,
  type MemoryToolContext,
  parseCopilotMemoryStateTokens,
} from '../types/agent-persona'
import { throwIfAborted } from './abort'
import {
  BACKUP_MANIFEST_PATH,
  backupEntryByteLimit,
  isBackupJsonPath,
  isBackupResourcePath,
  isBackupSession,
  isBackupSessionPath,
} from './archive-layout'
import {
  decodeBase64Chunks,
  encodeBase64Chunks,
  fingerprintResource,
  resourceExists,
  resourceHash,
  storedResourceChunks,
} from './blob-stream'
import { base64ToBytes, bytesToBase64, decodeStoredBlob, sha256Checksum } from './codec'
import { validateResourceReferences } from './resource-validation'
import {
  collectSessionResourceReferences,
  restoreCopilotResourceKeys,
  restoreSessionMetaResourceKeys,
  restoreSessionResourceKeys,
  restoreSettingsResourceKeys,
} from './resources'
import { importShardedBackup, type ShardedBackupOptions } from './sharded-backup'
import type { BackupManifestV3 } from './sharded-format'
import {
  AGENT_PERSONA_BACKUP_KEYS,
  BackupStorageKey,
  backupSessionStorageKey,
  COPILOT_BACKUP_KEYS,
} from './storage-keys'
import {
  type BackupFile,
  type BackupManifest,
  BackupManifestSchema,
  type BackupMetaStorage,
  type BackupProgress,
  type BackupResourceEntry,
  type BackupStorage,
  type BackupWarning,
  MAX_BACKUP_JSON_ENTRY_BYTES,
  readBackupFileBytes,
  validateBackupManifestGraph,
} from './types'
import { readZipFileEntries } from './zip'

interface StagedEntry {
  path: string
  size: number
  checksum: Awaited<ReturnType<typeof sha256Checksum>>
  tempKey?: string
  value?: unknown
}

interface ResourceWritePlan {
  resource: BackupResourceEntry
  tempKey: string
  targets: Array<{ originalKey: string; targetKey: string; needsWrite: boolean }>
}

interface PreviousValue {
  key: string
  existed: boolean
  rollbackKey?: string
}

interface ImportedMemoryState {
  globalImported: boolean
  sourceGlobalEnabled: boolean
  finalGlobalEnabled: boolean
  sourceGlobalToken: string
  finalGlobalToken: string
  affectedCopilotIds: Set<string>
  sourceCopilotOwners: Set<string>
  finalCopilotOwners: Set<string>
  sourceCopilotTokens: Map<string, string>
  finalCopilotTokens: Map<string, string>
  sourceCopilotLifecycles: Map<string, string>
  finalCopilotLifecycles: Map<string, string>
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function parseCopilotOwnerIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(
    value.flatMap((entry) => {
      const id = objectRecord(entry)?.id
      return typeof id === 'string' ? [id] : []
    })
  )
}

function parseCopilotMemoryIds(value: unknown): Set<string> {
  return new Set(Object.keys(objectRecord(value) ?? {}))
}

function memoryTokenMap(value: unknown): Map<string, string> {
  return new Map(parseCopilotMemoryStateTokens(value).map((entry) => [entry.id, entry.token]))
}

function memoryLifecycleMap(value: unknown): Map<string, string> {
  return new Map(parseCopilotMemoryStateTokens(value).map((entry) => [entry.id, entry.retirementToken ?? entry.token]))
}

interface EffectiveMemoryState {
  scope: 'global' | 'copilot'
  copilotId?: string
  enabled: boolean
  token: string
}

function effectiveMemoryState(
  session: Session,
  owners: Set<string>,
  tokens: Map<string, string>,
  globalEnabled: boolean,
  globalToken: string
): EffectiveMemoryState {
  const copilotToken = session.copilotId ? (tokens.get(session.copilotId) ?? '') : ''
  if (session.copilotId && owners.has(session.copilotId)) {
    return {
      scope: 'copilot',
      copilotId: session.copilotId,
      enabled: true,
      token: combineMemoryStateTokens(copilotToken, ''),
    }
  }
  return {
    scope: 'global',
    enabled: globalEnabled,
    token: combineMemoryStateTokens(copilotToken, globalToken),
  }
}

function snapshotMatchesEffectiveMemoryState(
  snapshot: NonNullable<NonNullable<Session['settings']>['sessionPromptContextSnapshot']>,
  state: EffectiveMemoryState
): boolean {
  return (
    snapshot.memoryCopilotId === state.copilotId &&
    (snapshot.memoryEnabled ?? true) === state.enabled &&
    (snapshot.memoryStateToken ?? '') === state.token
  )
}

export async function resolveImportedMemoryState(
  manifest: BackupManifest,
  stagedEntries: Map<string, StagedEntry>,
  storage: BackupStorage
): Promise<ImportedMemoryState> {
  const [destinationSettingsValue, destinationOwnersValue, destinationTokensValue, destinationMemoriesValue] =
    await Promise.all([
      storage.getItem<unknown>(BackupStorageKey.Settings, null),
      storage.getItem<unknown>(BackupStorageKey.CopilotMemoryOwners, null),
      storage.getItem<unknown>(BackupStorageKey.CopilotMemoryTokens, null),
      storage.getItem<unknown>(BackupStorageKey.CopilotMemories, null),
    ])
  const destinationSettings = objectRecord(destinationSettingsValue)
  const destinationGlobalEnabled = destinationSettings?.memoryEnabled !== false
  const destinationGlobalToken = isMemoryStateToken(destinationSettings?.memoryStateToken)
    ? destinationSettings.memoryStateToken
    : ''

  const globalImported = manifest.exportItems.includes('setting') && Boolean(manifest.data.settings)
  const settingsEntry = manifest.data.settings ? stagedEntries.get(manifest.data.settings.path) : undefined
  const sourceSettings = objectRecord(settingsEntry?.value)
  const sourceGlobalEnabled = globalImported ? sourceSettings?.memoryEnabled !== false : destinationGlobalEnabled
  const sourceGlobalToken = globalImported
    ? isMemoryStateToken(sourceSettings?.memoryStateToken)
      ? sourceSettings.memoryStateToken
      : ''
    : destinationGlobalToken
  const finalGlobalToken = globalImported ? createMemoryStateToken() : destinationGlobalToken
  if (globalImported && settingsEntry && sourceSettings) {
    settingsEntry.value = { ...sourceSettings, memoryStateToken: finalGlobalToken }
  }

  const sessionSettingsEntry = manifest.data.sessionSettings
    ? stagedEntries.get(manifest.data.sessionSettings.path)
    : undefined
  const sessionSettings = objectRecord(sessionSettingsEntry?.value)
  const ownersImported = Boolean(
    sessionSettings && Object.hasOwn(sessionSettings, BackupStorageKey.CopilotMemoryOwners)
  )
  const tokensImported = Boolean(
    sessionSettings && Object.hasOwn(sessionSettings, BackupStorageKey.CopilotMemoryTokens)
  )
  const memoriesImported = Boolean(sessionSettings && Object.hasOwn(sessionSettings, BackupStorageKey.CopilotMemories))

  const destinationOwners = parseCopilotOwnerIds(destinationOwnersValue)
  const destinationTokens = memoryTokenMap(destinationTokensValue)
  const destinationLifecycles = memoryLifecycleMap(destinationTokensValue)
  const destinationMemoryIds = parseCopilotMemoryIds(destinationMemoriesValue)
  const sourceOwners = ownersImported
    ? parseCopilotOwnerIds(sessionSettings?.[BackupStorageKey.CopilotMemoryOwners])
    : destinationOwners
  const sourceTokens = tokensImported
    ? memoryTokenMap(sessionSettings?.[BackupStorageKey.CopilotMemoryTokens])
    : destinationTokens
  const sourceLifecycles = tokensImported
    ? memoryLifecycleMap(sessionSettings?.[BackupStorageKey.CopilotMemoryTokens])
    : ownersImported || memoriesImported
      ? new Map<string, string>()
      : destinationLifecycles
  const sourceMemoryIds = memoriesImported
    ? parseCopilotMemoryIds(sessionSettings?.[BackupStorageKey.CopilotMemories])
    : destinationMemoryIds

  const affectedCopilotIds = new Set<string>()
  if (ownersImported) {
    for (const id of destinationOwners) affectedCopilotIds.add(id)
    for (const id of sourceOwners) affectedCopilotIds.add(id)
  }
  if (tokensImported) {
    for (const id of destinationTokens.keys()) affectedCopilotIds.add(id)
    for (const id of sourceTokens.keys()) affectedCopilotIds.add(id)
  }
  if (memoriesImported) {
    for (const id of destinationMemoryIds) affectedCopilotIds.add(id)
    for (const id of sourceMemoryIds) affectedCopilotIds.add(id)
  }

  const finalTokens = new Map(destinationTokens)
  const finalLifecycles = new Map(destinationLifecycles)
  for (const id of affectedCopilotIds) {
    const token = createMemoryStateToken()
    finalTokens.set(id, token)
    finalLifecycles.set(id, token)
  }
  if (affectedCopilotIds.size > 0 && sessionSettings && sessionSettingsEntry) {
    sessionSettingsEntry.value = {
      ...sessionSettings,
      [BackupStorageKey.CopilotMemoryTokens]: Array.from(finalTokens, ([id, token]) => ({
        id,
        token,
        ...(finalLifecycles.get(id) ? { retirementToken: finalLifecycles.get(id) } : {}),
      })),
    }
  }

  return {
    globalImported,
    sourceGlobalEnabled,
    finalGlobalEnabled: globalImported ? sourceGlobalEnabled : destinationGlobalEnabled,
    sourceGlobalToken,
    finalGlobalToken,
    affectedCopilotIds,
    sourceCopilotOwners: sourceOwners,
    finalCopilotOwners: sourceOwners,
    sourceCopilotTokens: sourceTokens,
    finalCopilotTokens: finalTokens,
    sourceCopilotLifecycles: sourceLifecycles,
    finalCopilotLifecycles: finalLifecycles,
  }
}

export function translateImportedMemoryToolContext(
  context: MemoryToolContext,
  state: ImportedMemoryState
): MemoryToolContext
export function translateImportedMemoryToolContext(context: unknown, state: ImportedMemoryState): unknown
export function translateImportedMemoryToolContext(context: unknown, state: ImportedMemoryState): unknown {
  const record = objectRecord(context)
  const scope = objectRecord(record?.scope)
  const copilotId = scope?.copilotId
  const lifecycleToken = scope?.lifecycleToken
  if (
    scope?.type !== 'copilot' ||
    typeof copilotId !== 'string' ||
    typeof lifecycleToken !== 'string' ||
    !lifecycleToken ||
    !state.affectedCopilotIds.has(copilotId) ||
    lifecycleToken !== state.sourceCopilotLifecycles.get(copilotId)
  )
    return context
  return { ...record, scope: { ...scope, lifecycleToken: state.finalCopilotLifecycles.get(copilotId) } }
}

export function translateImportedMessageMemoryState(message: Message, state: ImportedMemoryState): Message {
  return {
    ...message,
    contentParts: message.contentParts.map((part) =>
      part.type === 'tool-call' && part.memoryToolContext
        ? { ...part, memoryToolContext: translateImportedMemoryToolContext(part.memoryToolContext, state) }
        : part
    ),
  }
}

export function translateImportedSessionMemoryState(session: Session, state: ImportedMemoryState): Session {
  const sourceState = effectiveMemoryState(
    session,
    state.sourceCopilotOwners,
    state.sourceCopilotTokens,
    state.sourceGlobalEnabled,
    state.sourceGlobalToken
  )
  const finalState = effectiveMemoryState(
    session,
    state.finalCopilotOwners,
    state.finalCopilotTokens,
    state.finalGlobalEnabled,
    state.finalGlobalToken
  )
  const contributingStateImported = session.copilotId
    ? sourceState.scope === 'copilot'
      ? [state.affectedCopilotIds.has(session.copilotId)]
      : [state.affectedCopilotIds.has(session.copilotId), state.globalImported]
    : [state.globalImported]
  const allContributingStateImported = contributingStateImported.every(Boolean)
  const noContributingStateImported = contributingStateImported.every((imported) => !imported)
  const translateSnapshot = (
    snapshot: NonNullable<NonNullable<Session['settings']>['sessionPromptContextSnapshot']>
  ) => {
    const id = snapshot.memoryCopilotId
    const lifecycle = id ? getSnapshotCopilotLifecycleToken(snapshot) : undefined
    // Preserve the source identity before translating its prompt-cache token.
    let translated = lifecycle ? { ...snapshot, memoryCopilotLifecycleToken: lifecycle } : snapshot
    if (
      (!id || lifecycle) &&
      (noContributingStateImported ||
        (allContributingStateImported && snapshotMatchesEffectiveMemoryState(snapshot, sourceState)))
    ) {
      translated = { ...translated, memoryStateToken: finalState.token }
    }
    if (id && lifecycle && state.affectedCopilotIds.has(id) && lifecycle === state.sourceCopilotLifecycles.get(id)) {
      translated = { ...translated, memoryCopilotLifecycleToken: state.finalCopilotLifecycles.get(id) }
    }
    return translated
  }
  const translateMessage = (message: Message): Message => translateImportedMessageMemoryState(message, state)
  const currentSnapshot = session.settings?.sessionPromptContextSnapshot
  const threads = session.threads?.map((thread) => ({
    ...thread,
    messages: thread.messages.map(translateMessage),
    ...(thread.sessionPromptContextSnapshot
      ? { sessionPromptContextSnapshot: translateSnapshot(thread.sessionPromptContextSnapshot) }
      : {}),
  }))
  const forks = session.messageForksHash
    ? Object.fromEntries(
        Object.entries(session.messageForksHash).map(([id, fork]) => [
          id,
          { ...fork, lists: fork.lists.map((list) => ({ ...list, messages: list.messages.map(translateMessage) })) },
        ])
      )
    : undefined

  return {
    ...session,
    messages: session.messages.map(translateMessage),
    ...(currentSnapshot
      ? {
          settings: {
            ...session.settings,
            sessionPromptContextSnapshot: translateSnapshot(currentSnapshot),
          },
        }
      : {}),
    ...(threads ? { threads } : {}),
    ...(forks ? { messageForksHash: forks } : {}),
  }
}

export interface BackupImportOptions {
  sharded?: ShardedBackupOptions
  storage: BackupStorage
  metaStorage: BackupMetaStorage
  signal?: AbortSignal
  onProgress?: (progress: BackupProgress) => void
  checksum?: typeof sha256Checksum
  createId?: () => string | Promise<string>
  rehydrateSession?: (
    session: Session
  ) => Promise<{ session: Session; warnings: BackupWarning[]; rollback?: () => Promise<void> }>
}

export interface BackupImportResult {
  manifest: BackupManifest | BackupManifestV3
  warnings: BackupWarning[]
  restoredSessionCount: number
  restoredResourceCount: number
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  if (bytes.length > MAX_BACKUP_JSON_ENTRY_BYTES) throw new Error(`Backup JSON entry is too large: ${path}`)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

function validateManifestEntries(manifest: BackupManifest, stagedEntries: Map<string, StagedEntry>) {
  const descriptors = [
    manifest.data.settings,
    manifest.data.copilots,
    manifest.data.sessionSettings,
    ...manifest.sessions,
    ...manifest.resources,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const expectedPaths = new Set<string>([BACKUP_MANIFEST_PATH])
  for (const descriptor of descriptors) {
    if (expectedPaths.has(descriptor.path)) throw new Error(`Manifest contains a duplicate path: ${descriptor.path}`)
    expectedPaths.add(descriptor.path)
    const staged = stagedEntries.get(descriptor.path)
    if (!staged) throw new Error(`Backup entry is missing: ${descriptor.path}`)
    if (staged.size !== descriptor.size) throw new Error(`Backup entry size mismatch: ${descriptor.path}`)
    if (staged.checksum.value !== descriptor.checksum.value) {
      throw new Error(`Backup entry checksum mismatch: ${descriptor.path}`)
    }
  }
  for (const path of stagedEntries.keys()) {
    if (!expectedPaths.has(path)) throw new Error(`Backup contains an entry not listed in manifest: ${path}`)
  }
  if (expectedPaths.size !== stagedEntries.size) throw new Error('Backup manifest entry list is incomplete')
  validateBackupManifestGraph(manifest)
}

async function readStagedResource(storage: BackupStorage, plan: Pick<ResourceWritePlan, 'resource' | 'tempKey'>) {
  const base64 = await storage.getBlob(plan.tempKey)
  if (base64 === null) throw new Error(`Staged resource is missing: ${plan.resource.path}`)
  return decodeStoredBlob(base64ToBytes(base64), plan.resource.encoding, plan.resource.mimeType)
}

async function findAvailableCollisionKey(
  storage: BackupStorage,
  originalKey: string,
  reserved: Set<string>,
  createId: NonNullable<BackupImportOptions['createId']>,
  signal?: AbortSignal
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    throwIfAborted(signal)
    let candidatePrefix = 'resource:imported'
    for (const prefix of ['picture:', 'file:', 'link:', 'parseFile-', 'parseUrl-']) {
      if (originalKey.startsWith(prefix)) {
        candidatePrefix = `${prefix}imported`
        break
      }
    }
    const candidate = `${candidatePrefix}:${await createId()}`
    if (!reserved.has(candidate) && !(await resourceExists(storage, candidate))) return candidate
  }
  throw new Error(`Could not allocate a resource key for: ${originalKey}`)
}

async function createResourcePlans(
  manifest: BackupManifest,
  stagedEntries: Map<string, StagedEntry>,
  storage: BackupStorage,
  createId: NonNullable<BackupImportOptions['createId']>,
  signal?: AbortSignal
) {
  const plans: ResourceWritePlan[] = []
  const resourceKeyMap = new Map<string, string>()
  const reserved = new Set<string>()
  for (const resource of manifest.resources) {
    const staged = stagedEntries.get(resource.path)
    if (!staged?.tempKey) throw new Error(`Resource was not staged: ${resource.path}`)
    const restoredValue = storage.blobStreams
      ? undefined
      : await readStagedResource(storage, { resource, tempKey: staged.tempKey })
    const targets: ResourceWritePlan['targets'] = []
    for (const originalKey of resource.originalStorageKeys) {
      const streamed = storage.blobStreams
        ? await fingerprintResource(storage, originalKey, resource, signal)
        : undefined
      const existingValue = storage.blobStreams ? undefined : await storage.getBlob(originalKey)
      const exists = storage.blobStreams ? streamed !== null : existingValue !== null
      const matches = storage.blobStreams
        ? streamed?.checksum.value === resource.checksum.value &&
          streamed.size === resource.size &&
          streamed.encoding === resource.encoding &&
          streamed.mimeType === resource.mimeType
        : existingValue === restoredValue
      let targetKey = originalKey
      let needsWrite = !exists
      if (exists && !matches) {
        targetKey = await findAvailableCollisionKey(storage, originalKey, reserved, createId, signal)
        needsWrite = true
      }
      if (reserved.has(targetKey)) {
        targetKey = await findAvailableCollisionKey(storage, originalKey, reserved, createId, signal)
        needsWrite = true
      }
      reserved.add(targetKey)
      resourceKeyMap.set(originalKey, targetKey)
      targets.push({ originalKey, targetKey, needsWrite })
    }
    plans.push({ resource, tempKey: staged.tempKey, targets })
  }
  for (const descriptor of manifest.sessions) {
    const tempKey = stagedEntries.get(descriptor.path)?.tempKey
    const session = tempKey ? await storage.getItem<Session | null>(tempKey, null) : null
    if (!session) throw new Error('Staged session is missing')
    const missing = validateResourceReferences(manifest, collectSessionResourceReferences(session).references)
    for (const key of missing) {
      if (resourceKeyMap.has(key)) continue
      const target = await findAvailableCollisionKey(storage, key, reserved, createId, signal)
      reserved.add(target)
      resourceKeyMap.set(key, target)
    }
  }
  return { plans, resourceKeyMap }
}

export async function isZipBackupFile(file: BackupFile): Promise<boolean> {
  const signature = await readBackupFileBytes(file, 0, 4)
  return (
    signature.length === 4 &&
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    ((signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08))
  )
}

export async function importBackupArchive(file: BackupFile, options: BackupImportOptions): Promise<BackupImportResult> {
  if (options.sharded) {
    const result = await importShardedBackup(file, options, options.sharded)
    if (result) return result
  }
  const createId = options.createId ?? uuidv4
  const importId = await createId()
  const tempPrefix = `__chatbox_backup_import:${importId}`
  const stagedEntries = new Map<string, StagedEntry>()
  const tempStoreKeys: string[] = []
  const tempBlobKeys: string[] = []
  const previousValues: PreviousValue[] = []
  const changedMetaIds: string[] = []
  const previousMeta = new Map<string, Awaited<ReturnType<BackupMetaStorage['getById']>>>()
  const newResourceKeys: string[] = []
  const importWarnings: BackupWarning[] = []
  const rehydrationRollbacks: Array<() => Promise<void>> = []
  let stagedSessionCount = 0
  let stagedResourceCount = 0
  let commitStarted = false
  let commitCompleted = false

  const cleanupTemps = async () => {
    const failures: unknown[] = []
    const remaining: string[] = []
    for (const [keys, remove] of [
      [tempStoreKeys, (key: string) => options.storage.removeItem(key)],
      [tempBlobKeys, (key: string) => options.storage.delBlob(key)],
    ] as const) {
      for (const key of keys)
        try {
          await remove(key)
        } catch (error) {
          failures.push(error)
          remaining.push(key)
        }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Backup ${commitCompleted ? 'data restored; ' : ''}cleanup failed; retained keys: ${remaining.join(', ')}`
      )
  }

  const rollback = async () => {
    const failures: unknown[] = []
    const restore = async (action: () => Promise<unknown>) => {
      try {
        await action()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const rollbackRehydration of rehydrationRollbacks.reverse()) await restore(rollbackRehydration)
    for (const metaId of changedMetaIds.reverse()) {
      await restore(async () => {
        const previous = previousMeta.get(metaId)
        if (!previous) {
          await options.metaStorage.delete(metaId)
          return
        }
        const existing = await options.metaStorage.getById(metaId)
        if (existing) {
          await options.metaStorage.update(metaId, {
            ...previous,
            starred: previous.starred,
            hidden: previous.hidden,
            archivedAt: previous.archivedAt,
            assistantAvatarKey: previous.assistantAvatarKey,
            picUrl: previous.picUrl,
            backgroundImage: previous.backgroundImage,
            type: previous.type,
            hasPausedToolCall: previous.hasPausedToolCall,
            recoveryArchived: previous.recoveryArchived,
          })
        } else await options.metaStorage.create(previous)
      })
    }
    for (const previous of previousValues.reverse()) {
      await restore(async () => {
        if (previous.existed && previous.rollbackKey) {
          const missing = {}
          const value = await options.storage.getItem<unknown>(previous.rollbackKey, missing)
          if (value === missing) throw new Error(`Rollback record is missing: ${previous.key}`)
          await options.storage.setItemNow(previous.key, value)
        } else await options.storage.removeItem(previous.key)
      })
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Backup rollback failed; recovery keys retained: ${previousValues.map((value) => value.key).join(', ')}`
      )
    for (const key of newResourceKeys.reverse()) await restore(() => options.storage.delBlob(key))
    if (failures.length)
      throw new AggregateError(failures, `Backup resource cleanup failed: ${newResourceKeys.join(', ')}`)
  }

  try {
    options.onProgress?.({ phase: 'reading', current: 0, total: file.size })
    let readBytes = 0
    await readZipFileEntries(
      file,
      async (entry) => {
        throwIfAborted(options.signal)
        readBytes += entry.compressedSize ?? entry.uncompressedSize
        options.onProgress?.({
          phase: 'reading',
          current: Math.min(readBytes, file.size),
          total: file.size,
          label: entry.path,
        })
        const checksum = await (options.checksum ?? sha256Checksum)(entry.data)
        const staged: StagedEntry = { path: entry.path, size: entry.uncompressedSize, checksum }
        if (isBackupJsonPath(entry.path) && !isBackupSessionPath(entry.path)) {
          staged.value = parseJson(entry.data, entry.path)
        } else if (isBackupSessionPath(entry.path)) {
          const value = parseJson(entry.data, entry.path)
          if (!isBackupSession(value)) throw new Error(`Invalid session entry: ${entry.path}`)
          const tempKey = `${tempPrefix}:session:${stagedSessionCount++}`
          await options.storage.setItemNow(tempKey, value)
          tempStoreKeys.push(tempKey)
          staged.tempKey = tempKey
        } else if (isBackupResourcePath(entry.path)) {
          const tempKey = `${tempPrefix}:resource:${stagedResourceCount++}`
          await options.storage.setBlob(tempKey, bytesToBase64(entry.data))
          tempBlobKeys.push(tempKey)
          staged.tempKey = tempKey
        } else {
          throw new Error(`Unsupported backup entry: ${entry.path}`)
        }
        stagedEntries.set(entry.path, staged)
      },
      {
        bounded: Boolean(options.storage.blobStreams),
        signal: options.signal,
        streamEntry: options.storage.blobStreams ? isBackupResourcePath : undefined,
        onStreamEntry: async (entry) => {
          const streams = options.storage.blobStreams
          if (!streams) throw new Error('Resource streaming storage is unavailable')
          const tempKey = `${tempPrefix}:resource:${stagedResourceCount++}`
          const hash = resourceHash()
          const bytes = (async function* () {
            for await (const chunk of entry.data) {
              throwIfAborted(options.signal)
              hash.write(chunk)
              yield chunk
            }
          })()
          await streams.write(tempKey, encodeBase64Chunks(bytes))
          tempBlobKeys.push(tempKey)
          stagedEntries.set(entry.path, { path: entry.path, tempKey, ...hash.finish() })
        },
        entryLimits: (path) => ({ maxEntryUncompressedBytes: backupEntryByteLimit(path) }),
      }
    )

    options.onProgress?.({ phase: 'validating', current: 0, total: 1 })
    const manifestValue = stagedEntries.get(BACKUP_MANIFEST_PATH)?.value
    const manifest = BackupManifestSchema.parse(manifestValue)
    validateManifestEntries(manifest, stagedEntries)
    const { plans: resourcePlans, resourceKeyMap } = await createResourcePlans(
      manifest,
      stagedEntries,
      options.storage,
      createId,
      options.signal
    )
    const importedMemoryState = await resolveImportedMemoryState(manifest, stagedEntries, options.storage)
    options.onProgress?.({ phase: 'validating', current: 1, total: 1 })

    const existingStoreKeys = new Set(await options.storage.getAllKeys())
    const changedKeys = [
      ...manifest.sessions.map((session) => backupSessionStorageKey(session.id)),
      ...(manifest.data.settings ? [BackupStorageKey.Settings] : []),
      ...(manifest.data.copilots ? [BackupStorageKey.MyCopilots] : []),
      ...(manifest.data.sessionSettings
        ? [
            BackupStorageKey.ChatSessionSettings,
            BackupStorageKey.PictureSessionSettings,
            ...AGENT_PERSONA_BACKUP_KEYS,
            ...COPILOT_BACKUP_KEYS,
          ]
        : []),
    ]
    for (const key of new Set(changedKeys)) {
      const existed = existingStoreKeys.has(key)
      const previous: PreviousValue = { key, existed }
      if (existed) {
        const rollbackKey = `${tempPrefix}:rollback:${tempStoreKeys.length}`
        const value = await options.storage.getItem<unknown>(key, null)
        await options.storage.setItemNow(rollbackKey, value)
        tempStoreKeys.push(rollbackKey)
        previous.rollbackKey = rollbackKey
      }
      previousValues.push(previous)
    }

    commitStarted = true
    let completedResources = 0
    for (const plan of resourcePlans) {
      throwIfAborted(options.signal)
      const value = options.storage.blobStreams ? undefined : await readStagedResource(options.storage, plan)
      for (const target of plan.targets) {
        if (!target.needsWrite) continue
        if (options.storage.blobStreams) {
          const source = await options.storage.blobStreams.read(plan.tempKey)
          if (!source) throw new Error('Staged resource is missing')
          const hash = resourceHash()
          const bytes = (async function* () {
            for await (const chunk of decodeBase64Chunks(source)) {
              throwIfAborted(options.signal)
              hash.write(chunk)
              yield chunk
            }
            const actual = hash.finish()
            if (actual.size !== plan.resource.size || actual.checksum.value !== plan.resource.checksum.value)
              throw new Error('Staged resource changed during restore')
          })()
          await options.storage.blobStreams.write(target.targetKey, storedResourceChunks(bytes, plan.resource))
          newResourceKeys.push(target.targetKey)
        } else {
          newResourceKeys.push(target.targetKey)
          await options.storage.setBlob(target.targetKey, value!)
        }
      }
      completedResources++
      options.onProgress?.({
        phase: 'restoring',
        current: completedResources,
        total: resourcePlans.length + manifest.sessions.length,
        label: plan.resource.filename,
      })
    }

    for (let index = 0; index < manifest.sessions.length; index++) {
      throwIfAborted(options.signal)
      const descriptor = manifest.sessions[index]
      const tempKey = stagedEntries.get(descriptor.path)?.tempKey
      if (!tempKey) throw new Error(`Session was not staged: ${descriptor.path}`)
      const stagedSession = await options.storage.getItem<Session | null>(tempKey, null)
      if (!isBackupSession(stagedSession) || stagedSession.id !== descriptor.id) {
        throw new Error(`Session id does not match manifest: ${descriptor.path}`)
      }
      let session = restoreSessionResourceKeys(stagedSession, resourceKeyMap)
      if (options.rehydrateSession) {
        const rehydrated = await options.rehydrateSession(session)
        session = rehydrated.session
        importWarnings.push(...rehydrated.warnings)
        if (rehydrated.rollback) rehydrationRollbacks.push(rehydrated.rollback)
      }
      session = translateImportedSessionMemoryState(session, importedMemoryState)
      await options.storage.setItemNow(backupSessionStorageKey(session.id), session)

      const meta = {
        ...restoreSessionMetaResourceKeys(descriptor.meta, resourceKeyMap),
        recoveryArchived: descriptor.meta.recoveryArchived,
        hasPausedToolCall: hasPausedToolCall(migrateSession(session)),
      }
      const existingMeta = await options.metaStorage.getById(session.id)
      previousMeta.set(session.id, existingMeta)
      changedMetaIds.push(session.id)
      if (existingMeta) await options.metaStorage.update(session.id, meta)
      else await options.metaStorage.create(meta)
      options.onProgress?.({
        phase: 'restoring',
        current: resourcePlans.length + index + 1,
        total: resourcePlans.length + manifest.sessions.length,
        label: session.name,
      })
    }

    throwIfAborted(options.signal)
    if (manifest.data.settings) {
      const value = stagedEntries.get(manifest.data.settings.path)?.value
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings entry')
      const restoredSettings = restoreSettingsResourceKeys(value as Partial<Settings>, resourceKeyMap)
      await options.storage.setItemNow(BackupStorageKey.Settings, restoredSettings)
    }
    throwIfAborted(options.signal)
    if (manifest.data.copilots) {
      const value = stagedEntries.get(manifest.data.copilots.path)?.value
      if (!Array.isArray(value)) throw new Error('Invalid copilots entry')
      await options.storage.setItemNow(
        BackupStorageKey.MyCopilots,
        restoreCopilotResourceKeys(value as CopilotDetail[], resourceKeyMap)
      )
    }
    if (manifest.data.sessionSettings) {
      const value = stagedEntries.get(manifest.data.sessionSettings.path)?.value
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session settings entry')
      const sessionSettings = value as Record<string, unknown>
      for (const key of [
        BackupStorageKey.ChatSessionSettings,
        BackupStorageKey.PictureSessionSettings,
        ...AGENT_PERSONA_BACKUP_KEYS,
        ...COPILOT_BACKUP_KEYS,
      ]) {
        throwIfAborted(options.signal)
        if (key in sessionSettings) await options.storage.setItemNow(key, sessionSettings[key])
      }
    }

    throwIfAborted(options.signal)
    commitCompleted = true
    await cleanupTemps()
    return {
      manifest,
      warnings: [...manifest.warnings, ...importWarnings],
      restoredSessionCount: manifest.sessions.length,
      restoredResourceCount: manifest.resources.length,
    }
  } catch (error) {
    if (commitCompleted) throw error
    if (commitStarted) {
      try {
        await rollback()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Backup rollback failed; recovery data retained (${importId})`)
      }
    }
    try {
      await cleanupTemps()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Backup failed and temporary cleanup is incomplete')
    }
    throw error
  }
}

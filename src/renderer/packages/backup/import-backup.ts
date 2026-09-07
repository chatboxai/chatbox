import type { CopilotDetail, Session, Settings } from '@shared/types'
import {
  combineMemoryStateTokens,
  createMemoryStateToken,
  isMemoryStateToken,
  parseCopilotMemoryStateTokens,
} from '@shared/types/agent-persona'
import { v4 as uuidv4 } from 'uuid'
import {
  BACKUP_MANIFEST_PATH,
  backupEntryByteLimit,
  isBackupJsonPath,
  isBackupResourcePath,
  isBackupSession,
  isBackupSessionPath,
} from './archive-layout'
import { base64ToBytes, bytesToBase64, decodeStoredBlob, sha256Checksum } from './codec'
import {
  restoreCopilotResourceKeys,
  restoreSessionMetaResourceKeys,
  restoreSessionResourceKeys,
  restoreSettingsResourceKeys,
} from './resources'
import {
  AGENT_PERSONA_BACKUP_KEYS,
  BackupStorageKey,
  backupSessionStorageKey,
  COPILOT_BACKUP_KEYS,
} from './storage-keys'
import {
  type BackupManifest,
  BackupManifestSchema,
  type BackupMetaStorage,
  type BackupProgress,
  type BackupResourceEntry,
  type BackupStorage,
  type BackupWarning,
  MAX_BACKUP_JSON_ENTRY_BYTES,
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

async function resolveImportedMemoryState(
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

  const globalImported = Boolean(manifest.data.settings)
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
  const destinationMemoryIds = parseCopilotMemoryIds(destinationMemoriesValue)
  const sourceOwners = ownersImported
    ? parseCopilotOwnerIds(sessionSettings?.[BackupStorageKey.CopilotMemoryOwners])
    : destinationOwners
  const sourceTokens = tokensImported
    ? memoryTokenMap(sessionSettings?.[BackupStorageKey.CopilotMemoryTokens])
    : destinationTokens
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
  for (const id of affectedCopilotIds) finalTokens.set(id, createMemoryStateToken())
  if (affectedCopilotIds.size > 0 && sessionSettings && sessionSettingsEntry) {
    sessionSettingsEntry.value = {
      ...sessionSettings,
      [BackupStorageKey.CopilotMemoryTokens]: Array.from(finalTokens, ([id, token]) => ({ id, token })),
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
  }
}

function translateImportedSessionMemoryState(session: Session, state: ImportedMemoryState): Session {
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
    if (
      noContributingStateImported ||
      (allContributingStateImported && snapshotMatchesEffectiveMemoryState(snapshot, sourceState))
    ) {
      return { ...snapshot, memoryStateToken: finalState.token }
    }
    return snapshot
  }
  const currentSnapshot = session.settings?.sessionPromptContextSnapshot
  const threads = session.threads?.map((thread) =>
    thread.sessionPromptContextSnapshot
      ? {
          ...thread,
          sessionPromptContextSnapshot: translateSnapshot(thread.sessionPromptContextSnapshot),
        }
      : thread
  )

  return {
    ...session,
    ...(currentSnapshot
      ? {
          settings: {
            ...session.settings,
            sessionPromptContextSnapshot: translateSnapshot(currentSnapshot),
          },
        }
      : {}),
    ...(threads ? { threads } : {}),
  }
}

export interface BackupImportOptions {
  storage: BackupStorage
  metaStorage: BackupMetaStorage
  signal?: AbortSignal
  onProgress?: (progress: BackupProgress) => void
  rehydrateSession?: (
    session: Session
  ) => Promise<{ session: Session; warnings: BackupWarning[]; rollback?: () => Promise<void> }>
}

export interface BackupImportResult {
  manifest: BackupManifest
  warnings: BackupWarning[]
  restoredSessionCount: number
  restoredResourceCount: number
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation canceled', 'AbortError')
  }
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

async function findAvailableCollisionKey(storage: BackupStorage, originalKey: string, reserved: Set<string>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let candidatePrefix = 'resource:imported'
    for (const prefix of ['picture:', 'file:', 'link:', 'parseFile-', 'parseUrl-']) {
      if (originalKey.startsWith(prefix)) {
        candidatePrefix = `${prefix}imported`
        break
      }
    }
    const candidate = `${candidatePrefix}:${uuidv4()}`
    if (!reserved.has(candidate) && (await storage.getBlob(candidate)) === null) return candidate
  }
  throw new Error(`Could not allocate a resource key for: ${originalKey}`)
}

async function createResourcePlans(
  manifest: BackupManifest,
  stagedEntries: Map<string, StagedEntry>,
  storage: BackupStorage
) {
  const plans: ResourceWritePlan[] = []
  const resourceKeyMap = new Map<string, string>()
  const reserved = new Set<string>()
  for (const resource of manifest.resources) {
    const staged = stagedEntries.get(resource.path)
    if (!staged?.tempKey) throw new Error(`Resource was not staged: ${resource.path}`)
    const restoredValue = await readStagedResource(storage, { resource, tempKey: staged.tempKey })
    const targets: ResourceWritePlan['targets'] = []
    for (const originalKey of resource.originalStorageKeys) {
      const existingValue = await storage.getBlob(originalKey)
      let targetKey = originalKey
      let needsWrite = existingValue === null
      if (existingValue !== null && existingValue !== restoredValue) {
        targetKey = await findAvailableCollisionKey(storage, originalKey, reserved)
        needsWrite = true
      }
      if (reserved.has(targetKey)) {
        targetKey = await findAvailableCollisionKey(storage, originalKey, reserved)
        needsWrite = true
      }
      reserved.add(targetKey)
      resourceKeyMap.set(originalKey, targetKey)
      targets.push({ originalKey, targetKey, needsWrite })
    }
    plans.push({ resource, tempKey: staged.tempKey, targets })
  }
  return { plans, resourceKeyMap }
}

export async function isZipBackupFile(file: File): Promise<boolean> {
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return (
    signature.length === 4 &&
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    ((signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08))
  )
}

export async function importBackupArchive(file: File, options: BackupImportOptions): Promise<BackupImportResult> {
  const importId = uuidv4()
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

  const cleanupTemps = async () => {
    for (const key of tempStoreKeys) await options.storage.removeItem(key).catch(() => undefined)
    for (const key of tempBlobKeys) await options.storage.delBlob(key).catch(() => undefined)
  }

  const rollback = async () => {
    for (const rollbackRehydration of rehydrationRollbacks.reverse()) {
      await rollbackRehydration().catch(() => undefined)
    }
    for (const metaId of changedMetaIds.reverse()) {
      const previous = previousMeta.get(metaId)
      if (previous) {
        const existing = await options.metaStorage.getById(metaId).catch(() => null)
        if (existing) await options.metaStorage.update(metaId, previous).catch(() => null)
        else await options.metaStorage.create(previous).catch(() => undefined)
      } else {
        await options.metaStorage.delete(metaId).catch(() => undefined)
      }
    }
    for (const previous of previousValues.reverse()) {
      if (previous.existed && previous.rollbackKey) {
        const value = await options.storage.getItem<unknown>(previous.rollbackKey, null)
        await options.storage.setItemNow(previous.key, value).catch(() => undefined)
      } else {
        await options.storage.removeItem(previous.key).catch(() => undefined)
      }
    }
    for (const key of newResourceKeys.reverse()) await options.storage.delBlob(key).catch(() => undefined)
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
        const checksum = await sha256Checksum(entry.data)
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
        signal: options.signal,
        entryLimits: (path) => ({ maxEntryUncompressedBytes: backupEntryByteLimit(path) }),
      }
    )

    options.onProgress?.({ phase: 'validating', current: 0, total: 1 })
    const manifestValue = stagedEntries.get(BACKUP_MANIFEST_PATH)?.value
    const manifest = BackupManifestSchema.parse(manifestValue)
    validateManifestEntries(manifest, stagedEntries)
    const { plans: resourcePlans, resourceKeyMap } = await createResourcePlans(manifest, stagedEntries, options.storage)
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
      const value = await readStagedResource(options.storage, plan)
      for (const target of plan.targets) {
        if (!target.needsWrite) continue
        newResourceKeys.push(target.targetKey)
        await options.storage.setBlob(target.targetKey, value)
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

      const meta = restoreSessionMetaResourceKeys(descriptor.meta, resourceKeyMap)
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

    if (manifest.data.settings) {
      const value = stagedEntries.get(manifest.data.settings.path)?.value
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings entry')
      await options.storage.setItemNow(
        BackupStorageKey.Settings,
        restoreSettingsResourceKeys(value as Partial<Settings>, resourceKeyMap)
      )
    }
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
        if (key in sessionSettings) await options.storage.setItemNow(key, sessionSettings[key])
      }
    }

    await cleanupTemps()
    return {
      manifest,
      warnings: [...manifest.warnings, ...importWarnings],
      restoredSessionCount: manifest.sessions.length,
      restoredResourceCount: manifest.resources.length,
    }
  } catch (error) {
    if (commitStarted) await rollback()
    await cleanupTemps()
    throw error
  }
}

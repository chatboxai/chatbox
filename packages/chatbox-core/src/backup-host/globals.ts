import { ImageSourceSchema, SessionFolderSchema, SessionSettingsSchema } from '@shared/types'
import deepmerge from 'deepmerge'
import { z } from 'zod'
import { projectSettingsForExport } from '../application/settings/export-projection'
import type { BackupBusinessRecord, BackupImportContext, BackupManifest, BackupSelection } from '../backup-v3/types'
import { SettingsSchema, createDefaultSettings, mergeSettingsWithDefaults } from '../domain/settings'
import type { KeyValueStoragePort } from '../ports/key-value-storage'
import type { Message, SessionHeader } from '../types/session'
import {
  combineMemoryStateTokens,
  isMemoryStateToken,
  MemoryEntrySchema,
  createMemoryStateToken,
  getSnapshotCopilotLifecycleToken,
  parseCopilotMemoryStateTokens,
  type SessionPromptContextSnapshot,
} from '../types/agent-persona'
import type { BackupHostOptions } from './types'
import { throwIfAborted } from '../utils/abort'

export const GLOBAL_KEYS = {
  settings: 'settings',
  copilots: 'myCopilots',
  folders: 'session-folders',
  soul: 'agent-soul',
  memories: 'agent-memories',
  copilotMemories: 'copilot-memories',
  owners: 'copilot-memory-owners',
  tokens: 'copilot-memory-state-tokens',
} as const
const SHARED_KEYS = ['chat-session-settings', 'picture-session-settings']
const MAX_GLOBAL_BYTES = 32 * 1024 * 1024

/** Each retained global collection and final values has an aggregate UTF-8 budget. */
export class GlobalDataBudget {
  private bytes = 0

  serialize(value: unknown): string {
    const json = JSON.stringify(value)
    if (json === undefined) throw new Error('Global backup data is not serializable')
    if (json.length > MAX_GLOBAL_BYTES - this.bytes) throw new Error('Global backup data exceeds its size budget')
    this.bytes += new TextEncoder().encode(json).length
    if (this.bytes > MAX_GLOBAL_BYTES) throw new Error('Global backup data exceeds its size budget')
    return json
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup global object')
  return value as Record<string, unknown>
}
function list(value: unknown): unknown[] {
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error('Invalid backup global collection')
  return value
}
function id(value: unknown): string {
  const key = object(value).id
  if (typeof key !== 'string' || !key) throw new Error('Invalid backup global identity')
  return key
}
type Global = Extract<BackupBusinessRecord, { type: 'global' }>
function globalStorageKey(record: Global): string {
  switch (record.category) {
    case 'settings':
      return GLOBAL_KEYS.settings
    case 'copilot':
      return GLOBAL_KEYS.copilots
    case 'folder':
      return GLOBAL_KEYS.folders
    case 'soul':
      return GLOBAL_KEYS.soul
    case 'global-memory':
      return GLOBAL_KEYS.memories
    case 'copilot-memory':
      return GLOBAL_KEYS.copilotMemories
    case 'memory-identities':
      return record.id.startsWith('owner:') ? GLOBAL_KEYS.owners : GLOBAL_KEYS.tokens
    case 'session-settings':
      return record.id
  }
}
const row = (category: Global['category'], id: string, value: unknown): Global => ({
  type: 'global',
  category,
  id,
  value,
})

const portableId = z.string().min(1).max(4096)
const copilotSchema = z
  .object({
    id: portableId,
    name: z.string(),
    prompt: z.string(),
    picUrl: z.string().optional(),
    avatar: ImageSourceSchema.optional(),
    backgroundImage: ImageSourceSchema.optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    screenshots: z.array(ImageSourceSchema).optional(),
    createdAt: z.number().finite().optional(),
    updatedAt: z.number().finite().optional(),
    usedCount: z.number().finite().optional(),
    sourceId: z.string().optional(),
    starred: z.boolean().optional(),
  })
  .passthrough()
const memorySchema = MemoryEntrySchema.extend({ id: portableId, createdAt: z.number().finite() }).passthrough()
const ownerSchema = z.object({ id: portableId, name: z.string() }).passthrough()
const tokenSchema = z
  .object({
    id: portableId,
    token: z.string().refine(isMemoryStateToken),
    retirementToken: z.string().refine(isMemoryStateToken).optional(),
  })
  .passthrough()
const soulSchema = z.object({ content: z.string(), updatedAt: z.number().finite() }).passthrough()

function validateSettingsFields(value: unknown, shape: Record<string, z.ZodType>): Record<string, unknown> {
  const fields = object(value)
  for (const [key, field] of Object.entries(shape)) {
    if (!Object.hasOwn(fields, key)) continue
    let validator = field
    while (validator instanceof z.ZodCatch) validator = validator.unwrap() as z.ZodType
    validator.parse(fields[key])
  }
  return fields
}

/** Validate foreign values before they can become normal application storage. */
export function validateBackupGlobal(record: Global): void {
  switch (record.category) {
    case 'settings': {
      // Older backups omit fields added later; settings migration fills them from defaults before committing.
      const settings = deepmerge(createDefaultSettings(), object(record.value), {
        arrayMerge: (_target, source) => source,
      })
      SettingsSchema.parse(mergeSettingsWithDefaults(validateSettingsFields(settings, SettingsSchema.shape)))
      break
    }
    case 'copilot':
      copilotSchema.parse(record.value)
      break
    case 'session-settings':
      SessionSettingsSchema.parse(validateSettingsFields(record.value, SessionSettingsSchema.shape))
      break
    case 'folder':
      SessionFolderSchema.extend({ id: portableId }).parse(record.value)
      break
    case 'soul':
      soulSchema.parse(record.value)
      break
    case 'global-memory':
      memorySchema.parse(record.value)
      break
    case 'copilot-memory': {
      const entries = z.array(memorySchema).parse(record.value)
      const ids = new Set<string>()
      for (const entry of entries) {
        if (ids.has(entry.id)) throw new Error('Duplicate Copilot memory identity')
        ids.add(entry.id)
      }
      break
    }
    case 'memory-identities':
      if (record.id.startsWith('owner:')) ownerSchema.parse(record.value)
      else if (record.id.startsWith('token:')) tokenSchema.parse(record.value)
      else throw new Error('Invalid memory identity record')
      break
  }
}

export async function* exportGlobals(
  options: BackupHostOptions,
  selection: BackupSelection,
  signal?: AbortSignal
): AsyncIterable<Global> {
  const sourceBudget = new GlobalDataBudget()
  const get = async (key: string) => {
    const value = await options.storage.get(key)
    sourceBudget.serialize(value)
    return value
  }
  const budget = new GlobalDataBudget()
  async function* bounded(records: AsyncIterable<Global>) {
    for await (const record of records) {
      validateBackupGlobal(record)
      budget.serialize(record)
      yield record
    }
  }
  async function* records(): AsyncIterable<Global> {
    if (selection.settings) {
      yield row('settings', 'settings', projectSettingsForExport(options.getSettings(), selection.credentials))
      const soul = await get(GLOBAL_KEYS.soul)
      if (soul !== null) yield row('soul', GLOBAL_KEYS.soul, soul)
      for (const memory of list(await get(GLOBAL_KEYS.memories))) yield row('global-memory', id(memory), memory)
    }
    if (selection.copilots) {
      for (const copilot of list(await get(GLOBAL_KEYS.copilots))) yield row('copilot', id(copilot), copilot)
      for (const [key, value] of Object.entries(object((await get(GLOBAL_KEYS.copilotMemories)) ?? {})))
        yield row('copilot-memory', key, value)
      for (const owner of list(await get(GLOBAL_KEYS.owners)))
        yield row('memory-identities', `owner:${id(owner)}`, owner)
      for (const token of list(await get(GLOBAL_KEYS.tokens)))
        yield row('memory-identities', `token:${id(token)}`, token)
    }
    if (selection.sessions) {
      for (const key of SHARED_KEYS) {
        const value = await get(key)
        if (value !== null) yield row('session-settings', key, value)
      }
      let selectedFolderIds: Set<string> | undefined
      if (selection.sessionIds !== undefined) {
        selectedFolderIds = new Set<string>()
        for (const sessionId of selection.sessionIds) {
          throwIfAborted(signal)
          await options.ensureRows(sessionId)
          const commit = await options.rows.readCommit(sessionId)
          if (!commit) throw new Error(`Conversation is unavailable: ${sessionId}`)
          if (commit.record.folderId) selectedFolderIds.add(commit.record.folderId)
        }
      }
      for (const folder of list(await get(GLOBAL_KEYS.folders))) {
        const folderId = id(folder)
        if (selectedFolderIds === undefined || selectedFolderIds.has(folderId)) yield row('folder', folderId, folder)
      }
    }
  }
  yield* bounded(records())
}

/** Small global collections have an explicit aggregate budget, independent of message volume. */
export class ImportedGlobals {
  private readonly records: Global[] = []
  private readonly inputBudget = new GlobalDataBudget()
  private values: Map<string, unknown> | null = null
  private sourceSettings: Record<string, unknown> = {}
  private sourceOwners = new Set<string>()
  private sourceTokens = new Map<string, string>()
  private sourceLifetimes = new Map<string, string>()
  private finalTokens = new Map<string, string>()
  private globalToken = ''
  private readonly invalidToken = createMemoryStateToken()
  private readonly includedGlobalKeys: ReadonlySet<string> | undefined
  constructor(
    private readonly manifest: BackupManifest,
    private readonly storage: KeyValueStoragePort,
    context?: BackupImportContext
  ) {
    this.includedGlobalKeys = context?.includedGlobalKeys ? new Set(context.includedGlobalKeys) : undefined
  }

  private includes(key: string): boolean {
    return this.includedGlobalKeys?.has(key) ?? true
  }

  private get includesCopilotMemory(): boolean {
    return (
      this.manifest.selection.copilots &&
      [GLOBAL_KEYS.copilotMemories, GLOBAL_KEYS.owners, GLOBAL_KEYS.tokens].every((key) => this.includes(key))
    )
  }

  append(record: Global): void {
    validateBackupGlobal(record)
    if (!this.includes(globalStorageKey(record))) throw new Error('Global record is not included in the import context')
    if (this.values) throw new Error('Global records must precede sessions')
    this.inputBudget.serialize(record)
    this.records.push(record)
  }

  async prepare(): Promise<Map<string, unknown>> {
    if (this.values) return this.values
    const values = new Map<string, unknown>()
    const previousBudget = new GlobalDataBudget()
    const getPrevious = async (key: string) => {
      const value = await this.storage.get(key)
      previousBudget.serialize(value)
      return value
    }
    const copilots: unknown[] = [],
      memories: unknown[] = [],
      owners: unknown[] = [],
      tokens: unknown[] = []
    const copilotMemories = Object.create(null) as Record<string, unknown>
    const folders: unknown[] = []
    for (const record of this.records) {
      switch (record.category) {
        case 'settings':
          if (!this.manifest.selection.settings || record.id !== 'settings' || values.has(GLOBAL_KEYS.settings))
            throw new Error('Invalid settings record')
          this.sourceSettings = object(record.value)
          this.globalToken = createMemoryStateToken()
          values.set(GLOBAL_KEYS.settings, { ...this.sourceSettings, memoryStateToken: this.globalToken })
          break
        case 'copilot':
          if (id(record.value) !== record.id) throw new Error('Invalid Copilot identity')
          copilots.push(record.value)
          break
        case 'global-memory':
          if (id(record.value) !== record.id) throw new Error('Invalid memory identity')
          memories.push(record.value)
          break
        case 'copilot-memory':
          copilotMemories[record.id] = list(record.value)
          break
        case 'memory-identities':
          if (record.id === `owner:${id(record.value)}`) owners.push(record.value)
          else if (record.id === `token:${id(record.value)}`) tokens.push(record.value)
          else throw new Error('Invalid memory identity record')
          break
        case 'soul':
          if (record.id !== GLOBAL_KEYS.soul) throw new Error('Invalid Soul key')
          values.set(GLOBAL_KEYS.soul, record.value)
          break
        case 'session-settings':
          if (!SHARED_KEYS.includes(record.id)) throw new Error('Invalid shared settings key')
          values.set(record.id, object(record.value))
          break
        case 'folder':
          if (id(record.value) !== record.id) throw new Error('Invalid folder identity')
          folders.push(record.value)
          break
      }
    }
    if (this.manifest.selection.settings) {
      if (this.includes(GLOBAL_KEYS.settings)) {
        if (!values.has(GLOBAL_KEYS.settings)) throw new Error('Backup settings are missing')
        // Validate portable fields; the owning SettingsService supplies host defaults when reloading.
        SettingsSchema.parse(mergeSettingsWithDefaults(values.get(GLOBAL_KEYS.settings)))
      }
      if (this.includes(GLOBAL_KEYS.memories)) {
        if (!this.includes(GLOBAL_KEYS.settings)) {
          this.globalToken = createMemoryStateToken()
          values.set(GLOBAL_KEYS.settings, {
            ...object((await getPrevious(GLOBAL_KEYS.settings)) ?? {}),
            memoryStateToken: this.globalToken,
          })
        }
        values.set(GLOBAL_KEYS.memories, memories)
      }
    }
    if (this.manifest.selection.copilots) {
      if (this.includes(GLOBAL_KEYS.copilots)) values.set(GLOBAL_KEYS.copilots, copilots)
      if (this.includes(GLOBAL_KEYS.copilotMemories)) values.set(GLOBAL_KEYS.copilotMemories, copilotMemories)
      if (this.includes(GLOBAL_KEYS.owners)) values.set(GLOBAL_KEYS.owners, owners)
    }
    if (
      this.manifest.selection.copilots &&
      [GLOBAL_KEYS.copilotMemories, GLOBAL_KEYS.owners, GLOBAL_KEYS.tokens].some((key) => this.includes(key))
    ) {
      const previousTokens = parseCopilotMemoryStateTokens(await getPrevious(GLOBAL_KEYS.tokens))
      const previousOwners = this.includes(GLOBAL_KEYS.owners) ? list(await getPrevious(GLOBAL_KEYS.owners)) : []
      const previousMemories = this.includes(GLOBAL_KEYS.copilotMemories)
        ? object((await getPrevious(GLOBAL_KEYS.copilotMemories)) ?? {})
        : {}
      this.sourceOwners = new Set(owners.map(id))
      const sourceTokens = parseCopilotMemoryStateTokens(tokens)
      this.sourceTokens = new Map(sourceTokens.map((value) => [value.id, value.token]))
      this.sourceLifetimes = new Map(sourceTokens.map((value) => [value.id, value.retirementToken ?? value.token]))
      const affected = new Set([
        ...previousOwners.map(id),
        ...Object.keys(previousMemories),
        ...owners.map(id),
        ...sourceTokens.map((value) => value.id),
        ...Object.keys(copilotMemories),
        ...(this.includedGlobalKeys && this.includes(GLOBAL_KEYS.tokens)
          ? previousTokens.map((value) => value.id)
          : []),
      ])
      this.finalTokens = new Map([...affected].map((key) => [key, createMemoryStateToken()]))
      values.set(GLOBAL_KEYS.tokens, [
        ...previousTokens.filter((value) => !affected.has(value.id)),
        ...[...this.finalTokens].map(([id, token]) => ({ id, token, retirementToken: token })),
      ])
    }
    if (this.manifest.selection.sessions && folders.length) {
      const existing = list(await getPrevious(GLOBAL_KEYS.folders))
      const ids = new Set(existing.map(id))
      values.set(GLOBAL_KEYS.folders, [...existing, ...folders.filter((folder) => !ids.has(id(folder)))])
    }
    const finalBudget = new GlobalDataBudget()
    for (const [key, value] of values) finalBudget.serialize({ key, value })
    this.values = values
    return values
  }

  snapshot(
    snapshot: SessionPromptContextSnapshot,
    session: Pick<SessionHeader, 'copilotId'>
  ): SessionPromptContextSnapshot {
    const copilotId = snapshot.memoryCopilotId
    const lifetime = getSnapshotCopilotLifecycleToken(snapshot)
    const validLifetime =
      this.includesCopilotMemory && !!copilotId && !!lifetime && this.sourceLifetimes.get(copilotId) === lifetime
    const sourceCopilot = session.copilotId ? (this.sourceTokens.get(session.copilotId) ?? '') : ''
    const ownMemory = !!session.copilotId && this.sourceOwners.has(session.copilotId)
    const fullyImported = ownMemory
      ? this.includesCopilotMemory
      : this.manifest.selection.settings &&
        this.includes(GLOBAL_KEYS.settings) &&
        this.includes(GLOBAL_KEYS.memories) &&
        (!session.copilotId || this.includesCopilotMemory)
    const sourceGlobal =
      typeof this.sourceSettings.memoryStateToken === 'string' ? this.sourceSettings.memoryStateToken : ''
    const matches =
      snapshot.memoryStateToken === combineMemoryStateTokens(sourceCopilot, ownMemory ? '' : sourceGlobal) &&
      snapshot.memoryCopilotId === (ownMemory ? session.copilotId : undefined) &&
      (snapshot.memoryEnabled ?? true) === (ownMemory || this.sourceSettings.memoryEnabled !== false)
    const finalCopilot = session.copilotId ? (this.finalTokens.get(session.copilotId) ?? '') : ''
    return {
      ...snapshot,
      memoryStateToken:
        fullyImported && matches
          ? combineMemoryStateTokens(finalCopilot, ownMemory ? '' : this.globalToken)
          : this.invalidToken,
      ...(copilotId
        ? {
            memoryCopilotLifecycleToken: validLifetime
              ? (this.finalTokens.get(copilotId) ?? this.invalidToken)
              : this.invalidToken,
          }
        : {}),
    }
  }

  message(message: Message): Message {
    return {
      ...message,
      contentParts: message.contentParts.map((part) => {
        if (part.type !== 'tool-call' || !part.memoryToolContext || part.memoryToolContext.scope.type !== 'copilot')
          return part
        const context = part.memoryToolContext,
          scope = context.scope
        if (scope.type !== 'copilot') return part
        const valid =
          this.includesCopilotMemory &&
          !!scope.lifecycleToken &&
          this.sourceLifetimes.get(scope.copilotId) === scope.lifecycleToken
        return {
          ...part,
          memoryToolContext: {
            ...context,
            scope: {
              ...scope,
              lifecycleToken: valid ? (this.finalTokens.get(scope.copilotId) ?? this.invalidToken) : this.invalidToken,
            },
          },
        }
      }),
    }
  }
}

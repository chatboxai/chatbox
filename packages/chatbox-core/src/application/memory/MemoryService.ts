import { z } from 'zod'
import type { KeyValueStoragePort } from '../../ports'
import {
  type CopilotMemoryStateToken,
  combineMemoryStateTokens,
  MEMORY_ENTRY_MAX_CHARS,
  MEMORY_MAX_ENTRIES,
  type MemoryEntry,
  MemoryEntrySchema,
  type MemoryScope,
  parseCopilotMemoryStateTokens,
  type SessionPromptContextSnapshot,
} from '../../types/agent-persona'
import {
  COPILOT_MEMORY_OWNERS_STORAGE_KEY,
  COPILOT_MEMORY_TOKENS_STORAGE_KEY,
  type CopilotMemoryOwner,
  type CopilotMemorySelection,
  type MemoryPreferenceList,
  MemoryPreferences,
} from './MemoryPreferences'

export const AGENT_MEMORIES_STORAGE_KEY = 'agent-memories'
export const COPILOT_MEMORIES_STORAGE_KEY = 'copilot-memories'
const MemoriesSchema = z.array(MemoryEntrySchema).catch([])
const CopilotMemoriesSchema = z.record(z.string(), MemoriesSchema).catch({})
const OwnersSchema = z.array(z.object({ id: z.string(), name: z.string() })).catch([])

export type AddMemoryResult = { ok: true; entry: MemoryEntry } | { ok: false; error: string }
const MEMORY_CONTEXT_UNAVAILABLE_MESSAGE =
  'The memory context for this call is no longer available. Start a new generation.'

export class MemoryContextUnavailableError extends Error {
  constructor() {
    super(MEMORY_CONTEXT_UNAVAILABLE_MESSAGE)
    this.name = 'MemoryContextUnavailableError'
  }
}

export interface ImportMemoriesResult {
  imported: number
  skippedDuplicate: number
  skippedEmpty: number
  skippedTooLong: number
  skippedLimit: number
}
export interface MemorySnapshot {
  memories: MemoryEntry[]
  copilotMemories: Record<string, MemoryEntry[]>
  owners: CopilotMemoryOwner[]
  tokens: CopilotMemoryStateToken[]
  isLoading: boolean
  error: Error | null
}
export interface EffectiveMemoryState {
  scope: MemoryScope
  enabled: boolean
  memoryStateToken: string
}
export interface MemoryStateSettings {
  memoryEnabled?: boolean
  memoryStateToken?: string
}
export interface MemoryStorageScope {
  /** Read imported or rolled-back values without re-entering the service queue. */
  reload(): Promise<void>
}
export interface MemoryServiceOptions {
  storage: Pick<KeyValueStoragePort, 'get' | 'set'>
  preferenceLists?: {
    owners: StoredPreferenceList<CopilotMemoryOwner>
    tokens: StoredPreferenceList<CopilotMemoryStateToken>
  }
  now?: () => number
  createId?: () => string
  createStateToken?: () => string
}
export interface StoredPreferenceList<T> extends MemoryPreferenceList<T> {
  reload(): Promise<T[]>
}
export type LiveMemoryPreferences = Pick<
  MemoryPreferences,
  'enable' | 'disable' | 'select' | 'isEnabled' | 'pausedScope'
>

/** Owns durable memory values and serializes them with backup access. */
export class MemoryService {
  private snapshot: MemorySnapshot = {
    memories: [],
    copilotMemories: {},
    owners: [],
    tokens: [],
    isLoading: true,
    error: null,
  }
  private queue: Promise<unknown> = Promise.resolve()
  private hydrated = false
  private hydrationPromise: Promise<void> | null = null
  private readonly listeners = new Set<() => void>()
  private readonly epochs = new Map<string, number>()
  private readonly owners: StoredPreferenceList<CopilotMemoryOwner>
  private readonly tokens: StoredPreferenceList<CopilotMemoryStateToken>
  private readonly preferences: MemoryPreferences
  /** Hosts with optimistic UI mirrors share the resolver used by durable mutations. */
  readonly livePreferences: LiveMemoryPreferences
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly options: MemoryServiceOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => `m${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
    this.owners = this.preferenceList(
      COPILOT_MEMORY_OWNERS_STORAGE_KEY,
      (value) => OwnersSchema.parse(value),
      (owners) => this.publish({ owners }),
      options.preferenceLists?.owners
    )
    this.tokens = this.preferenceList(
      COPILOT_MEMORY_TOKENS_STORAGE_KEY,
      parseCopilotMemoryStateTokens,
      (tokens) => this.publish({ tokens }),
      options.preferenceLists?.tokens
    )
    this.preferences = new MemoryPreferences({
      owners: this.owners,
      tokens: this.tokens,
      getEpoch: (id) => this.copilotMemoryEpoch(id),
      createToken: options.createStateToken,
    })
    this.livePreferences = {
      enable: (owner) => this.preferences.enable(owner),
      disable: (id) => this.preferences.disable(id),
      select: (id) => this.preferences.select(id),
      isEnabled: (id) => this.preferences.isEnabled(id),
      pausedScope: (snapshot, id) => this.preferences.pausedScope(snapshot, id),
    }
  }

  getSnapshot = (): MemorySnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve()
    if (!this.hydrationPromise) {
      const hydration = this.enqueue(() => this.read())
      this.hydrationPromise = hydration
      void hydration
        .finally(() => {
          if (this.hydrationPromise === hydration) this.hydrationPromise = null
        })
        .catch(() => undefined)
    }
    return this.hydrationPromise
  }
  reload(): Promise<void> {
    return this.enqueue(() => this.read())
  }
  async flush(): Promise<void> {
    await this.queue
  }
  withStorageLock<T>(operation: (scope: MemoryStorageScope) => Promise<T>): Promise<T> {
    return this.enqueue(
      () =>
        this.preferences.withStorageLock(async () => {
          await Promise.allSettled([this.owners.read(), this.tokens.read()])
          return operation({ reload: () => this.read() })
        }),
      false
    )
  }

  listMemories(): Promise<MemoryEntry[]> {
    return this.enqueue(() => this.readMemories())
  }
  listAllCopilotMemories(): Promise<Record<string, MemoryEntry[]>> {
    return this.enqueue(() => this.readCopilotMemories())
  }
  async listCopilotMemories(id: string): Promise<MemoryEntry[]> {
    return (await this.listAllCopilotMemories())[id] ?? []
  }
  listMemoriesForScope(scope: MemoryScope): Promise<MemoryEntry[]> {
    return scope.type === 'copilot' ? this.listCopilotMemories(scope.copilotId) : this.listMemories()
  }

  addMemory(content: string): Promise<AddMemoryResult> {
    return this.enqueue(async () => {
      const memories = await this.readMemories()
      const result = this.addition(memories, content)
      if (!result.ok) return result
      await this.writeMemories([...memories, result.entry])
      return result
    })
  }
  deleteMemory(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const memories = await this.readMemories()
      const next = memories.filter((entry) => entry.id !== id)
      if (next.length === memories.length) return false
      await this.writeMemories(next)
      return true
    })
  }
  importMemories(contents: string[]): Promise<ImportMemoriesResult> {
    return this.enqueue(async () => {
      const memories = await this.readMemories()
      const seen = new Set(memories.map((entry) => entry.content))
      const additions: MemoryEntry[] = []
      const result: ImportMemoriesResult = {
        imported: 0,
        skippedDuplicate: 0,
        skippedEmpty: 0,
        skippedTooLong: 0,
        skippedLimit: 0,
      }
      for (const content of contents) {
        const trimmed = content.trim()
        if (!trimmed) result.skippedEmpty++
        else if (trimmed.length > MEMORY_ENTRY_MAX_CHARS) result.skippedTooLong++
        else if (seen.has(trimmed)) result.skippedDuplicate++
        else if (memories.length + additions.length >= MEMORY_MAX_ENTRIES) result.skippedLimit++
        else {
          seen.add(trimmed)
          additions.push({ id: this.createId(), content: trimmed, createdAt: this.now() })
        }
      }
      if (additions.length > 0) await this.writeMemories([...memories, ...additions])
      result.imported = additions.length
      return result
    })
  }

  copilotMemoryEpoch(id: string): number {
    return this.epochs.get(id) ?? 0
  }
  addCopilotMemory(
    id: string,
    content: string,
    epoch: number = this.copilotMemoryEpoch(id),
    lifecycleToken?: string
  ): Promise<AddMemoryResult> {
    return this.enqueue(async () => {
      if (!(await this.isCurrentCopilotScope(id, epoch, lifecycleToken)))
        return { ok: false, error: MEMORY_CONTEXT_UNAVAILABLE_MESSAGE }
      const record = await this.readCopilotMemories()
      const result = this.addition(record[id] ?? [], content)
      if (!result.ok) return result
      await this.writeCopilotMemories({ ...record, [id]: [...(record[id] ?? []), result.entry] })
      return result
    })
  }
  async deleteCopilotMemory(
    id: string,
    memoryId: string,
    epoch: number = this.copilotMemoryEpoch(id),
    lifecycleToken?: string
  ): Promise<boolean> {
    const deleted = await this.enqueue(async () => {
      if (!(await this.isCurrentCopilotScope(id, epoch, lifecycleToken))) return new MemoryContextUnavailableError()
      const record = await this.readCopilotMemories()
      const memories = record[id] ?? []
      const next = memories.filter((entry) => entry.id !== memoryId)
      if (next.length === memories.length) return false
      const updated = { ...record, [id]: next }
      if (next.length === 0) delete updated[id]
      await this.writeCopilotMemories(updated)
      return true
    })
    if (deleted instanceof MemoryContextUnavailableError) throw deleted
    return deleted
  }
  clearCopilotMemories(id: string): Promise<void> {
    return this.enqueue(() => this.dropCopilotMemories(id))
  }
  retireCopilotMemories(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.epochs.set(id, this.copilotMemoryEpoch(id) + 1)
      await this.dropCopilotMemories(id)
    })
  }
  /** Retains the memory lock through definition removal and restores failed deletions. */
  retireCopilot(id: string, commitRemoval?: () => Promise<void>, restoreRemoval?: () => Promise<void>): Promise<void> {
    return this.enqueue(() =>
      this.preferences.withStorageLock(async (preferences) => {
        const [memoriesResult, ownersResult, tokensResult] = await Promise.allSettled([
          this.readCopilotMemories(),
          this.owners.reload(),
          this.tokens.reload(),
        ])
        if (memoriesResult.status === 'rejected') throw memoriesResult.reason
        if (ownersResult.status === 'rejected') throw ownersResult.reason
        if (tokensResult.status === 'rejected') throw tokensResult.reason
        const copilotMemories = memoriesResult.value
        const owners = ownersResult.value
        const tokens = tokensResult.value
        try {
          await preferences.retire(id)
          await this.dropCopilotMemories(id)
          await commitRemoval?.()
        } catch (error) {
          const rollback = await Promise.allSettled([
            this.options.storage.set(COPILOT_MEMORIES_STORAGE_KEY, copilotMemories),
            this.options.storage.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, owners),
            this.options.storage.set(COPILOT_MEMORY_TOKENS_STORAGE_KEY, tokens),
            restoreRemoval?.(),
          ])
          const reloaded = await Promise.allSettled([
            this.readCopilotMemories(),
            this.owners.reload(),
            this.tokens.reload(),
          ])
          if ([...rollback, ...reloaded].some((result) => result.status === 'rejected'))
            throw new Error('Copilot memory could not be restored after a deletion failure', { cause: error })
          throw error
        }
        this.epochs.set(id, this.copilotMemoryEpoch(id) + 1)
        this.publish({ error: null })
      })
    )
  }
  addMemoryForScope(scope: MemoryScope, content: string): Promise<AddMemoryResult> {
    return scope.type === 'copilot'
      ? this.addCopilotMemory(scope.copilotId, content, scope.epoch, scope.lifecycleToken ?? '')
      : this.addMemory(content)
  }
  deleteMemoryForScope(scope: MemoryScope, id: string): Promise<boolean> {
    return scope.type === 'copilot'
      ? this.deleteCopilotMemory(scope.copilotId, id, scope.epoch, scope.lifecycleToken ?? '')
      : this.deleteMemory(id)
  }

  private async isCurrentCopilotScope(id: string, epoch: number, lifecycleToken: string | undefined): Promise<boolean> {
    if (epoch !== this.copilotMemoryEpoch(id)) return false
    if (lifecycleToken === undefined) return true
    // Read the durable value because renderer preferences have their own UI mirror.
    const tokens = parseCopilotMemoryStateTokens(await this.options.storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY))
    const state = tokens.find((entry) => entry.id === id)
    return Boolean(lifecycleToken) && lifecycleToken === (state?.retirementToken ?? state?.token)
  }
  enableCopilotMemory(owner: CopilotMemoryOwner): Promise<void> {
    return this.enqueue(() =>
      this.preferences.withStorageLock((preferences) => this.changePreferences(() => preferences.enable(owner)))
    )
  }
  disableCopilotMemory(id: string): Promise<void> {
    return this.enqueue(() =>
      this.preferences.withStorageLock((preferences) => this.changePreferences(() => preferences.disable(id)))
    )
  }
  setCopilotMemoryEnabled(owner: CopilotMemoryOwner, enabled: boolean): Promise<void> {
    return enabled ? this.enableCopilotMemory(owner) : this.disableCopilotMemory(owner.id)
  }
  peekState(id: string | undefined, settings: MemoryStateSettings): EffectiveMemoryState | undefined {
    const selection = this.preferences.peekSelection(id)
    return selection ? this.effectiveState(selection, settings) : undefined
  }
  async resolveState(id: string | undefined, settings: MemoryStateSettings): Promise<EffectiveMemoryState> {
    return this.effectiveState(await this.getCopilotMemorySelection(id), settings)
  }
  private effectiveState(selection: CopilotMemorySelection, settings: MemoryStateSettings): EffectiveMemoryState {
    const global = selection.scope.type === 'global'
    return {
      scope: selection.scope,
      enabled: !global || settings.memoryEnabled !== false,
      memoryStateToken: combineMemoryStateTokens(selection.memoryStateToken, global ? settings.memoryStateToken : ''),
    }
  }

  readCopilotMemoryEnabled(id: string): Promise<boolean> {
    return this.enqueue(() => this.preferences.isEnabled(id))
  }
  getCopilotMemorySelection(id: string | undefined): Promise<CopilotMemorySelection> {
    return this.enqueue(() => this.preferences.select(id))
  }
  getPausedCallMemoryScope(
    snapshot: SessionPromptContextSnapshot | undefined,
    id: string | undefined
  ): Promise<MemoryScope> {
    return this.enqueue(() => this.preferences.pausedScope(snapshot, id))
  }

  private addition(memories: MemoryEntry[], content: string): AddMemoryResult {
    const trimmed = content.trim()
    if (!trimmed) return { ok: false, error: 'Memory content is empty.' }
    if (trimmed.length > MEMORY_ENTRY_MAX_CHARS)
      return { ok: false, error: `Memory content exceeds ${MEMORY_ENTRY_MAX_CHARS} characters. Save a shorter fact.` }
    if (memories.some((entry) => entry.content === trimmed))
      return { ok: false, error: 'An identical memory already exists.' }
    if (memories.length >= MEMORY_MAX_ENTRIES)
      return {
        ok: false,
        error: `Memory limit of ${MEMORY_MAX_ENTRIES} entries reached. Delete stale entries with delete_memory first.`,
      }
    return { ok: true, entry: { id: this.createId(), content: trimmed, createdAt: this.now() } }
  }
  private async readMemories(): Promise<MemoryEntry[]> {
    const memories = MemoriesSchema.parse(await this.options.storage.get(AGENT_MEMORIES_STORAGE_KEY))
    this.publish({ memories })
    return memories
  }
  private async readCopilotMemories(): Promise<Record<string, MemoryEntry[]>> {
    const copilotMemories = CopilotMemoriesSchema.parse(await this.options.storage.get(COPILOT_MEMORIES_STORAGE_KEY))
    this.publish({ copilotMemories })
    return copilotMemories
  }
  private async writeMemories(memories: MemoryEntry[]): Promise<void> {
    await this.options.storage.set(AGENT_MEMORIES_STORAGE_KEY, memories)
    this.publish({ memories, error: null })
  }
  private async writeCopilotMemories(copilotMemories: Record<string, MemoryEntry[]>): Promise<void> {
    await this.options.storage.set(COPILOT_MEMORIES_STORAGE_KEY, copilotMemories)
    this.publish({ copilotMemories, error: null })
  }
  private async dropCopilotMemories(id: string): Promise<void> {
    const record = await this.readCopilotMemories()
    if (!(id in record)) return
    const next = { ...record }
    delete next[id]
    await this.writeCopilotMemories(next)
  }
  private async read(): Promise<void> {
    this.hydrated = false
    this.publish({ isLoading: true, error: null })
    try {
      const results = await Promise.allSettled([
        this.readMemories(),
        this.readCopilotMemories(),
        this.owners.reload(),
        this.tokens.reload(),
      ])
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      this.hydrated = true
      this.publish({ isLoading: false, error: null })
    } catch (error) {
      this.reportError(error)
      throw error
    }
  }
  private async changePreferences(operation: () => Promise<void>): Promise<void> {
    const loaded = await Promise.allSettled([this.owners.read(), this.tokens.read()])
    const [ownersResult, tokensResult] = loaded
    if (ownersResult.status === 'rejected') throw ownersResult.reason
    if (tokensResult.status === 'rejected') throw tokensResult.reason
    const owners = ownersResult.value
    const tokens = tokensResult.value
    try {
      await operation()
      this.publish({ error: null })
    } catch (error) {
      const rollback = await Promise.allSettled([
        this.options.storage.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, owners),
        this.options.storage.set(COPILOT_MEMORY_TOKENS_STORAGE_KEY, tokens),
      ])
      await Promise.allSettled([this.owners.reload(), this.tokens.reload()])
      if (rollback.some((result) => result.status === 'rejected'))
        throw new Error('Memory preferences could not be restored after a write failure', { cause: error })
      throw error
    }
  }
  private preferenceList<T>(
    key: string,
    parse: (value: unknown) => T[],
    publish: (items: T[]) => void,
    shared?: StoredPreferenceList<T>
  ): StoredPreferenceList<T> {
    if (shared) {
      const read = async (operation: () => Promise<T[]>): Promise<T[]> => {
        const items = await operation()
        publish(items)
        return items
      }
      return {
        read: () => read(() => shared.read()),
        reload: () => read(() => shared.reload()),
        peek: () => shared.peek(),
        update: (updater) => {
          const write = shared.update(updater)
          const current = shared.peek()
          if (current) publish(current)
          return write.then(() => {
            const stored = shared.peek()
            if (stored) publish(stored)
          })
        },
      }
    }
    let current: T[] | undefined
    let pending: Promise<T[]> | undefined
    const read = (): Promise<T[]> => {
      if (current !== undefined) return Promise.resolve(current)
      pending ??= this.options.storage
        .get(key)
        .then((value) => {
          current ??= parse(value)
          publish(current)
          return current
        })
        .finally(() => {
          pending = undefined
        })
      return pending
    }
    return {
      read,
      peek: () => current,
      update: async (updater) => {
        await read()
        const next = updater(current ?? [])
        current = next
        publish(next)
        await this.options.storage.set(key, next)
      },
      reload: async () => {
        if (pending) await pending.catch(() => undefined)
        current = undefined
        return read()
      },
    }
  }
  private enqueue<T>(operation: () => Promise<T>, reportError = true): Promise<T> {
    const pending = this.queue
      .catch(() => undefined)
      .then(operation)
      .catch((error: unknown) => {
        if (reportError) this.reportError(error)
        throw error
      })
    this.queue = pending
    void pending.catch(() => undefined)
    return pending
  }
  private reportError(cause: unknown): void {
    this.publish({ isLoading: false, error: cause instanceof Error ? cause : new Error(String(cause)) })
  }
  private publish(update: Partial<MemorySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update }
    for (const listener of this.listeners) listener()
  }
}

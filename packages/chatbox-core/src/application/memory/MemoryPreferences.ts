import {
  type CopilotMemoryStateToken,
  createMemoryStateToken,
  getSnapshotCopilotLifecycleToken,
  type MemoryScope,
  type SessionPromptContextSnapshot,
} from '../../types/agent-persona'

export const COPILOT_MEMORY_OWNERS_STORAGE_KEY = 'copilot-memory-owners'
export const COPILOT_MEMORY_TOKENS_STORAGE_KEY = 'copilot-memory-state-tokens'

export interface CopilotMemoryOwner {
  id: string
  name: string
}
export interface CopilotMemorySelection {
  scope: MemoryScope
  memoryStateToken: string
}

/** A host may mirror preferences before its durable write completes. */
export interface MemoryPreferenceList<T> {
  reload?(): Promise<T[]>
  read(): Promise<T[]>
  peek(): T[] | undefined
  update(updater: (items: T[]) => T[]): Promise<void>
}

export interface MemoryPreferencesOptions {
  owners: MemoryPreferenceList<CopilotMemoryOwner>
  tokens: MemoryPreferenceList<CopilotMemoryStateToken>
  getEpoch: (copilotId: string) => number
  createToken?: () => string
}

export interface MemoryPreferenceStorageScope {
  enable(owner: CopilotMemoryOwner): Promise<void>
  disable(id: string): Promise<void>
  retire(id: string): Promise<void>
}

/** Resolves ownership and source versions independently from saved Copilot definitions. */
export class MemoryPreferences {
  private mutation: Promise<unknown> = Promise.resolve()
  private lockCount = 0
  private readonly writes = new Set<Promise<void>>()
  constructor(private readonly options: MemoryPreferencesOptions) {}

  private track(write: Promise<void>): Promise<void> {
    this.writes.add(write)
    void write.finally(() => this.writes.delete(write)).catch(() => undefined)
    return write
  }

  withStorageLock<T>(operation: (scope: MemoryPreferenceStorageScope) => Promise<T>): Promise<T> {
    this.lockCount++
    const pendingWrites = [...this.writes]
    const run = this.mutation.then(async () => {
      await Promise.allSettled(pendingWrites)
      return operation({
        enable: (owner) => this.applyEnable(owner),
        disable: (id) => this.applyDisable(id),
        retire: (id) => this.applyRetire(id),
      })
    })
    const finished = run.finally(() => {
      this.lockCount--
    })
    this.mutation = finished.catch(() => undefined)
    return finished
  }

  private changeToken(tokens: CopilotMemoryStateToken[], id: string): CopilotMemoryStateToken[] {
    const previous = tokens.find((entry) => entry.id === id)
    const token = (this.options.createToken ?? createMemoryStateToken)()
    return [
      ...tokens.filter((entry) => entry.id !== id),
      { id, token, retirementToken: previous?.retirementToken ?? previous?.token ?? token },
    ]
  }

  private async initializeIdentity(id: string): Promise<void> {
    const before = this.options.tokens.peek() ?? []
    try {
      await this.options.tokens.update((current) => {
        const previous = current.find((entry) => entry.id === id)
        if (previous?.retirementToken) return current
        const token = previous?.token ?? (this.options.createToken ?? createMemoryStateToken)()
        return [...current.filter((entry) => entry.id !== id), { id, token, retirementToken: token }]
      })
    } catch (error) {
      if (this.options.tokens.reload) await this.options.tokens.reload()
      else await this.options.tokens.update(() => before)
      throw error
    }
  }

  private afterHydration(operation: () => Promise<void>): Promise<void> {
    const run = this.mutation.then(async () => {
      const loaded = await Promise.allSettled([this.options.owners.read(), this.options.tokens.read()])
      const failure = loaded.find((item) => item.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      await operation()
    })
    this.mutation = run.catch(() => undefined)
    return run
  }

  private applyEnable({ id, name }: CopilotMemoryOwner): Promise<void> {
    const owner = { id, name }
    const { owners, tokens } = this.options
    if (owners.peek()?.some((item) => item.id === owner.id)) {
      const identityWrite = tokens.peek()?.find((entry) => entry.id === owner.id)?.retirementToken
        ? Promise.resolve()
        : this.initializeIdentity(owner.id)
      const ownerWrite = owners.update((current) => [...current.filter((item) => item.id !== owner.id), owner])
      return Promise.allSettled([identityWrite, ownerWrite]).then((results) => {
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      })
    }
    const tokenWrite = tokens.update((current) => this.changeToken(current, owner.id))
    const ownerWrite = owners.update((current) => [...current.filter((item) => item.id !== owner.id), owner])
    return Promise.allSettled([tokenWrite, ownerWrite]).then((results) => {
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
  }

  private applyDisable(id: string): Promise<void> {
    const { owners, tokens } = this.options
    if (!owners.peek()?.some((item) => item.id === id)) return Promise.resolve()
    const tokenWrite = tokens.update((current) => this.changeToken(current, id))
    const ownerWrite = owners.update((current) => current.filter((item) => item.id !== id))
    return Promise.allSettled([tokenWrite, ownerWrite]).then((results) => {
      const failed = results.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    })
  }

  private async applyRetire(id: string): Promise<void> {
    const { owners, tokens } = this.options
    const enabled = owners.peek()?.some((owner) => owner.id === id) ?? false
    const previous = tokens.peek()?.find((entry) => entry.id === id)
    if (!enabled && !previous) return
    const retirementToken = (this.options.createToken ?? createMemoryStateToken)()
    const token = enabled ? retirementToken : (previous?.token ?? retirementToken)
    const writes = await Promise.allSettled([
      tokens.update((current) => [...current.filter((entry) => entry.id !== id), { id, token, retirementToken }]),
      owners.update((current) => current.filter((owner) => owner.id !== id)),
    ])
    const failed = writes.find((write) => write.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }

  private mutate(operation: () => Promise<void>): Promise<void> {
    return this.track(
      this.lockCount === 0 && this.options.owners.peek() !== undefined && this.options.tokens.peek() !== undefined
        ? operation()
        : this.afterHydration(operation)
    )
  }

  enable(owner: CopilotMemoryOwner): Promise<void> {
    return this.mutate(() => this.applyEnable(owner))
  }

  disable(id: string): Promise<void> {
    return this.mutate(() => this.applyDisable(id))
  }

  retire(id: string): Promise<void> {
    return this.mutate(() => this.applyRetire(id))
  }

  async isEnabled(id: string): Promise<boolean> {
    if (this.lockCount > 0) await this.mutation
    return (await this.options.owners.read()).some((owner) => owner.id === id)
  }

  peekSelection(id: string | undefined): CopilotMemorySelection | undefined {
    if (!id) return { scope: { type: 'global' }, memoryStateToken: '' }
    const owners = this.options.owners.peek()
    const tokens = this.options.tokens.peek()
    if (!owners || !tokens) return undefined
    const state = tokens.find((entry) => entry.id === id)
    const memoryStateToken = state?.token ?? ''
    const enabled = owners.some((owner) => owner.id === id)
    if (enabled && !state) return undefined
    return {
      scope: enabled
        ? {
            type: 'copilot',
            copilotId: id,
            epoch: this.options.getEpoch(id),
            lifecycleToken: state?.retirementToken ?? state?.token,
          }
        : { type: 'global' },
      memoryStateToken,
    }
  }

  async select(id: string | undefined): Promise<CopilotMemorySelection> {
    if (!id) return { scope: { type: 'global' }, memoryStateToken: '' }
    await this.mutation
    const loaded = await Promise.allSettled([this.options.owners.read(), this.options.tokens.read()])
    const failure = loaded.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (
      this.options.owners.peek()?.some((owner) => owner.id === id) &&
      !this.options.tokens.peek()?.some((entry) => entry.id === id)
    ) {
      await this.track(this.afterHydration(() => this.initializeIdentity(id)))
    }
    const selection = this.peekSelection(id)
    if (!selection) throw new Error('Memory preferences did not finish loading')
    return selection
  }

  async pausedScope(
    snapshot: SessionPromptContextSnapshot | undefined,
    copilotId: string | undefined
  ): Promise<MemoryScope> {
    if (!snapshot) {
      // A missing Copilot snapshot cannot identify the original store. Negative
      // epochs never match a live library, so this call returns a normal tool error.
      return copilotId ? { type: 'copilot', copilotId, epoch: -1 } : { type: 'global' }
    }
    const id = snapshot.memoryCopilotId
    if (id) {
      const lifecycleToken = getSnapshotCopilotLifecycleToken(snapshot)
      return {
        type: 'copilot',
        copilotId: id,
        epoch: lifecycleToken ? this.options.getEpoch(id) : -1,
        ...(lifecycleToken ? { lifecycleToken } : {}),
      }
    }
    return { type: 'global' }
  }
}

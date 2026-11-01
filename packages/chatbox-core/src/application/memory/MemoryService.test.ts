import { describe, expect, test, vi } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import { COPILOT_MEMORY_OWNERS_STORAGE_KEY, COPILOT_MEMORY_TOKENS_STORAGE_KEY } from './MemoryPreferences'
import { AGENT_MEMORIES_STORAGE_KEY, COPILOT_MEMORIES_STORAGE_KEY, MemoryService } from './MemoryService'

function harness() {
  const storage = new InMemoryKeyValueStorage()
  let sequence = 0
  const memory = new MemoryService({
    storage,
    now: () => 123,
    createId: () => `memory-${++sequence}`,
    createStateToken: () => `token-${++sequence}`,
  })
  return { storage, memory }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('MemoryService', () => {
  test('failed cold scope resolution drains stale token reads before storage reload', async () => {
    const { storage, memory } = harness()
    const tokenReadEntered = deferred()
    const releaseToken = deferred()
    const get = storage.get.bind(storage)
    let firstOwnersRead = true
    let firstTokenRead = true
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      if (key === COPILOT_MEMORY_OWNERS_STORAGE_KEY && firstOwnersRead) {
        firstOwnersRead = false
        throw new Error('owners read failed')
      }
      if (key === COPILOT_MEMORY_TOKENS_STORAGE_KEY && firstTokenRead) {
        firstTokenRead = false
        tokenReadEntered.resolve()
        await releaseToken.promise
        return [{ id: 'copilot', token: 'old-token' }]
      }
      return get(key)
    })
    const selection = expect(memory.getCopilotMemorySelection('copilot')).rejects.toThrow('owners read failed')
    await tokenReadEntered.promise
    let updateStarted = false
    const replacing = memory.withStorageLock(async ({ reload }) => {
      updateStarted = true
      await storage.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, [{ id: 'copilot', name: 'Updated' }])
      await storage.set(COPILOT_MEMORY_TOKENS_STORAGE_KEY, [{ id: 'copilot', token: 'new-token' }])
      await reload()
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const replacedBeforeReadFinished = updateStarted
    releaseToken.resolve()
    await Promise.all([selection, replacing])
    expect(replacedBeforeReadFinished).toBe(false)
    expect(await memory.getCopilotMemorySelection('copilot')).toMatchObject({ memoryStateToken: 'new-token' })
    expect(memory.peekState('copilot', {})).toMatchObject({ scope: { type: 'copilot' } })
    expect(memory.getSnapshot()).toMatchObject({ tokens: [{ id: 'copilot', token: 'new-token' }], error: null })
  })

  test('storage scope excludes writes and reloads replaced values before queued operations resume', async () => {
    const { storage, memory } = harness()
    await memory.hydrate()
    await memory.addMemory('before')
    const entered = deferred()
    const release = deferred()
    const replacing = memory.withStorageLock(async ({ reload }) => {
      entered.resolve()
      await release.promise
      await storage.set(AGENT_MEMORIES_STORAGE_KEY, [{ id: 'replaced', content: 'replaced', createdAt: 1 }])
      await storage.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, [{ id: 'replaced-copilot', name: 'Updated' }])
      await storage.set(COPILOT_MEMORY_TOKENS_STORAGE_KEY, [{ id: 'replaced-copilot', token: 'replaced-token' }])
      await reload()
    })
    await entered.promise
    const adding = memory.addMemory('after')
    let completed = false
    void adding.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    release.resolve()
    await Promise.all([replacing, adding])
    expect(memory.getSnapshot().memories.map((entry) => entry.content)).toEqual(['replaced', 'after'])
    expect(await memory.getCopilotMemorySelection('replaced-copilot')).toMatchObject({
      scope: { type: 'copilot' },
      memoryStateToken: 'replaced-token',
    })
    await expect(memory.withStorageLock(() => Promise.reject(new Error('cancelled')))).rejects.toThrow('cancelled')
    await expect(memory.addMemory('recovered')).resolves.toMatchObject({ ok: true })
  })

  test('serializes memory mutations, preserves every scope, and publishes durable entries', async () => {
    const { memory } = harness()
    await memory.hydrate()
    const listener = vi.fn()
    memory.subscribe(listener)
    const [first, duplicate, other, cp1, cp2] = await Promise.all([
      memory.addMemory(' first '),
      memory.addMemory('first'),
      memory.addMemory('other'),
      memory.addCopilotMemory('one', 'copilot one'),
      memory.addCopilotMemory('two', 'copilot two'),
    ])
    expect([first.ok, duplicate.ok, other.ok, cp1.ok, cp2.ok]).toEqual([true, false, true, true, true])
    if (!first.ok) throw new Error('Expected memory')
    await Promise.all([memory.deleteMemory(first.entry.id), memory.addMemory('third')])
    expect(memory.getSnapshot()).toMatchObject({
      isLoading: false,
      error: null,
      memories: [{ content: 'other', createdAt: 123 }, { content: 'third' }],
    })
    expect((await memory.listCopilotMemories('one')).map((entry) => entry.content)).toEqual(['copilot one'])
    expect((await memory.listCopilotMemories('two')).map((entry) => entry.content)).toEqual(['copilot two'])
    expect(listener).toHaveBeenCalled()
  })

  test('enforces per-library limits and reports bulk import exclusions', async () => {
    const { memory } = harness()
    const result = await memory.importMemories([
      '',
      'x'.repeat(1001),
      'fact',
      'fact',
      ...Array.from({ length: 100 }, (_, index) => `fact ${index}`),
    ])
    expect(result).toEqual({ imported: 100, skippedDuplicate: 1, skippedEmpty: 1, skippedTooLong: 1, skippedLimit: 1 })
    await expect(memory.addMemory('overflow')).resolves.toMatchObject({ ok: false })
    await expect(memory.addCopilotMemory('independent', 'allowed')).resolves.toMatchObject({ ok: true })
  })

  test('keeps ownership independent of saved definitions and persists off-on versions', async () => {
    const { storage, memory } = harness()
    const owner = { id: 'featured:one', name: 'Featured' }
    await memory.setCopilotMemoryEnabled(owner, true)
    await memory.addCopilotMemory(owner.id, 'fact')
    const initial = await memory.resolveState(owner.id, { memoryEnabled: false, memoryStateToken: 'global' })
    expect(initial).toMatchObject({ enabled: true, scope: { type: 'copilot', copilotId: owner.id } })
    await memory.enableCopilotMemory({ ...owner, name: 'Renamed' })
    expect((await memory.resolveState(owner.id, {})).memoryStateToken).toBe(initial.memoryStateToken)
    await memory.disableCopilotMemory(owner.id)
    const disabled = await memory.resolveState(owner.id, { memoryEnabled: false, memoryStateToken: 'global' })
    expect(disabled).toMatchObject({ enabled: false, scope: { type: 'global' } })
    await memory.enableCopilotMemory(owner)
    expect((await memory.resolveState(owner.id, {})).memoryStateToken).not.toBe(initial.memoryStateToken)
    const restarted = new MemoryService({ storage })
    await restarted.hydrate()
    expect(await restarted.resolveState(owner.id, {})).toEqual(await memory.resolveState(owner.id, {}))
    expect(restarted.getSnapshot().copilotMemories[owner.id]).toHaveLength(1)
  })

  test('retiring a Copilot blocks late writes while clearing its list allows new learning', async () => {
    const { memory } = harness()
    await memory.enableCopilotMemory({ id: 'copilot', name: 'Name' })
    const scope = (await memory.getCopilotMemorySelection('copilot')).scope
    await memory.addMemoryForScope(scope, 'before')
    await memory.clearCopilotMemories('copilot')
    await expect(memory.addMemoryForScope(scope, 'after clearing')).resolves.toMatchObject({ ok: true })
    const retiring = memory.retireCopilot('copilot')
    const late = memory.addMemoryForScope(scope, 'late')
    await retiring
    await expect(late).resolves.toMatchObject({ ok: false })
    await memory.enableCopilotMemory({ id: 'copilot', name: 'Readded' })
    await expect(memory.addMemoryForScope(scope, 'old generation')).resolves.toMatchObject({ ok: false })
    expect(await memory.listCopilotMemories('copilot')).toEqual([])
    await expect(
      memory.addMemoryForScope((await memory.getCopilotMemorySelection('copilot')).scope, 'new generation')
    ).resolves.toMatchObject({ ok: true })
  })

  test('restores both preference keys after a partial failure and permits retry', async () => {
    const { storage, memory } = harness()
    const owner = { id: 'copilot', name: 'Name' }
    await memory.enableCopilotMemory(owner)
    const before = await memory.getCopilotMemorySelection(owner.id)
    const set = storage.set.bind(storage)
    let fail = true
    vi.spyOn(storage, 'set').mockImplementation(async (key, value) => {
      if (key === COPILOT_MEMORY_OWNERS_STORAGE_KEY && fail) {
        fail = false
        throw new Error('disk full')
      }
      await set(key, value)
    })
    await expect(memory.disableCopilotMemory(owner.id)).rejects.toThrow('disk full')
    expect(await memory.getCopilotMemorySelection(owner.id)).toEqual(before)
    expect(await storage.get(COPILOT_MEMORY_OWNERS_STORAGE_KEY)).toEqual([owner])
    expect(await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY)).toEqual([
      { id: owner.id, token: before.memoryStateToken, retirementToken: before.memoryStateToken },
    ])
    await memory.disableCopilotMemory(owner.id)
    expect(await memory.readCopilotMemoryEnabled(owner.id)).toBe(false)
    expect(memory.getSnapshot().error).toBeNull()
  })

  test('keeps prompt-context capture ahead of queued memory writes', async () => {
    const { memory } = harness()
    await memory.hydrate()
    await memory.addMemory('before')
    const entered = deferred()
    const release = deferred()
    const capture = memory.withStorageLock(async () => {
      entered.resolve()
      await release.promise
      expect(memory.getSnapshot().memories.map((entry) => entry.content)).toEqual(['before'])
    })
    await entered.promise
    const adding = memory.addMemory('after')
    let completed = false
    void adding.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    release.resolve()
    await Promise.all([capture, adding])
    expect(memory.getSnapshot().memories.map((entry) => entry.content)).toEqual(['before', 'after'])
    await expect(memory.withStorageLock(() => Promise.reject(new Error('cancelled')))).rejects.toThrow('cancelled')
    await expect(memory.addMemory('recovered')).resolves.toMatchObject({ ok: true })
  })

  test('failed hydration drains all reads before reload can publish newer data', async () => {
    const { storage, memory } = harness()
    const delayed = deferred()
    const entered = deferred()
    const get = storage.get.bind(storage)
    let first = true
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      if (first && key === AGENT_MEMORIES_STORAGE_KEY) throw new Error('read failed')
      if (first && key === COPILOT_MEMORIES_STORAGE_KEY) {
        entered.resolve()
        await delayed.promise
        return { stale: [{ id: 'stale', content: 'stale', createdAt: 1 }] }
      }
      return get(key)
    })
    const initial = memory.hydrate()
    const failed = expect(initial).rejects.toThrow('read failed')
    await entered.promise
    let reloadFinished = false
    const reload = memory.reload().then(() => {
      reloadFinished = true
    })
    await Promise.resolve()
    expect(reloadFinished).toBe(false)
    first = false
    await storage.set(COPILOT_MEMORIES_STORAGE_KEY, { fresh: [{ id: 'fresh', content: 'fresh', createdAt: 2 }] })
    delayed.resolve()
    await failed
    await reload
    expect(memory.getSnapshot().copilotMemories).toEqual({ fresh: [{ id: 'fresh', content: 'fresh', createdAt: 2 }] })
  })

  test('corrupt memory lists are safe and failed hydration is retryable', async () => {
    const { storage, memory } = harness()
    await storage.set(AGENT_MEMORIES_STORAGE_KEY, { broken: true })
    await storage.set(COPILOT_MEMORIES_STORAGE_KEY, { one: false })
    vi.spyOn(storage, 'get').mockRejectedValueOnce(new Error('read failed'))
    await expect(memory.hydrate()).rejects.toThrow('read failed')
    expect(memory.getSnapshot()).toMatchObject({ isLoading: false, error: new Error('read failed') })
    await memory.hydrate()
    expect(memory.getSnapshot()).toMatchObject({
      memories: [],
      copilotMemories: { one: [] },
      isLoading: false,
      error: null,
    })
  })
})

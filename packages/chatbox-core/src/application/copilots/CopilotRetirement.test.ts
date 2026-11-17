import { describe, expect, test, vi } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import { COPILOT_MEMORY_OWNERS_STORAGE_KEY, COPILOT_MEMORY_TOKENS_STORAGE_KEY } from '../memory/MemoryPreferences'
import { COPILOT_MEMORIES_STORAGE_KEY, MemoryService } from '../memory/MemoryService'
import { CopilotService, MY_COPILOTS_STORAGE_KEY } from './CopilotService'

async function harness() {
  const storage = new InMemoryKeyValueStorage()
  const memory = new MemoryService({ storage })
  const copilots = new CopilotService({ storage, memoryLifecycle: memory })
  for (const id of ['saved', 'other']) {
    await copilots.upsert({ id, name: id, prompt: 'Help' }, { memoryEnabled: true })
    await memory.addCopilotMemory(id, `A durable preference for ${id}`)
  }
  return { storage, memory, copilots }
}

describe('Copilot retirement', () => {
  test.each([
    MY_COPILOTS_STORAGE_KEY,
    COPILOT_MEMORIES_STORAGE_KEY,
    COPILOT_MEMORY_OWNERS_STORAGE_KEY,
    COPILOT_MEMORY_TOKENS_STORAGE_KEY,
  ])('restores the definition, memories and preferences when %s fails', async (failedKey) => {
    const { storage, memory, copilots } = await harness()
    const before = structuredClone(storage.values)
    const selection = await memory.getCopilotMemorySelection('saved')
    const definitionSnapshot = copilots.getSnapshot().copilots
    const set = storage.set.bind(storage)
    let failed = false
    vi.spyOn(storage, 'set').mockImplementation(async (key, value) => {
      if (key === failedKey && !failed) {
        failed = true
        throw new Error(`Failed to write ${key}`)
      }
      await set(key, value)
    })

    await expect(copilots.remove('saved')).rejects.toThrow(`Failed to write ${failedKey}`)
    expect(storage.values).toEqual(before)
    expect(copilots.getSnapshot().copilots).toEqual(definitionSnapshot)
    expect(await memory.getCopilotMemorySelection('saved')).toEqual(selection)
    expect(memory.getSnapshot().copilotMemories).toEqual(before.get(COPILOT_MEMORIES_STORAGE_KEY))
    expect(memory.getSnapshot().owners).toEqual(before.get(COPILOT_MEMORY_OWNERS_STORAGE_KEY))
    expect(memory.getSnapshot().tokens).toEqual(before.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY))
    await expect(
      memory.addMemoryForScope(selection.scope, 'The original conversation remains active')
    ).resolves.toMatchObject({
      ok: true,
    })

    await copilots.remove('saved')
    expect(copilots.getSnapshot().copilots.map(({ id }) => id)).toEqual(['other'])
    expect(await memory.listCopilotMemories('saved')).toEqual([])
    expect(await memory.readCopilotMemoryEnabled('saved')).toBe(false)
    await expect(memory.addMemoryForScope(selection.scope, 'A stale generation')).resolves.toMatchObject({ ok: false })
    expect(await memory.listCopilotMemories('other')).toEqual(
      (before.get(COPILOT_MEMORIES_STORAGE_KEY) as Record<string, unknown>).other
    )
  })

  test('keeps a memory write behind deletion rollback until the definition write settles', async () => {
    const { storage, memory, copilots } = await harness()
    const scope = (await memory.getCopilotMemorySelection('saved')).scope
    const set = storage.set.bind(storage)
    let rejectRemoval!: (error: Error) => void
    const blocked = new Promise<void>((_resolve, reject) => {
      rejectRemoval = reject
    })
    const writingDefinition = vi.fn()
    vi.spyOn(storage, 'set').mockImplementation(async (key, value) => {
      if (key === MY_COPILOTS_STORAGE_KEY) {
        writingDefinition()
        await blocked
      }
      await set(key, value)
    })

    const removal = copilots.remove('saved')
    const rejected = expect(removal).rejects.toThrow('Definition disk failure')
    await vi.waitFor(() => expect(writingDefinition).toHaveBeenCalledOnce())
    const written = vi.fn()
    const queuedWrite = memory.addMemoryForScope(scope, 'Queued fact').then((result) => {
      written()
      return result
    })
    await Promise.resolve()
    expect(written).not.toHaveBeenCalled()
    expect(copilots.getSnapshot().copilots).toHaveLength(2)

    rejectRemoval(new Error('Definition disk failure'))
    await rejected
    await expect(queuedWrite).resolves.toMatchObject({ ok: true })
    expect((await memory.listCopilotMemories('saved')).map(({ content }) => content)).toEqual([
      'A durable preference for saved',
      'Queued fact',
    ])
    expect(await memory.readCopilotMemoryEnabled('saved')).toBe(true)
  })

  test('reports rollback failures and still restores the remaining keys', async () => {
    const { storage, memory, copilots } = await harness()
    const owners = await storage.get(COPILOT_MEMORY_OWNERS_STORAGE_KEY)
    const tokens = await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY)
    const set = storage.set.bind(storage)
    let bucketWrites = 0
    vi.spyOn(storage, 'set').mockImplementation(async (key, value) => {
      if (key === MY_COPILOTS_STORAGE_KEY) throw new Error('Definition disk failure')
      if (key === COPILOT_MEMORIES_STORAGE_KEY && ++bucketWrites === 2) throw new Error('Rollback disk failure')
      await set(key, value)
    })

    await expect(copilots.remove('saved')).rejects.toMatchObject({
      message: 'Copilot memory could not be restored after a deletion failure',
      cause: new Error('Definition disk failure'),
    })
    expect(copilots.getSnapshot().copilots).toHaveLength(2)
    expect(await storage.get(COPILOT_MEMORY_OWNERS_STORAGE_KEY)).toEqual(owners)
    expect(await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY)).toEqual(tokens)
    expect(memory.getSnapshot().copilotMemories).toEqual(await storage.get(COPILOT_MEMORIES_STORAGE_KEY))
    expect(memory.getSnapshot().error?.message).toContain('could not be restored')
  })
})

import type { CopilotDetail } from '@shared/types'
import { describe, expect, test, vi } from 'vitest'
import type { KeyValueStoragePort } from '../../ports'
import { COPILOT_MEMORY_OWNERS_STORAGE_KEY } from '../memory/MemoryPreferences'
import { MemoryService } from '../memory/MemoryService'
import { COPILOT_PREFERENCES_STORAGE_KEY, CopilotPreferences } from './CopilotPreferences'
import { CopilotService, MY_COPILOTS_STORAGE_KEY, searchCopilots } from './CopilotService'

class MemoryStorage implements KeyValueStoragePort {
  values = new Map<string, unknown>()

  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.values.get(key) as T | undefined) ?? null)
  }

  set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value))
    return Promise.resolve()
  }

  remove(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()])
  }
}

function copilot(id: string, fields: Partial<CopilotDetail> = {}): CopilotDetail {
  return { id, name: id, prompt: `Prompt for ${id}`, ...fields }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('CopilotService', () => {
  test('serializes initialization and concurrent edits without replacing previously saved records', async () => {
    const storage = new MemoryStorage()
    const read = deferred<unknown>()
    const get = vi.spyOn(storage, 'get').mockImplementationOnce(() => read.promise)
    const service = new CopilotService({ storage, now: () => 100 })
    const hydration = service.hydrate()
    const add = service.upsert(copilot('new'))
    const star = service.setStarred('existing', true)
    read.resolve([copilot('existing')])
    await Promise.all([hydration, add, star, service.hydrate()])

    expect(get).toHaveBeenCalledOnce()
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['existing', 'new'])
    const nextService = new CopilotService({ storage })
    await nextService.hydrate()
    expect(nextService.getSnapshot().copilots).toEqual(service.getSnapshot().copilots)
    expect(service.getSnapshot()).toMatchObject({ isLoading: false, error: null })
  })

  test('same-ID featured additions merge fields and preserve stars and existing metadata', async () => {
    const storage = new MemoryStorage()
    const existing = copilot('remote', { createdAt: 10, starred: true, tags: ['local'], sourceId: 'source' })
    storage.values.set(MY_COPILOTS_STORAGE_KEY, [existing])
    const service = new CopilotService({ storage, now: () => 200 })
    await service.addFeatured(
      copilot('remote', {
        name: ' New name ',
        description: ' Updated ',
        tags: ['remote'],
        screenshots: [{ type: 'url', url: 'https://example.com/screenshot.png' }],
        picUrl: 'https://example.com/avatar.png',
      })
    )

    expect(service.getSnapshot().copilots).toEqual([
      {
        ...existing,
        name: 'New name',
        description: 'Updated',
        avatar: { type: 'url', url: 'https://example.com/avatar.png' },
        backgroundImage: undefined,
        updatedAt: 200,
      },
    ])
  })

  test('validates trimmed required values, accepts long prompts, and sorts stars stably', async () => {
    const storage = new MemoryStorage()
    const service = new CopilotService({ storage })
    await expect(service.upsert(copilot('empty', { name: '  ' }))).rejects.toThrow('required')
    await service.upsert(copilot('first'))
    await service.upsert(copilot('second', { prompt: ` ${'a'.repeat(50_000)} ` }))
    await service.upsert(copilot('third'))
    await service.setStarred('first', true)
    await service.setStarred('third', true)
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['third', 'first', 'second'])
    expect(service.getSnapshot().copilots[2].prompt.length).toBe(50_000)
    const restored = new CopilotService({ storage })
    await restored.hydrate()
    expect(restored.getSnapshot().copilots.find((item) => item.id === 'second')?.prompt.length).toBe(50_000)
    await service.setStarred('first', false)
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['third', 'second', 'first'])
  })

  test('failed writes retain the last persisted snapshot and subsequent writes recover', async () => {
    const storage = new MemoryStorage()
    const service = new CopilotService({ storage })
    await service.upsert(copilot('saved'))
    const saved = service.getSnapshot().copilots
    const set = vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('disk full'))
    await expect(service.upsert(copilot('failed'))).rejects.toThrow('disk full')
    expect(service.getSnapshot().copilots).toBe(saved)
    expect(service.getSnapshot().error?.message).toBe('disk full')
    await expect(service.flush()).rejects.toThrow('disk full')
    await service.upsert(copilot('retried'))
    expect(set).toHaveBeenCalledTimes(2)
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['retried', 'saved'])
    expect(service.getSnapshot().error).toBeNull()
  })

  test('failed hydration is retryable and never overwrites unread saved records', async () => {
    const storage = new MemoryStorage()
    storage.values.set(MY_COPILOTS_STORAGE_KEY, [copilot('saved')])
    const get = vi.spyOn(storage, 'get').mockRejectedValueOnce(new Error('unavailable'))
    const service = new CopilotService({ storage })
    await expect(service.hydrate()).rejects.toThrow('unavailable')
    expect(service.getSnapshot()).toMatchObject({ isLoading: false, error: new Error('unavailable') })
    await service.upsert(copilot('new'))
    expect(get).toHaveBeenCalledTimes(2)
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['new', 'saved'])
  })

  test('backup access waits for writes, excludes edits, and reloads imported data inside its lock', async () => {
    const storage = new MemoryStorage()
    const service = new CopilotService({ storage })
    const writeBarrier = deferred<void>()
    const enteredBackup = deferred<void>()
    const finishBackup = deferred<void>()
    const originalSet = storage.set.bind(storage)
    vi.spyOn(storage, 'set').mockImplementationOnce(async (key, value) => {
      await writeBarrier.promise
      await originalSet(key, value)
    })

    const first = service.upsert(copilot('before'))
    const backup = service.withStorageLock(async (scope) => {
      expect(await storage.get(MY_COPILOTS_STORAGE_KEY)).toEqual([expect.objectContaining({ id: 'before' })])
      enteredBackup.resolve()
      await finishBackup.promise
      await storage.set(MY_COPILOTS_STORAGE_KEY, [copilot('imported')])
      await scope.reload()
    })
    const after = service.upsert(copilot('after'))
    writeBarrier.resolve()
    await enteredBackup.promise
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['before'])
    finishBackup.resolve()
    await Promise.all([first, backup, after])
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['after', 'imported'])
    await service.flush()
  })

  test('malformed saved data remains untouched until an import replaces and reloads it', async () => {
    const storage = new MemoryStorage()
    const malformed = [{ ...copilot('invalid'), description: 42 }]
    storage.values.set(MY_COPILOTS_STORAGE_KEY, malformed)
    const service = new CopilotService({ storage })
    await expect(service.hydrate()).rejects.toThrow('Invalid saved Copilots')
    await expect(service.upsert(copilot('new'))).rejects.toThrow('Invalid saved Copilots')
    expect(await storage.get(MY_COPILOTS_STORAGE_KEY)).toEqual(malformed)
    await service.withStorageLock(async (scope) => {
      await storage.set(MY_COPILOTS_STORAGE_KEY, [copilot('repaired')])
      await scope.reload()
    })
    await service.upsert(copilot('new'))
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['new', 'repaired'])
  })

  test('backup callback failures preserve the Copilot snapshot while reload failures are reported', async () => {
    const storage = new MemoryStorage()
    const service = new CopilotService({ storage })
    await service.upsert(copilot('saved'))
    const snapshot = service.getSnapshot()
    await expect(service.withStorageLock(() => Promise.reject(new Error('export canceled')))).rejects.toThrow(
      'export canceled'
    )
    expect(service.getSnapshot()).toBe(snapshot)
    await expect(
      service.withStorageLock(async (scope) => {
        await scope.reload()
        throw new Error('invalid backup')
      })
    ).rejects.toThrow('invalid backup')
    expect(service.getSnapshot().error).toBeNull()
    vi.spyOn(storage, 'get').mockRejectedValueOnce(new Error('read failed'))
    await expect(service.withStorageLock((scope) => scope.reload())).rejects.toThrow('read failed')
    expect(service.getSnapshot()).toMatchObject({ isLoading: false, error: new Error('read failed') })
  })

  test('removing a definition only writes myCopilots and leaves historical session data intact', async () => {
    const storage = new MemoryStorage()
    storage.values.set(MY_COPILOTS_STORAGE_KEY, [copilot('saved')])
    const session = { id: 'session', copilotId: 'saved', name: 'saved', assistantAvatarKey: 'image:avatar' }
    storage.values.set('session:session', session)
    const service = new CopilotService({ storage })
    const set = vi.spyOn(storage, 'set')
    await service.remove('saved')
    expect(set).toHaveBeenCalledExactlyOnceWith(MY_COPILOTS_STORAGE_KEY, [])
    expect(await storage.get('session:session')).toEqual(session)
  })

  test('memory ownership stores only identity and remains stable across edits and hydration', async () => {
    const storage = new MemoryStorage()
    const memory = new MemoryService({ storage })
    const service = new CopilotService({ storage, memoryLifecycle: memory, now: () => 10 })
    const definition = copilot('saved', {
      prompt: 'Custom prompt',
      avatar: { type: 'url', url: 'https://example.com/avatar.png' },
      backgroundImage: { type: 'url', url: 'https://example.com/background.png' },
    })
    for (const name of ['Original', 'Renamed']) {
      await service.upsert({ ...definition, name }, { memoryEnabled: true })
      const owners = [{ id: definition.id, name }]
      expect(memory.getSnapshot().owners).toEqual(owners)
      expect(await storage.get(COPILOT_MEMORY_OWNERS_STORAGE_KEY)).toEqual(owners)
      const restarted = new MemoryService({ storage })
      await restarted.hydrate()
      expect(restarted.getSnapshot().owners).toEqual(memory.getSnapshot().owners)
      expect(service.getSnapshot().copilots).toEqual([{ ...definition, name, createdAt: 10, updatedAt: 10 }])
    }
  })

  test('memory save failure keeps the persisted ID for retry and deletion waits for retirement', async () => {
    const storage = new MemoryStorage()
    const retirement = deferred<void>()
    const memoryLifecycle = {
      setCopilotMemoryEnabled: vi
        .fn()
        .mockRejectedValueOnce(new Error('memory write failed'))
        .mockResolvedValue(undefined),
      retireCopilot: vi.fn(async (_id: string, commitRemoval: () => Promise<void>) => {
        await retirement.promise
        await commitRemoval()
      }),
    }
    const service = new CopilotService({ storage, memoryLifecycle, now: () => 10 })
    await expect(service.upsert(copilot('new'), { memoryEnabled: true })).rejects.toThrow('memory write failed')
    expect(service.getSnapshot().copilots.map((item) => item.id)).toEqual(['new'])
    await service.upsert(copilot('new'), { memoryEnabled: true })
    expect(service.getSnapshot().copilots).toHaveLength(1)
    const removing = service.remove('new')
    await vi.waitFor(() => expect(memoryLifecycle.retireCopilot).toHaveBeenCalledWith('new', expect.any(Function)))
    expect(service.getSnapshot().copilots).toHaveLength(1)
    retirement.resolve()
    await removing
    expect(service.getSnapshot().copilots).toEqual([])
  })

  test('failed retirement preserves the definition and can be retried', async () => {
    const storage = new MemoryStorage()
    const memoryLifecycle = {
      setCopilotMemoryEnabled: vi.fn(),
      retireCopilot: vi
        .fn(async (_id: string, commitRemoval: () => Promise<void>) => commitRemoval())
        .mockRejectedValueOnce(new Error('cleanup failed')),
    }
    const service = new CopilotService({ storage, memoryLifecycle })
    await service.upsert(copilot('saved'))
    await expect(service.remove('saved')).rejects.toThrow('cleanup failed')
    expect(service.getSnapshot().copilots).toHaveLength(1)
    await service.remove('saved')
    expect(service.getSnapshot().copilots).toEqual([])
    expect(memoryLifecycle.retireCopilot).toHaveBeenCalledTimes(2)
  })

  test('local search matches prompt and description case-insensitively', () => {
    const records = [
      copilot('name'),
      copilot('other', { description: 'Description MATCH' }),
      copilot('prompt', { prompt: 'match' }),
    ]
    expect(searchCopilots(records, ' MATCH ').map((item) => item.id)).toEqual(['other', 'prompt'])
    expect(searchCopilots(records, '')).toEqual(records)
  })
})

describe('CopilotPreferences', () => {
  test('defaults to hidden and serializes a preference change behind hydration', async () => {
    const storage = new MemoryStorage()
    const service = new CopilotPreferences({ storage })
    expect(service.getSnapshot().showCopilots).toBe(false)
    await Promise.all([service.hydrate(), service.setShowCopilots(true), service.setShowCopilots(false)])
    expect(service.getSnapshot()).toEqual({ showCopilots: false, isLoading: false, error: null })
    expect(await storage.get(COPILOT_PREFERENCES_STORAGE_KEY)).toBe(false)
    await service.setShowCopilots(true)
    const restored = new CopilotPreferences({ storage })
    await restored.hydrate()
    expect(restored.getSnapshot().showCopilots).toBe(true)
  })

  test('failed preference writes retain persisted value and can be retried', async () => {
    const storage = new MemoryStorage()
    const service = new CopilotPreferences({ storage })
    await service.hydrate()
    vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('disk full'))
    await expect(service.setShowCopilots(true)).rejects.toThrow('disk full')
    expect(service.getSnapshot().showCopilots).toBe(false)
    await service.reload()
    expect(service.getSnapshot()).toEqual({ showCopilots: false, isLoading: false, error: null })
    await service.setShowCopilots(true)
    expect(service.getSnapshot()).toEqual({ showCopilots: true, isLoading: false, error: null })
  })
})

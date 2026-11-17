import { getDefaultStore } from 'jotai'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { values, writeStoreValue } = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  writeStoreValue: vi.fn<(key: string, value: unknown) => Promise<void>>(),
}))

vi.mock('@/platform', () => ({
  default: {
    getStoreValue: (key: string) => Promise.resolve(values.get(key)),
    getAllStoreKeys: () => Promise.resolve([...values.keys()]),
    setStoreValue: writeStoreValue,
    delStoreValue: async (key: string) => {
      values.delete(key)
    },
  },
}))

vi.mock('@/lib/utils', () => ({ getLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@/packages/model-calls/workspace-instructions', () => ({
  buildWorkspaceInstructions: vi.fn().mockResolvedValue(''),
  normalizeWorkspaceDirectory: (directory: string) => directory,
}))

const ownersKey = 'copilot-memory-owners'
const tokensKey = 'copilot-memory-state-tokens'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

async function loadStores() {
  const copilots = await import('./copilotStore')
  const { rendererMemoryService } = await import('./memoryRuntime')
  return { ...copilots, rendererMemoryService }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  values.clear()
  values.set(ownersKey, [])
  values.set(tokensKey, [])
  values.set('agent-memories', [])
  values.set('copilot-memories', {})
  writeStoreValue.mockReset().mockImplementation(async (key, value) => {
    values.set(key, value)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Web Copilot memory persistence', () => {
  test.each(['missing', 'null'])('reads %s memory libraries while writes are unavailable', async (stored) => {
    for (const key of ['agent-memories', 'copilot-memories']) {
      if (stored === 'missing') values.delete(key)
      else values.set(key, null)
    }
    const stores = await loadStores()
    writeStoreValue.mockRejectedValue(new Error('writes unavailable'))

    for (let read = 0; read < 2; read++) {
      await expect(stores.rendererMemoryService.listMemories()).resolves.toEqual([])
      await expect(stores.rendererMemoryService.listAllCopilotMemories()).resolves.toEqual({})
    }
    expect(writeStoreValue).not.toHaveBeenCalled()
    await expect(stores.rendererMemoryService.addMemory('Remember me')).rejects.toThrow('writes unavailable')
    expect(writeStoreValue).toHaveBeenCalledTimes(1)
  })

  test('rapid toggles persist in order while their live scope changes immediately', async () => {
    const stores = await loadStores()
    await stores.getCopilotMemorySelection('tutor')
    const writing = deferred()
    const release = deferred()
    let ownerWrites = 0
    writeStoreValue.mockImplementation(async (key, value) => {
      if (key === ownersKey && ++ownerWrites === 1) {
        writing.resolve()
        await release.promise
      }
      values.set(key, value)
    })
    const enable = stores.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    await writing.promise
    const disable = stores.disableCopilotMemory('tutor')

    await expect(stores.getCopilotMemorySelection('tutor')).resolves.toMatchObject({ scope: { type: 'global' } })
    expect(ownerWrites).toBe(1)
    release.resolve()
    await Promise.all([enable, disable])
    expect(ownerWrites).toBe(2)
    expect(values.get(ownersKey)).toEqual([])
    expect(values.get(tokensKey)).toEqual(await getDefaultStore().get(stores.copilotMemoryTokensAtom))
  })

  test('UI toggles and service reads share preferences after a reload', async () => {
    const stores = await loadStores()
    await stores.rendererMemoryService.reload()
    await stores.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    const selected = await stores.getCopilotMemorySelection('tutor')
    await expect(stores.rendererMemoryService.resolveState('tutor', {})).resolves.toMatchObject({
      scope: selected.scope,
      enabled: true,
    })
    expect(stores.rendererMemoryService.getSnapshot().owners).toEqual([{ id: 'tutor', name: 'Tutor' }])
    await stores.disableCopilotMemory('tutor')
    await expect(stores.rendererMemoryService.getCopilotMemorySelection('tutor')).resolves.toMatchObject({
      scope: { type: 'global' },
    })
    await stores.rendererMemoryService.enableCopilotMemory({ id: 'tutor', name: 'Renamed' })
    expect(await getDefaultStore().get(stores.copilotMemoryOwnersAtom)).toEqual([{ id: 'tutor', name: 'Renamed' }])
    await expect(stores.getCopilotMemoryScope('tutor')).resolves.toMatchObject({ type: 'copilot' })
  })

  test.each([ownersKey, tokensKey, 'copilot-memories', 'myCopilots'])(
    'failed deletion restores definitions, preferences and entries after the %s write fails',
    async (failedKey) => {
      const stores = await loadStores()
      const copilot = { id: 'tutor', name: 'Tutor', prompt: 'Teach' }
      await stores.addOrUpdateMyCopilot(copilot)
      await stores.enableCopilotMemory(copilot)
      const scope = await stores.getCopilotMemoryScope(copilot.id)
      await stores.rendererMemoryService.addMemoryForScope(scope, 'Remember me')
      const keys = ['myCopilots', ownersKey, tokensKey, 'copilot-memories']
      const previous = new Map(keys.map((key) => [key, structuredClone(values.get(key))]))
      let failed = false
      writeStoreValue.mockImplementation(async (key, value) => {
        values.set(key, value)
        if (key === failedKey && !failed) {
          failed = true
          throw new Error('write interrupted')
        }
      })

      await expect(stores.removeMyCopilot(copilot.id)).rejects.toThrow('write interrupted')
      expect(failed).toBe(true)
      await vi.advanceTimersByTimeAsync(2_500)
      for (const key of keys) expect(values.get(key)).toEqual(previous.get(key))
      expect(await getDefaultStore().get(stores.myCopilotsAtom)).toEqual(previous.get('myCopilots'))
      expect(await getDefaultStore().get(stores.copilotMemoryOwnersAtom)).toEqual(previous.get(ownersKey))
      expect(await getDefaultStore().get(stores.copilotMemoryTokensAtom)).toEqual(previous.get(tokensKey))
      await expect(stores.getCopilotMemoryScope(copilot.id)).resolves.toEqual(scope)
      await expect(stores.rendererMemoryService.addMemoryForScope(scope, 'Still my library')).resolves.toMatchObject({
        ok: true,
      })
    }
  )

  test('deletion waits for durable definition removal and serializes overlapping saves', async () => {
    const stores = await loadStores()
    const copilot = { id: 'tutor', name: 'Tutor', prompt: 'Teach' }
    await stores.addOrUpdateMyCopilot(copilot)
    await stores.enableCopilotMemory(copilot)
    const scope = await stores.getCopilotMemoryScope(copilot.id)
    await stores.rendererMemoryService.addMemoryForScope(scope, 'Remember me')
    const writing = deferred()
    const release = deferred()
    writeStoreValue.mockImplementation(async (key, value) => {
      if (key === 'myCopilots' && Array.isArray(value) && value.length === 0) {
        writing.resolve()
        await release.promise
      }
      values.set(key, value)
    })
    let removed = false
    const removal = stores.removeMyCopilot(copilot.id).then(() => {
      removed = true
    })
    await writing.promise
    const save = stores.addOrUpdateMyCopilot({ id: 'other', name: 'Other', prompt: 'Help' })
    let scopeResolved = false
    const selection = stores.getCopilotMemoryScope(copilot.id).then((selected) => {
      scopeResolved = true
      return selected
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(removed).toBe(false)
    expect(scopeResolved).toBe(false)
    expect(await getDefaultStore().get(stores.myCopilotsAtom)).toEqual([])
    release.resolve()
    await Promise.all([removal, save])
    await expect(selection).resolves.toEqual({ type: 'global' })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(values.get('myCopilots')).toEqual([expect.objectContaining({ id: 'other' })])
    expect(values.get('copilot-memories')).toEqual({})
    expect(values.get(ownersKey)).toEqual([])
    await expect(stores.rendererMemoryService.addMemoryForScope(scope, 'Old call')).resolves.toMatchObject({
      ok: false,
    })
  })

  test('retries a failed preference initialization before a normal edit', async () => {
    const stores = await loadStores()
    values.delete(ownersKey)
    writeStoreValue.mockRejectedValueOnce(new Error('seed failed'))
    await expect(stores.getCopilotMemorySelection('tutor')).rejects.toThrow('seed failed')
    await stores.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    await expect(stores.getCopilotMemoryScope('tutor')).resolves.toMatchObject({ type: 'copilot', copilotId: 'tutor' })
  })
})

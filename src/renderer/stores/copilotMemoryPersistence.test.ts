import { InMemorySessionRowStore } from '@chatbox/core/testing'
import type { BackupMetaStorage } from '@chatbox/core/backup/types'
import { unzipSync } from 'fflate'
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
const restoredOwners = [{ id: 'restored', name: 'Restored' }]
const restoredTokens = [{ id: 'restored', token: 'restored-token' }]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

function emptyMetaStorage(): BackupMetaStorage {
  return {
    getAllIncludingHidden: async () => [],
    getById: async () => null,
    create: async () => {},
    update: async () => null,
    delete: async () => {},
  }
}

function combineChunks(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function loadStores() {
  const copilots = await import('./copilotStore')
  const { withAgentPersonaLocks, rendererMemoryService, readSoul } = await import('./agentPersonaStore')
  // The restore adapter and preference store share the same platform persistence.
  const { default: StoreStorage } = await import('@/storage/StoreStorage')
  return { ...copilots, withAgentPersonaLocks, rendererMemoryService, readSoul, storage: new StoreStorage() }
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

  test('archive generation drains immediate preference writes and holds edits until the archive is consumed', async () => {
    const stores = await loadStores()
    const { exportRendererBackupArchive } = await import('@/app/persona-backup')
    await stores.getCopilotMemorySelection('tutor')
    const writing = deferred()
    const releaseWrite = deferred()
    let tokenWriteStarted = false
    writeStoreValue.mockImplementation(async (key, value) => {
      if (key === tokensKey && !tokenWriteStarted) {
        tokenWriteStarted = true
        writing.resolve()
        await releaseWrite.promise
      }
      values.set(key, value)
    })
    const enabled = stores.enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    await writing.promise
    await stores.storage.flushPendingWrites()
    expect(values.get(ownersKey)).toEqual([{ id: 'tutor', name: 'Tutor' }])
    expect(values.get(tokensKey)).toEqual([])

    const archiveOpened = deferred()
    const consumeArchive = deferred()
    const chunks: Uint8Array[] = []
    let archiveStarted = false
    const exporting = exportRendererBackupArchive({
      storage: stores.storage,
      metaStorage: emptyMetaStorage(),
      exportItems: ['copilot'],
      includeKeys: false,
      application: { version: 'test', platform: 'web' },
      writeArchive: async (dataCallback) => {
        archiveStarted = true
        archiveOpened.resolve()
        await consumeArchive.promise
        for await (const chunk of dataCallback()) chunks.push(chunk)
        return { boundedMemory: true }
      },
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(archiveStarted).toBe(false)
    releaseWrite.resolve()
    await enabled
    await archiveOpened.promise
    const tokensAtExport = values.get(tokensKey)
    let disableFinished = false
    const disabled = stores.disableCopilotMemory('tutor').then(() => {
      disableFinished = true
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(disableFinished).toBe(false)
    consumeArchive.resolve()
    const exported = await exporting
    await disabled

    const entries = unzipSync(combineChunks(chunks))
    const path = exported.manifest.data.sessionSettings?.path
    expect(path).toBeDefined()
    const preferences: unknown = JSON.parse(new TextDecoder().decode(entries[path!]))
    expect(preferences).toMatchObject({
      [ownersKey]: [{ id: 'tutor', name: 'Tutor' }],
      [tokensKey]: tokensAtExport,
    })
    expect(values.get(ownersKey)).toEqual([])
  })

  test('legacy import drains pending preference writes before replacing and reloading them', async () => {
    const stores = await loadStores()
    const { importRendererLegacyJsonBackup } = await import('@/app/persona-backup')
    await stores.getCopilotMemorySelection('old')
    const writing = deferred()
    const release = deferred()
    let tokenWriteStarted = false
    writeStoreValue.mockImplementation(async (key, value) => {
      if (key === tokensKey && !tokenWriteStarted) {
        tokenWriteStarted = true
        writing.resolve()
        await release.promise
      }
      values.set(key, value)
    })
    const enabled = stores.enableCopilotMemory({ id: 'old', name: 'Old' })
    await writing.promise
    const payload = JSON.stringify({ [ownersKey]: restoredOwners, [tokensKey]: restoredTokens })
    const readBackup = vi.fn(async () => payload)
    const importing = importRendererLegacyJsonBackup(
      { size: new TextEncoder().encode(payload).byteLength, text: readBackup },
      {
        storage: stores.storage,
        metaStorage: emptyMetaStorage(),
        sessions: new InMemorySessionRowStore(),
        migrateData: async () => {},
        recoverSessionList: async () => {},
      }
    )
    await vi.advanceTimersByTimeAsync(1)
    expect(readBackup).not.toHaveBeenCalled()
    release.resolve()
    await Promise.all([enabled, importing])

    expect(values.get(ownersKey)).toEqual(restoredOwners)
    expect(values.get(tokensKey)).toEqual(restoredTokens)
    await expect(stores.getCopilotMemorySelection('restored')).resolves.toMatchObject({
      scope: { type: 'copilot', copilotId: 'restored' },
      memoryStateToken: 'restored-token',
    })
    expect([...values.keys()].some((key) => key.startsWith('__backup_legacy:'))).toBe(false)
  })

  test('restored preferences survive the storage debounce interval', async () => {
    const stores = await loadStores()
    await stores.enableCopilotMemory({ id: 'old', name: 'Old' })

    await stores.withAgentPersonaLocks(async () => {
      await stores.storage.setItemNow(ownersKey, restoredOwners)
      await stores.storage.setItemNow(tokensKey, restoredTokens)
    })

    await expect(stores.getCopilotMemorySelection('restored')).resolves.toMatchObject({
      scope: { type: 'copilot', copilotId: 'restored' },
      memoryStateToken: 'restored-token',
    })
    await vi.advanceTimersByTimeAsync(2_500)
    expect(values.get(ownersKey)).toEqual(restoredOwners)
    expect(values.get(tokensKey)).toEqual(restoredTokens)
  })

  test('restore waits for an in-flight preference write to finish', async () => {
    const stores = await loadStores()
    await stores.getCopilotMemorySelection('old')
    const writing = deferred()
    const release = deferred()
    let ownerWriteStarted = false
    writeStoreValue.mockImplementation(async (key, value) => {
      if (key === ownersKey && !ownerWriteStarted) {
        ownerWriteStarted = true
        writing.resolve()
        await release.promise
      }
      values.set(key, value)
    })
    const toggle = stores.enableCopilotMemory({ id: 'old', name: 'Old' })
    await writing.promise
    let restored = false
    const restore = stores.withAgentPersonaLocks(async () => {
      restored = true
      await stores.storage.setItemNow(ownersKey, restoredOwners)
      await stores.storage.setItemNow(tokensKey, restoredTokens)
    })

    await vi.advanceTimersByTimeAsync(1)
    expect(restored).toBe(false)
    expect(await getDefaultStore().get(stores.copilotMemoryOwnersAtom)).toEqual([{ id: 'old', name: 'Old' }])
    release.resolve()
    await Promise.all([toggle, restore])
    await vi.advanceTimersByTimeAsync(2_500)
    expect(values.get(ownersKey)).toEqual(restoredOwners)
    expect(values.get(tokensKey)).toEqual(restoredTokens)
  })

  test.each(['toggle', 'read'])(
    'fresh preference initialization from a %s finishes before restore starts',
    async (action) => {
      const stores = await loadStores()
      values.delete(ownersKey)
      values.delete(tokensKey)
      const initializing = deferred()
      const release = deferred()
      const initialWrites = new Set<string>()
      writeStoreValue.mockImplementation(async (key, value) => {
        if ((key === ownersKey || key === tokensKey) && Array.isArray(value) && value.length === 0) {
          initialWrites.add(key)
          if (initialWrites.size === 2) initializing.resolve()
          await release.promise
        }
        values.set(key, value)
      })
      const prepare =
        action === 'toggle'
          ? stores.enableCopilotMemory({ id: 'fresh', name: 'Fresh' })
          : stores.getCopilotMemorySelection('fresh')
      await initializing.promise
      let restoreStarted = false
      const restore = stores.withAgentPersonaLocks(async () => {
        restoreStarted = true
        await stores.storage.setItemNow(ownersKey, restoredOwners)
        await stores.storage.setItemNow(tokensKey, restoredTokens)
      })
      await vi.advanceTimersByTimeAsync(1)
      const startedBeforeInitialization = restoreStarted
      release.resolve()
      await Promise.all([prepare, restore])

      expect(startedBeforeInitialization).toBe(false)
      expect(values.get(ownersKey)).toEqual(restoredOwners)
      expect(values.get(tokensKey)).toEqual(restoredTokens)
      await expect(stores.getCopilotMemorySelection('restored')).resolves.toMatchObject({
        scope: { type: 'copilot', copilotId: 'restored' },
        memoryStateToken: 'restored-token',
      })
    }
  )

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

  test('a failed restore reloads persisted preferences before queued edits resume', async () => {
    const stores = await loadStores()
    await stores.enableCopilotMemory({ id: 'old', name: 'Old' })
    const importing = deferred()
    const release = deferred()
    const restore = stores.withAgentPersonaLocks(async () => {
      await stores.storage.setItemNow(ownersKey, restoredOwners)
      await stores.storage.setItemNow(tokensKey, restoredTokens)
      importing.resolve()
      await release.promise
      throw new Error('restore interrupted')
    })
    const rejected = expect(restore).rejects.toThrow('restore interrupted')
    await importing.promise
    const edit = stores.enableCopilotMemory({ id: 'after', name: 'After' })
    release.resolve()
    await Promise.all([rejected, edit])

    await vi.advanceTimersByTimeAsync(2_500)
    expect(values.get(ownersKey)).toEqual([...restoredOwners, { id: 'after', name: 'After' }])
    expect(values.get(tokensKey)).toEqual(await getDefaultStore().get(stores.copilotMemoryTokensAtom))
    await expect(stores.getCopilotMemorySelection('restored')).resolves.toMatchObject({
      scope: { type: 'copilot', copilotId: 'restored' },
      memoryStateToken: 'restored-token',
    })
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

  test('import refreshes definitions before a queued deletion reads its rollback state', async () => {
    const stores = await loadStores()
    await stores.addOrUpdateMyCopilot({ id: 'old', name: 'Old', prompt: 'Old' })
    const importing = deferred()
    const release = deferred()
    const restored = { id: 'restored', name: 'Restored', prompt: 'New' }
    const restore = stores.withAgentPersonaLocks(async () => {
      importing.resolve()
      await release.promise
      await stores.storage.setItemNow('myCopilots', [restored])
      await stores.storage.setItemNow(ownersKey, restoredOwners)
      await stores.storage.setItemNow(tokensKey, restoredTokens)
      await stores.storage.setItemNow('copilot-memories', {
        restored: [{ id: 'memory', content: 'Fact', createdAt: 1 }],
      })
    })
    await importing.promise
    const removal = stores.removeMyCopilot('restored')
    release.resolve()
    await Promise.all([restore, removal])
    await vi.advanceTimersByTimeAsync(2_500)
    expect(values.get('myCopilots')).toEqual([])
    expect(await getDefaultStore().get(stores.myCopilotsAtom)).toEqual([])
    expect(values.get('copilot-memories')).toEqual({})
    expect(values.get(ownersKey)).toEqual([])
  })

  test('failed preference initialization can be retried before import', async () => {
    const stores = await loadStores()
    values.delete(ownersKey)
    writeStoreValue.mockRejectedValueOnce(new Error('seed failed'))
    await expect(stores.getCopilotMemorySelection('tutor')).rejects.toThrow('seed failed')
    await stores.withAgentPersonaLocks(async () => {
      await stores.storage.setItemNow(ownersKey, restoredOwners)
      await stores.storage.setItemNow(tokensKey, restoredTokens)
    })
    await expect(stores.getCopilotMemoryScope('restored')).resolves.toMatchObject({ type: 'copilot' })
  })

  test.each(['agent-soul', 'myCopilots'])('restore drains a pending %s seed before replacing storage', async (key) => {
    const stores = await loadStores()
    values.delete(key)
    const writing = deferred()
    const release = deferred()
    let seedStarted = false
    writeStoreValue.mockImplementation(async (storageKey, value) => {
      if (storageKey === key && !seedStarted) {
        seedStarted = true
        writing.resolve()
        await release.promise
      }
      values.set(storageKey, value)
    })
    const unsubscribe =
      key === 'myCopilots' ? getDefaultStore().sub(stores.myCopilotsAtom, () => undefined) : () => undefined
    const read =
      key === 'agent-soul' ? stores.readSoul() : Promise.resolve(getDefaultStore().get(stores.myCopilotsAtom))
    await writing.promise
    const restoredValue =
      key === 'agent-soul'
        ? { content: 'Imported soul', updatedAt: 4 }
        : [{ id: 'restored', name: 'Restored', prompt: 'Imported' }]
    let restoreStarted = false
    const restore = stores.withAgentPersonaLocks(async () => {
      restoreStarted = true
      await stores.storage.setItemNow(key, restoredValue)
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(restoreStarted).toBe(false)
    release.resolve()
    await Promise.all([read, restore])
    await vi.advanceTimersByTimeAsync(2_500)
    expect(values.get(key)).toEqual(restoredValue)
    unsubscribe()
  })
})

import type { SessionPromptContextSnapshot } from '@shared/types/agent-persona'
import { getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { copilotMemoryEpoch, getItem, getItemRaw, persisted, setItem, setItemNow } = vi.hoisted(() => ({
  copilotMemoryEpoch: vi.fn(() => 0),
  getItem: vi.fn(),
  getItemRaw: vi.fn(),
  persisted: new Map<string, unknown>(),
  setItem: vi.fn().mockResolvedValue(undefined),
  setItemNow: vi.fn().mockResolvedValue(undefined),
}))

function readPersisted(key: string, initialValue: unknown) {
  return Promise.resolve(persisted.has(key) ? persisted.get(key) : initialValue)
}

function readRawPersisted(key: string) {
  return Promise.resolve(persisted.get(key) ?? null)
}

vi.mock('@/storage', () => ({
  default: {
    getItemRaw,
    getItem,
    setItem,
    setItemNow,
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
  StorageKey: { MyCopilots: 'myCopilots' },
}))

import { rendererMemoryService } from './memoryRuntime'

vi.spyOn(rendererMemoryService, 'copilotMemoryEpoch').mockImplementation(copilotMemoryEpoch)

import {
  copilotMemoryOwnersAtom,
  copilotMemoryTokensAtom,
  disableCopilotMemory,
  enableCopilotMemory,
  getCopilotMemoryScope,
  getCopilotMemorySelection,
  getCopilotName,
  getPausedCallMemoryScope,
  myCopilotsAtom,
  reloadCopilotState,
  removeMyCopilot,
  withCopilotMemoryPreferencesLock,
} from './copilotStore'

const copilot = { id: 'cp1', name: 'Tutor', prompt: 'p' }

describe('copilot store', () => {
  beforeEach(async () => {
    persisted.clear()
    persisted.set('myCopilots', [copilot])
    getItem.mockReset().mockImplementation(readPersisted)
    getItemRaw.mockReset().mockImplementation(readRawPersisted)
    setItemNow.mockReset().mockImplementation(async (key: string, value: unknown) => {
      persisted.set(key, value)
    })
    await getDefaultStore().set(myCopilotsAtom, [copilot])
    await getDefaultStore().set(copilotMemoryOwnersAtom, [])
    await getDefaultStore().set(copilotMemoryTokensAtom, [])
    setItem.mockClear()
    setItemNow.mockClear()
    copilotMemoryEpoch.mockClear().mockReturnValue(0)
  })

  test('resolves directory names from current definitions and restored definitions', async () => {
    await expect(getCopilotName('cp1')).resolves.toBe('Tutor')
    await expect(getCopilotName('missing')).resolves.toBeUndefined()
    await getDefaultStore().set(myCopilotsAtom, [{ ...copilot, name: 'Renamed tutor' }])
    await expect(getCopilotName('cp1')).resolves.toBe('Renamed tutor')
    persisted.set('myCopilots', [{ ...copilot, name: 'Restored tutor' }])
    await reloadCopilotState()
    await expect(getCopilotName('cp1')).resolves.toBe('Restored tutor')
    await removeMyCopilot('cp1')
    await expect(getCopilotName('cp1')).resolves.toBeUndefined()
  })

  test('sessions without a copilot stay on the global store', async () => {
    await expect(getCopilotMemoryScope(undefined)).resolves.toEqual({ type: 'global' })
  })

  test('a copilot with its own memory owns the session memory scope', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await expect(getCopilotMemoryScope('cp1')).resolves.toEqual({
      type: 'copilot',
      copilotId: 'cp1',
      epoch: 0,
      lifecycleToken: expect.any(String),
    })
  })

  test('records off-on round trips even when the final scope is unchanged', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    const initial = await getCopilotMemorySelection('cp1')
    await enableCopilotMemory({ id: 'cp1', name: 'Renamed Tutor' })
    const unchanged = await getCopilotMemorySelection('cp1')

    await disableCopilotMemory('cp1')
    const disabled = await getCopilotMemorySelection('cp1')
    const disabledOwners = await getDefaultStore().get(copilotMemoryOwnersAtom)
    const disabledTokens = await getDefaultStore().get(copilotMemoryTokensAtom)
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    const restored = await getCopilotMemorySelection('cp1')

    expect(initial.scope).toEqual({
      type: 'copilot',
      copilotId: 'cp1',
      epoch: 0,
      lifecycleToken: initial.memoryStateToken,
    })
    expect(initial.memoryStateToken).toEqual(expect.any(String))
    expect(unchanged.memoryStateToken).toBe(initial.memoryStateToken)
    expect(disabled.scope).toEqual({ type: 'global' })
    expect(disabled.memoryStateToken).toEqual(expect.any(String))
    expect(disabled.memoryStateToken).not.toBe(initial.memoryStateToken)
    expect(disabledOwners).toEqual([])
    expect(disabledTokens).toEqual([
      { id: 'cp1', token: disabled.memoryStateToken, retirementToken: initial.memoryStateToken },
    ])
    expect(restored.scope).toEqual(initial.scope)
    expect(restored.memoryStateToken).toEqual(expect.any(String))
    expect(restored.memoryStateToken).not.toBe(disabled.memoryStateToken)
  })

  test('a copilot that was never saved to My Copilots can own memory', async () => {
    await getDefaultStore().set(myCopilotsAtom, [])
    await enableCopilotMemory({ id: 'chatbox-featured:24', name: 'Translator' })
    await expect(getCopilotMemoryScope('chatbox-featured:24')).resolves.toEqual({
      type: 'copilot',
      copilotId: 'chatbox-featured:24',
      epoch: 0,
      lifecycleToken: expect.any(String),
    })
  })

  test.each([
    ['the copilot keeps no memory of its own', async () => {}],
    [
      'its memory was switched back off',
      async () => {
        await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
        await disableCopilotMemory('cp1')
      },
    ],
  ])('falls back to the global store when %s', async (_label, arrange) => {
    await arrange()
    await expect(getCopilotMemoryScope('cp1')).resolves.toEqual({ type: 'global' })
  })

  test('uses the live atom value before durable persistence catches up', async () => {
    let finishWrite!: () => void
    const writing = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    setItemNow.mockImplementationOnce(() => writing)
    const update = enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    try {
      expect(persisted.get('copilot-memory-owners')).toEqual([])
      await expect(getCopilotMemoryScope('cp1')).resolves.toEqual({
        type: 'copilot',
        copilotId: 'cp1',
        epoch: 0,
        lifecycleToken: expect.any(String),
      })
    } finally {
      finishWrite()
      await update
    }
  })

  test('backup reloads ownership mirrors before queued toggles resume', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    let enter!: () => void
    let finish!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const released = new Promise<void>((resolve) => {
      finish = resolve
    })
    const importing = withCopilotMemoryPreferencesLock(async ({ reload }) => {
      enter()
      await released
      persisted.set('copilot-memory-owners', [{ id: 'imported', name: 'Imported' }])
      persisted.set('copilot-memory-state-tokens', [{ id: 'imported', token: 'restored-token' }])
      await reload()
    })
    await entered
    const toggle = enableCopilotMemory({ id: 'after-import', name: 'After' })
    expect((await getDefaultStore().get(copilotMemoryOwnersAtom)).map((owner) => owner.id)).toEqual(['cp1'])
    finish()
    await Promise.all([importing, toggle])
    expect((await getDefaultStore().get(copilotMemoryOwnersAtom)).map((owner) => owner.id)).toEqual([
      'imported',
      'after-import',
    ])
    await expect(getCopilotMemorySelection('imported')).resolves.toMatchObject({
      memoryStateToken: 'restored-token',
      scope: { type: 'copilot', copilotId: 'imported' },
    })
    await expect(getCopilotMemoryScope('cp1')).resolves.toEqual({ type: 'global' })
  })

  test('refreshes restored definitions and memory mirrors without rewriting the backup', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    const restoredCopilot = { id: 'imported', name: 'Imported', prompt: 'Restored prompt' }
    const owners = [{ id: 'imported', name: 'Imported' }]
    const tokens = [{ id: 'imported', token: 'restored-version', retirementToken: 'restored-library' }]
    const memories = [{ id: 'global', content: 'Restored global memory', createdAt: 1 }]
    const copilotMemories = { imported: [{ id: 'private', content: 'Restored private memory', createdAt: 2 }] }
    persisted.set('myCopilots', [restoredCopilot])
    persisted.set('copilot-memory-owners', owners)
    persisted.set('copilot-memory-state-tokens', tokens)
    persisted.set('agent-memories', memories)
    persisted.set('copilot-memories', copilotMemories)
    setItemNow.mockClear()

    await reloadCopilotState()

    expect(await getDefaultStore().get(myCopilotsAtom)).toEqual([restoredCopilot])
    expect(await getDefaultStore().get(copilotMemoryOwnersAtom)).toEqual(owners)
    expect(await getDefaultStore().get(copilotMemoryTokensAtom)).toEqual(tokens)
    expect(rendererMemoryService.getSnapshot()).toMatchObject({ memories, copilotMemories, owners, tokens })
    await expect(getCopilotMemorySelection('imported')).resolves.toMatchObject({
      memoryStateToken: 'restored-version',
      scope: { type: 'copilot', copilotId: 'imported', lifecycleToken: 'restored-library' },
    })
    await expect(getCopilotMemoryScope('cp1')).resolves.toEqual({ type: 'global' })
    expect(setItemNow).not.toHaveBeenCalled()
  })

  test('finishes pending memory refreshes before reporting a definition reload failure', async () => {
    const failure = new Error('Definition storage unavailable')
    let finishMemoryRead: ((value: unknown) => void) | undefined
    getItem.mockImplementation((key: string, initialValue: unknown) => {
      if (key === 'myCopilots') return Promise.reject(failure)
      return readPersisted(key, initialValue)
    })
    getItemRaw.mockImplementation((key: string) => {
      if (key === 'agent-memories') {
        return new Promise((resolve) => {
          finishMemoryRead = resolve
        })
      }
      return readRawPersisted(key)
    })
    let settled = false
    const refresh = reloadCopilotState().catch((error: unknown) => {
      settled = true
      return error
    })
    await vi.waitFor(() => expect(finishMemoryRead).toBeDefined())
    expect(settled).toBe(false)

    finishMemoryRead?.([])
    await expect(refresh).resolves.toBe(failure)
    getItem.mockImplementation(readPersisted)
    getItemRaw.mockImplementation(readRawPersisted)
    await expect(reloadCopilotState()).resolves.toBeUndefined()
  })

  test('waits for persisted ownership before initializing an editable draft', async () => {
    vi.resetModules()
    let finishRead: ((owners: unknown) => void) | undefined
    getItem.mockImplementation((key: string, initialValue: unknown) => {
      if (key !== 'copilot-memory-owners') return readPersisted(key, initialValue)
      return new Promise((resolve) => {
        finishRead = resolve
      })
    })
    const freshStore = await import('./copilotStore')

    let settled = false
    const enabled = freshStore.readCopilotMemoryEnabled('cp1').then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishRead?.([{ id: 'cp1', name: 'Tutor' }])
    await expect(enabled).resolves.toBe(true)
  })

  test('hydrates memory preference keys once across repeated generation reads', async () => {
    vi.resetModules()
    persisted.set('copilot-memory-owners', [{ id: 'cp1', name: 'Tutor' }])
    persisted.set('copilot-memory-state-tokens', [{ id: 'cp1', token: 'token-1' }])
    const freshStore = await import('./copilotStore')

    await freshStore.getCopilotMemorySelection('cp1')
    await freshStore.getCopilotMemorySelection('cp1')

    expect(getItem.mock.calls.filter(([key]) => key === 'copilot-memory-owners')).toHaveLength(1)
    expect(getItem.mock.calls.filter(([key]) => key === 'copilot-memory-state-tokens')).toHaveLength(1)
  })

  test('waits for the first preference mutation before resolving generation scope', async () => {
    vi.resetModules()
    persisted.set('copilot-memory-owners', [{ id: 'cp1', name: 'Tutor' }])
    let finishTokenRead: ((tokens: unknown) => void) | undefined
    getItem.mockImplementation((key: string, initialValue: unknown) => {
      if (key !== 'copilot-memory-state-tokens') return readPersisted(key, initialValue)
      return new Promise((resolve) => {
        finishTokenRead = resolve
      })
    })
    const freshStore = await import('./copilotStore')
    await expect(freshStore.readCopilotMemoryEnabled('cp1')).resolves.toBe(true)

    const update = freshStore.disableCopilotMemory('cp1')
    let selectionSettled = false
    const selection = freshStore.getCopilotMemorySelection('cp1').then((value) => {
      selectionSettled = true
      return value
    })
    await Promise.resolve()
    expect(selectionSettled).toBe(false)

    finishTokenRead?.([])
    const resolvedSelection = await selection
    expect(resolvedSelection.scope).toEqual({ type: 'global' })
    expect(resolvedSelection.memoryStateToken).toEqual(expect.any(String))
    await update
  })

  test.each([
    [{ token: 'token-2' }, ''],
    [[null, { id: 'cp1', token: 2 }, { id: 7, token: 'token-2' }, { id: 'cp1', token: '' }], ''],
    [[null, { id: 'cp1', token: 'token-3' }], 'token-3'],
    [
      [
        { id: 'cp1', token: 'token-3' },
        { id: 'cp1', token: 'token-5' },
      ],
      'token-5',
    ],
    [[{ id: 'cp1', token: 'x'.repeat(129) }], ''],
  ])('sanitizes a persisted memory state token record', async (persistedTokens, expectedToken) => {
    vi.resetModules()
    persisted.set('copilot-memory-owners', [{ id: 'cp1', name: 'Tutor' }])
    persisted.set('copilot-memory-state-tokens', persistedTokens)
    const freshStore = await import('./copilotStore')

    await expect(freshStore.getCopilotMemorySelection('cp1')).resolves.toEqual({
      scope: { type: 'copilot', copilotId: 'cp1', epoch: 0, lifecycleToken: expectedToken || expect.any(String) },
      memoryStateToken: expectedToken || expect.any(String),
    })
  })

  test('pins the epoch the scope was resolved against, not the one at write time', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    copilotMemoryEpoch.mockReturnValue(2)
    const scope = await getCopilotMemoryScope('cp1')

    // Generation reaches its memory tools several awaits later; by then the copilot
    // may already have been deleted and the id handed to a new incarnation.
    copilotMemoryEpoch.mockReturnValue(3)
    expect(scope).toEqual({ type: 'copilot', copilotId: 'cp1', epoch: 2, lifecycleToken: expect.any(String) })
  })

  const snapshotFor = (memoryCopilotId?: string): SessionPromptContextSnapshot => ({
    version: 1,
    soul: '',
    memories: [],
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: 0,
    ...(memoryCopilotId ? { memoryCopilotId } : {}),
  })

  test.each([
    ['its memory is switched back off', async () => disableCopilotMemory('cp1')],
    ['the copilot is deleted outright', async () => removeMyCopilot('cp1')],
  ])('a paused call stays on the store its conversation was frozen against after %s', async (_label, arrange) => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await arrange()

    // Resolving live would hand the call the global store and leak what the
    // copilot decided to remember into the user's own memories.
    await expect(getPausedCallMemoryScope(snapshotFor('cp1'), 'cp1')).resolves.toMatchObject({
      type: 'copilot',
      copilotId: 'cp1',
    })
  })

  test('a paused call frozen against the global store ignores memory the copilot gained since', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await expect(getPausedCallMemoryScope(snapshotFor(), 'cp1')).resolves.toEqual({ type: 'global' })
  })

  test('a paused call retains its captured lifecycle when its copilot is recreated', async () => {
    await removeMyCopilot('cp1')
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    const selection = await getCopilotMemorySelection('cp1')
    if (selection.scope.type !== 'copilot') throw new Error('Expected Copilot memory')
    const snapshot = { ...snapshotFor('cp1'), memoryCopilotLifecycleToken: selection.scope.lifecycleToken }
    await removeMyCopilot('cp1')
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })

    const live = await getCopilotMemorySelection('cp1')
    const paused = await getPausedCallMemoryScope(snapshot, 'cp1')
    expect(paused).toMatchObject({ lifecycleToken: snapshot.memoryCopilotLifecycleToken })
    expect(paused).not.toEqual(live.scope)
  })

  test('retirement is persisted even when the copilot memory was already disabled', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await disableCopilotMemory('cp1')
    const [disabled] = await getDefaultStore().get(copilotMemoryTokensAtom)
    await removeMyCopilot('cp1')
    const [retired] = await getDefaultStore().get(copilotMemoryTokensAtom)
    expect(retired).toMatchObject({ id: 'cp1', token: disabled.token, retirementToken: expect.any(String) })
    expect(retired.retirementToken).not.toBe(disabled.retirementToken)
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await disableCopilotMemory('cp1')
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await expect(getCopilotMemoryScope('cp1')).resolves.toMatchObject({
      type: 'copilot',
      lifecycleToken: retired.retirementToken,
    })
  })

  test('a paused call without a snapshot cannot select a newly enabled Copilot library', async () => {
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await expect(getPausedCallMemoryScope(undefined, 'cp1')).resolves.toEqual({
      type: 'copilot',
      copilotId: 'cp1',
      epoch: -1,
    })
    await expect(getPausedCallMemoryScope(undefined, undefined)).resolves.toEqual({ type: 'global' })
  })

  test('mutations queued during a slow hydration read all survive', async () => {
    vi.resetModules()
    let finishRead: ((copilots: unknown) => void) | undefined
    getItem.mockImplementation((key: string, initialValue: unknown) => {
      if (key !== 'myCopilots') return readPersisted(key, initialValue)
      return new Promise((resolve) => {
        finishRead = resolve
      })
    })
    const freshStore = await import('./copilotStore')

    const first = freshStore.addOrUpdateMyCopilot({ id: 'cp1', name: 'Tutor', prompt: 'p' })
    const second = freshStore.addOrUpdateMyCopilot({ id: 'cp2', name: 'Coach', prompt: 'q' })
    await vi.waitFor(() => expect(finishRead).toBeDefined())
    finishRead?.([])
    await Promise.all([first, second])

    const stored = await getDefaultStore().get(freshStore.myCopilotsAtom)
    expect(stored.map((item) => item.id).sort()).toEqual(['cp1', 'cp2'])
  })
})

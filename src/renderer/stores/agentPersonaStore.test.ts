import { beforeEach, describe, expect, test, vi } from 'vitest'

const { platformName, storageValues } = vi.hoisted(() => ({
  platformName: { current: 'darwin' },
  storageValues: new Map<string, unknown>(),
}))

vi.mock('@/platform', () => ({
  default: { getPlatform: vi.fn(() => Promise.resolve(platformName.current)) },
}))

vi.mock('@/storage', () => ({
  default: {
    getItem: vi.fn((key: string, initialValue: unknown) => {
      if (!storageValues.has(key)) storageValues.set(key, initialValue)
      return Promise.resolve(storageValues.get(key))
    }),
    setItemNow: vi.fn((key: string, value: unknown) => {
      storageValues.set(key, value)
      return Promise.resolve()
    }),
  },
}))

vi.mock('i18next', () => ({ t: (key: string) => key }))

vi.mock('@/packages/model-calls/workspace-instructions', () => ({
  buildWorkspaceInstructions: vi.fn().mockResolvedValue(''),
  normalizeWorkspaceDirectory: (dir: string) => dir,
}))

import {
  AGENT_MEMORIES_AUTO_SCAN_DONE_KEY,
  AGENT_MEMORIES_STORAGE_KEY,
  addCopilotMemory,
  addMemory,
  COPILOT_MEMORIES_STORAGE_KEY,
  captureSessionPromptContextSnapshot,
  clearCopilotMemories,
  copilotMemoryEpoch,
  deleteCopilotMemory,
  deleteMemory,
  hasCompletedLocalMemoryAutoScan,
  importMemories,
  listCopilotMemories,
  listMemories,
  listMemoriesForScope,
  markLocalMemoryAutoScanCompleted,
  readSoul,
  retireCopilotMemories,
  updateSoul,
  writeSoul,
} from './agentPersonaStore'

beforeEach(() => {
  storageValues.clear()
  platformName.current = 'darwin'
})

describe('agent tool contract snapshot', () => {
  test.each(['darwin', 'linux', 'win32'])('freezes v2 on the %s desktop command backend', async (name) => {
    platformName.current = name
    await expect(captureSessionPromptContextSnapshot([], 'agent')).resolves.toMatchObject({
      agentToolContractVersion: 2,
    })
  })

  test.each(['web', 'ios', 'android', 'harmony'])('freezes the legacy fallback contract on %s', async (name) => {
    platformName.current = name
    await expect(captureSessionPromptContextSnapshot([], 'agent')).resolves.toMatchObject({
      agentToolContractVersion: 1,
    })
  })
})

describe('memory mutation serialization', () => {
  test('parallel save_memory calls keep every entry', async () => {
    const results = await Promise.all([addMemory('fact one'), addMemory('fact two'), addMemory('fact three')])
    expect(results.every((result) => result.ok)).toBe(true)
    const memories = await listMemories()
    expect(memories.map((entry) => entry.content).sort()).toEqual(['fact one', 'fact three', 'fact two'])
  })

  test('a deletion overlapping an add loses neither operation', async () => {
    const added = await addMemory('existing fact')
    if (!added.ok) throw new Error('setup failed')
    const [deleted, addedSecond] = await Promise.all([deleteMemory(added.entry.id), addMemory('new fact')])
    expect(deleted).toBe(true)
    expect(addedSecond.ok).toBe(true)
    const memories = await listMemories()
    expect(memories.map((entry) => entry.content)).toEqual(['new fact'])
  })

  test('duplicate contents are rejected even when submitted in parallel', async () => {
    const results = await Promise.all([addMemory('same fact'), addMemory('same fact')])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(await listMemories()).toHaveLength(1)
  })

  test('corrupt stored data falls back to an empty list', async () => {
    storageValues.set(AGENT_MEMORIES_STORAGE_KEY, { not: 'an array' })
    expect(await listMemories()).toEqual([])
  })

  test('bulk import appends unique valid entries without exceeding limits', async () => {
    await addMemory('existing fact')
    const result = await importMemories([
      'new fact',
      'existing fact',
      '',
      'x'.repeat(1_001),
      'another fact',
      'new fact',
    ])

    expect(result).toEqual({
      imported: 2,
      skippedDuplicate: 2,
      skippedEmpty: 1,
      skippedTooLong: 1,
      skippedLimit: 0,
    })
    expect((await listMemories()).map((entry) => entry.content)).toEqual(['existing fact', 'new fact', 'another fact'])
  })
})

describe('soul mutation serialization', () => {
  test('updateSoul applies edits atomically against the latest content', async () => {
    await writeSoul('alpha beta')
    const [first, second] = await Promise.all([
      updateSoul((content) => content.replace('alpha', 'gamma')),
      updateSoul((content) => content.replace('beta', 'delta')),
    ])
    expect('record' in first).toBe(true)
    expect('record' in second).toBe(true)
    expect((await readSoul()).content).toBe('gamma delta')
  })

  test('updateSoul surfaces updater errors without writing', async () => {
    await writeSoul('stable content')
    const result = await updateSoul(() => ({ error: 'search text not found' }))
    expect(result).toEqual({ error: 'search text not found' })
    expect((await readSoul()).content).toBe('stable content')
  })
})

describe('local memory auto-scan flag', () => {
  test('defaults to not completed and flips after marking', async () => {
    await expect(hasCompletedLocalMemoryAutoScan()).resolves.toBe(false)
    await markLocalMemoryAutoScanCompleted()
    await expect(hasCompletedLocalMemoryAutoScan()).resolves.toBe(true)
    expect(storageValues.get(AGENT_MEMORIES_AUTO_SCAN_DONE_KEY)).toBe(true)
  })

  test('treats corrupted stored values as not completed', async () => {
    storageValues.set(AGENT_MEMORIES_AUTO_SCAN_DONE_KEY, 'yes')
    await expect(hasCompletedLocalMemoryAutoScan()).resolves.toBe(false)
  })
})

describe('copilot memories', () => {
  test("keeps each copilot's list isolated from the global one and from other copilots", async () => {
    await addMemory('global fact')
    const first = await addCopilotMemory('cp1', 'copilot one fact')
    const second = await addCopilotMemory('cp2', 'copilot two fact')
    expect(first.ok && second.ok).toBe(true)

    expect((await listMemories()).map((entry) => entry.content)).toEqual(['global fact'])
    expect((await listCopilotMemories('cp1')).map((entry) => entry.content)).toEqual(['copilot one fact'])
    expect((await listCopilotMemories('cp2')).map((entry) => entry.content)).toEqual(['copilot two fact'])
  })

  test('applies the same validation rules per copilot list', async () => {
    await addCopilotMemory('cp1', 'same fact')
    const duplicate = await addCopilotMemory('cp1', 'same fact')
    expect(duplicate.ok).toBe(false)
    // The same content is allowed in another copilot's list and in the global list.
    await expect(addCopilotMemory('cp2', 'same fact')).resolves.toMatchObject({ ok: true })
    await expect(addMemory('same fact')).resolves.toMatchObject({ ok: true })
  })

  test('parallel copilot saves keep every entry', async () => {
    const results = await Promise.all([
      addCopilotMemory('cp1', 'fact one'),
      addCopilotMemory('cp1', 'fact two'),
      addCopilotMemory('cp2', 'fact three'),
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    expect((await listCopilotMemories('cp1')).length).toBe(2)
    expect((await listCopilotMemories('cp2')).length).toBe(1)
  })

  test('delete and clear only touch the targeted copilot', async () => {
    const added = await addCopilotMemory('cp1', 'to delete')
    if (!added.ok) throw new Error('setup failed')
    await addCopilotMemory('cp2', 'kept')

    await expect(deleteCopilotMemory('cp1', added.entry.id)).resolves.toBe(true)
    await expect(deleteCopilotMemory('cp1', added.entry.id)).resolves.toBe(false)
    expect(await listCopilotMemories('cp1')).toEqual([])

    await clearCopilotMemories('cp2')
    expect(await listCopilotMemories('cp2')).toEqual([])
    const record = storageValues.get(COPILOT_MEMORIES_STORAGE_KEY) as Record<string, unknown>
    expect(record.cp1).toBeUndefined()
    expect(record.cp2).toBeUndefined()
  })

  test('a write from a generation that outlived its copilot cannot resurrect the list', async () => {
    const epoch = copilotMemoryEpoch('cpGone')
    await addCopilotMemory('cpGone', 'fact from the old copilot', epoch)
    await retireCopilotMemories('cpGone')

    await expect(addCopilotMemory('cpGone', 'late fact', epoch)).resolves.toMatchObject({ ok: false })
    expect(await listCopilotMemories('cpGone')).toEqual([])
    expect(storageValues.get(COPILOT_MEMORIES_STORAGE_KEY)).toEqual({})
  })

  test('emptying the list from settings leaves an ongoing chat able to save again', async () => {
    const epoch = copilotMemoryEpoch('cpKept')
    await addCopilotMemory('cpKept', 'stale fact', epoch)
    await clearCopilotMemories('cpKept')

    await expect(addCopilotMemory('cpKept', 'fresh fact', epoch)).resolves.toMatchObject({ ok: true })
    expect((await listCopilotMemories('cpKept')).map((entry) => entry.content)).toEqual(['fresh fact'])
  })

  test('a copilot re-added under the same id starts from an empty list', async () => {
    const staleEpoch = copilotMemoryEpoch('cpReadded')
    await addCopilotMemory('cpReadded', 'fact from the old copilot', staleEpoch)
    await retireCopilotMemories('cpReadded')

    // The user adds the same remote copilot again; its generations capture the new epoch.
    const freshEpoch = copilotMemoryEpoch('cpReadded')
    expect(freshEpoch).not.toBe(staleEpoch)
    await expect(addCopilotMemory('cpReadded', 'late fact', staleEpoch)).resolves.toMatchObject({ ok: false })
    await expect(addCopilotMemory('cpReadded', 'fresh fact', freshEpoch)).resolves.toMatchObject({ ok: true })
    expect((await listCopilotMemories('cpReadded')).map((entry) => entry.content)).toEqual(['fresh fact'])
  })

  test('deleting a copilot that saved nothing still blocks a late write', async () => {
    const epoch = copilotMemoryEpoch('cpEmpty')
    await retireCopilotMemories('cpEmpty')
    await expect(addCopilotMemory('cpEmpty', 'late fact', epoch)).resolves.toMatchObject({ ok: false })
    expect(await listCopilotMemories('cpEmpty')).toEqual([])
  })

  test('corrupt stored record falls back to empty lists', async () => {
    storageValues.set(COPILOT_MEMORIES_STORAGE_KEY, 'corrupted')
    expect(await listCopilotMemories('cp1')).toEqual([])
  })

  test('listMemoriesForScope routes to the right store', async () => {
    await addMemory('global fact')
    await addCopilotMemory('cp1', 'copilot fact')
    expect((await listMemoriesForScope({ type: 'global' })).map((entry) => entry.content)).toEqual(['global fact'])
    expect(
      (await listMemoriesForScope({ type: 'copilot', copilotId: 'cp1', epoch: 0 })).map((entry) => entry.content)
    ).toEqual(['copilot fact'])
  })
})

describe('snapshot memory scope', () => {
  test('captures copilot memories and records the copilot id', async () => {
    await addMemory('global fact')
    await addCopilotMemory('cp1', 'copilot fact')

    const snapshot = await captureSessionPromptContextSnapshot([], 'chat', {
      type: 'copilot',
      copilotId: 'cp1',
      epoch: 0,
    })
    expect(snapshot.memoryCopilotId).toBe('cp1')
    expect(snapshot.memories.map((entry) => entry.content)).toEqual(['copilot fact'])
  })

  test('captures the global list without a copilot id by default', async () => {
    await addMemory('global fact')
    const snapshot = await captureSessionPromptContextSnapshot([], 'chat')
    expect(snapshot.memoryCopilotId).toBeUndefined()
    expect(snapshot.memories.map((entry) => entry.content)).toEqual(['global fact'])
  })
})

import { describe, expect, it } from 'vitest'
import type { BackupManifest } from '../backup-v3/types'
import { InMemoryKeyValueStorage } from '../testing/InMemoryKeyValueStorage'
import { parseCopilotMemoryStateTokens } from '../types/agent-persona'
import { GLOBAL_KEYS, GlobalDataBudget, ImportedGlobals } from './globals'

const manifest: BackupManifest = {
  format: 'chatbox-backup',
  formatVersion: 3,
  layout: 'rows',
  archiveId: 'archive',
  createdAt: '2026-10-21T00:00:00Z',
  producer: 'test',
  selection: { sessions: true, settings: false, copilots: true, credentials: false },
}

describe('imported memory lifecycle scope', () => {
  it('preserves unrelated local markers and refreshes replaced and imported memory identities', async () => {
    const storage = new InMemoryKeyValueStorage()
    const unaffected = { id: 'retired-unrelated', token: 'local-state', retirementToken: 'local-lifetime' }
    await storage.set(GLOBAL_KEYS.tokens, [
      unaffected,
      { id: 'old-owner', token: 'old-owner-state' },
      { id: 'old-memory', token: 'old-memory-state' },
      { id: 'imported-token', token: 'old-imported-state' },
    ])
    await storage.set(GLOBAL_KEYS.owners, [{ id: 'old-owner', name: 'Old owner' }])
    await storage.set(GLOBAL_KEYS.copilotMemories, { 'old-memory': [] })
    const globals = new ImportedGlobals(manifest, storage)
    globals.append({
      type: 'global',
      category: 'memory-identities',
      id: 'owner:new-owner',
      value: { id: 'new-owner', name: 'New' },
    })
    globals.append({
      type: 'global',
      category: 'memory-identities',
      id: 'token:imported-token',
      value: { id: 'imported-token', token: 'source-state', retirementToken: 'source-lifetime' },
    })
    globals.append({ type: 'global', category: 'copilot-memory', id: 'new-memory', value: [] })
    const result = await globals.prepare()
    const tokens = parseCopilotMemoryStateTokens(result.get(GLOBAL_KEYS.tokens))
    expect(tokens.find((value) => value.id === unaffected.id)).toEqual(unaffected)
    for (const id of ['old-owner', 'old-memory', 'imported-token', 'new-owner', 'new-memory']) {
      const value = tokens.find((value) => value.id === id)
      expect(value).toBeDefined()
      expect(value?.token).toBe(value?.retirementToken)
      expect([
        'old-owner-state',
        'old-memory-state',
        'old-imported-state',
        'source-state',
        'source-lifetime',
      ]).not.toContain(value?.token)
    }
    expect(result.get(GLOBAL_KEYS.owners)).toEqual([{ id: 'new-owner', name: 'New' }])
    expect(result.get(GLOBAL_KEYS.copilotMemories)).toEqual({ 'new-memory': [] })
  })

  it('does not replace Copilot lifecycle markers when Copilots are unselected', async () => {
    const globals = new ImportedGlobals(
      { ...manifest, selection: { ...manifest.selection, copilots: false } },
      new InMemoryKeyValueStorage()
    )
    expect((await globals.prepare()).has(GLOBAL_KEYS.tokens)).toBe(false)
  })
})

describe('global import capacity', () => {
  it('counts UTF-8 bytes cumulatively rather than JavaScript character length', () => {
    const budget = new GlobalDataBudget()
    const value = '界'.repeat(6 * 1024 * 1024)
    budget.serialize(value)
    expect(() => budget.serialize(value)).toThrow('size budget')
  })

  it('rejects oversized existing collections even when the incoming backup is small', async () => {
    const storage = new InMemoryKeyValueStorage()
    const content = 'x'.repeat(17 * 1024 * 1024)
    await storage.set(GLOBAL_KEYS.owners, [{ id: 'existing', name: content }])
    await storage.set(GLOBAL_KEYS.copilotMemories, {
      existing: [{ id: 'memory', content, createdAt: 1 }],
    })
    const globals = new ImportedGlobals(manifest, storage)
    await expect(globals.prepare()).rejects.toThrow('size budget')
    expect(await storage.get(GLOBAL_KEYS.owners)).toEqual([{ id: 'existing', name: content }])
  })

  it('rejects a merged folder value exceeding the budget when both inputs fit separately', async () => {
    const storage = new InMemoryKeyValueStorage()
    await storage.set(GLOBAL_KEYS.folders, [{ id: 'existing', name: 'x'.repeat(17 * 1024 * 1024) }])
    const globals = new ImportedGlobals({ ...manifest, selection: { ...manifest.selection, copilots: false } }, storage)
    const name = 'y'.repeat(8 * 1024 * 1024)
    for (const id of ['first', 'second'])
      globals.append({ type: 'global', category: 'folder', id, value: { id, name } })
    await expect(globals.prepare()).rejects.toThrow('size budget')
    expect((await storage.get<Array<{ id: string }>>(GLOBAL_KEYS.folders))?.map((value) => value.id)).toEqual([
      'existing',
    ])
  })
})

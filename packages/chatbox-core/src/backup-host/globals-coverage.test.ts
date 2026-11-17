import { describe, expect, it } from 'vitest'
import type { BackupManifest } from '../backup-v3/types'
import { InMemoryKeyValueStorage } from '../testing/InMemoryKeyValueStorage'
import { parseCopilotMemoryStateTokens } from '../types/agent-persona'
import { GLOBAL_KEYS, ImportedGlobals } from './globals'

const manifest: BackupManifest = {
  format: 'chatbox-backup',
  formatVersion: 3,
  layout: 'rows',
  archiveId: 'legacy-import',
  createdAt: '2026-10-21T00:00:00Z',
  producer: 'test',
  selection: { sessions: true, settings: true, copilots: true, credentials: false },
}
async function localStorage() {
  const storage = new InMemoryKeyValueStorage()
  await storage.set(GLOBAL_KEYS.settings, { language: 'zh-Hans', memoryStateToken: 'local-global' })
  await storage.set(GLOBAL_KEYS.memories, [{ id: 'global', content: 'Keep global memory', createdAt: 1 }])
  await storage.set(GLOBAL_KEYS.copilots, [{ id: 'local', name: 'Local', prompt: 'Keep' }])
  await storage.set(GLOBAL_KEYS.copilotMemories, { local: [{ id: 'memory', content: 'Keep', createdAt: 1 }] })
  await storage.set(GLOBAL_KEYS.owners, [{ id: 'local', name: 'Local' }])
  await storage.set(GLOBAL_KEYS.tokens, [
    { id: 'local', token: 'local-state', retirementToken: 'local-lifetime' },
    { id: 'unrelated', token: 'unrelated-state', retirementToken: 'unrelated-lifetime' },
  ])
  return storage
}

describe('optional global collections during import', () => {
  it('does not synthesize global writes for absent keys, even when category selections are enabled', async () => {
    const storage = await localStorage()
    const globals = new ImportedGlobals(manifest, storage, { includedGlobalKeys: [] })
    expect(await globals.prepare()).toEqual(new Map())
  })

  it('replaces explicitly empty settings while preserving absent memory and Copilot collections', async () => {
    const storage = await localStorage()
    const globals = new ImportedGlobals(manifest, storage, { includedGlobalKeys: [GLOBAL_KEYS.settings] })
    globals.append({ type: 'global', category: 'settings', id: 'settings', value: {} })
    const values = await globals.prepare()
    expect([...values.keys()]).toEqual([GLOBAL_KEYS.settings])
    expect(values.get(GLOBAL_KEYS.settings)).toEqual({ memoryStateToken: expect.any(String) })
    expect(await storage.get(GLOBAL_KEYS.memories)).toEqual([
      { id: 'global', content: 'Keep global memory', createdAt: 1 },
    ])
  })

  it('replaces included Copilots without reading or rotating omitted memory identities', async () => {
    const storage = await localStorage()
    const globals = new ImportedGlobals(manifest, storage, { includedGlobalKeys: [GLOBAL_KEYS.copilots] })
    expect(await globals.prepare()).toEqual(new Map([[GLOBAL_KEYS.copilots, []]]))
    expect(await storage.get(GLOBAL_KEYS.tokens)).toContainEqual({
      id: 'local',
      token: 'local-state',
      retirementToken: 'local-lifetime',
    })
  })

  it('clears explicit memory collections and retires affected identities while preserving omitted owners and unrelated tokens', async () => {
    const storage = await localStorage()
    const globals = new ImportedGlobals(manifest, storage, {
      includedGlobalKeys: [GLOBAL_KEYS.memories, GLOBAL_KEYS.copilotMemories],
    })
    const values = await globals.prepare()
    expect(values.get(GLOBAL_KEYS.memories)).toEqual([])
    expect(values.get(GLOBAL_KEYS.copilotMemories)).toEqual({})
    expect(values.has(GLOBAL_KEYS.owners)).toBe(false)
    expect(values.get(GLOBAL_KEYS.settings)).toEqual({ language: 'zh-Hans', memoryStateToken: expect.any(String) })
    expect((values.get(GLOBAL_KEYS.settings) as { memoryStateToken: string }).memoryStateToken).not.toBe('local-global')
    const tokens = parseCopilotMemoryStateTokens(values.get(GLOBAL_KEYS.tokens))
    expect(tokens.find((entry) => entry.id === 'local')).toEqual({
      id: 'local',
      token: expect.any(String),
      retirementToken: expect.any(String),
    })
    expect(tokens.find((entry) => entry.id === 'local')?.token).not.toBe('local-state')
    expect(tokens.find((entry) => entry.id === 'unrelated')).toEqual({
      id: 'unrelated',
      token: 'unrelated-state',
      retirementToken: 'unrelated-lifetime',
    })
  })

  it('clears explicitly included owners without clearing omitted memories', async () => {
    const globals = new ImportedGlobals(manifest, await localStorage(), { includedGlobalKeys: [GLOBAL_KEYS.owners] })
    const values = await globals.prepare()
    expect(values.get(GLOBAL_KEYS.owners)).toEqual([])
    expect(values.has(GLOBAL_KEYS.copilotMemories)).toBe(false)
    expect(
      parseCopilotMemoryStateTokens(values.get(GLOBAL_KEYS.tokens)).find((entry) => entry.id === 'local')
        ?.retirementToken
    ).not.toBe('local-lifetime')
  })

  it('retires explicitly replaced token identities without granting imported tools ownership of omitted memories', async () => {
    const globals = new ImportedGlobals(manifest, await localStorage(), { includedGlobalKeys: [GLOBAL_KEYS.tokens] })
    globals.append({
      type: 'global',
      category: 'memory-identities',
      id: 'token:local',
      value: { id: 'local', token: 'foreign-state', retirementToken: 'foreign-life' },
    })
    const values = await globals.prepare()
    expect([...values.keys()]).toEqual([GLOBAL_KEYS.tokens])
    const tokens = parseCopilotMemoryStateTokens(values.get(GLOBAL_KEYS.tokens))
    expect(tokens.find((entry) => entry.id === 'unrelated')?.token).not.toBe('unrelated-state')
    const message = globals.message({
      id: 'message',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          toolName: 'save_memory',
          toolCallId: 'call',
          state: 'error',
          memoryToolContext: {
            version: 1,
            enabled: true,
            scope: { type: 'copilot', copilotId: 'local', lifecycleToken: 'foreign-life' },
          },
        },
      ],
    })
    const part = message.contentParts[0]
    expect(part.type).toBe('tool-call')
    if (part.type !== 'tool-call' || part.memoryToolContext?.scope.type !== 'copilot')
      throw new Error('Missing tool context')
    expect(part.memoryToolContext.scope.lifecycleToken).not.toBe(
      tokens.find((entry) => entry.id === 'local')?.retirementToken
    )
  })

  it('rejects records outside the declared import coverage', () => {
    const globals = new ImportedGlobals(manifest, new InMemoryKeyValueStorage(), { includedGlobalKeys: [] })
    expect(() => globals.append({ type: 'global', category: 'settings', id: 'settings', value: {} })).toThrow(
      'import context'
    )
  })

  it('retires all explicitly emptied token identities while leaving their memory values untouched', async () => {
    const globals = new ImportedGlobals(manifest, await localStorage(), { includedGlobalKeys: [GLOBAL_KEYS.tokens] })
    const values = await globals.prepare()
    expect([...values.keys()]).toEqual([GLOBAL_KEYS.tokens])
    const tokens = parseCopilotMemoryStateTokens(values.get(GLOBAL_KEYS.tokens))
    expect(tokens.map((entry) => entry.id).sort()).toEqual(['local', 'unrelated'])
    expect(tokens.map((entry) => entry.token)).not.toContain('local-state')
    expect(tokens.map((entry) => entry.retirementToken)).not.toContain('unrelated-lifetime')
  })
})

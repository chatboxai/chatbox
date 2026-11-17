import { describe, expect, it } from 'vitest'
import type { BackupManifest } from '../backup-v3/types'
import { InMemoryKeyValueStorage } from '../testing/InMemoryKeyValueStorage'
import { combineMemoryStateTokens, type SessionPromptContextSnapshot } from '../types/agent-persona'
import type { Message } from '../types/session'
import { GLOBAL_KEYS, ImportedGlobals } from './globals'

const manifest = (selection: Partial<BackupManifest['selection']> = {}): BackupManifest => ({
  format: 'chatbox-backup',
  formatVersion: 3,
  layout: 'rows',
  archiveId: 'archive',
  createdAt: '2026-10-21T00:00:00Z',
  producer: 'test',
  selection: { sessions: false, settings: false, copilots: false, credentials: false, ...selection },
})
const snapshot = (overrides: Partial<SessionPromptContextSnapshot> = {}): SessionPromptContextSnapshot => ({
  version: 1,
  soul: '',
  memories: [],
  workspaceInstructions: '',
  workspaceDirectories: [],
  capturedAt: 1,
  memoryEnabled: true,
  ...overrides,
})
const message = (lifecycleToken: string): Message => ({
  id: 'message',
  role: 'assistant',
  contentParts: [
    {
      type: 'tool-call',
      toolName: 'save_memory',
      toolCallId: 'call',
      state: 'error',
      memoryToolContext: { version: 1, enabled: true, scope: { type: 'copilot', copilotId: 'tutor', lifecycleToken } },
    },
  ],
})
function lifecycle(value: Message) {
  const part = value.contentParts[0]
  return part.type === 'tool-call' && part.memoryToolContext?.scope.type === 'copilot'
    ? part.memoryToolContext.scope.lifecycleToken
    : undefined
}
function appendCopilot(globals: ImportedGlobals) {
  globals.append({
    type: 'global',
    category: 'copilot',
    id: 'tutor',
    value: { id: 'tutor', name: 'Tutor', prompt: 'Help' },
  })
  globals.append({
    type: 'global',
    category: 'memory-identities',
    id: 'owner:tutor',
    value: { id: 'tutor', name: 'Tutor' },
  })
  globals.append({
    type: 'global',
    category: 'memory-identities',
    id: 'token:tutor',
    value: { id: 'tutor', token: 'source-token', retirementToken: 'source-life' },
  })
  globals.append({ type: 'global', category: 'copilot-memory', id: 'tutor', value: [] })
}
describe('backup global restore policies', () => {
  it('clears included empty Copilot collections and leaves omitted global settings untouched', async () => {
    const storage = new InMemoryKeyValueStorage()
    await storage.set(GLOBAL_KEYS.copilots, [{ id: 'old' }])
    await storage.set(GLOBAL_KEYS.owners, [{ id: 'old', name: 'Old' }])
    await storage.set(GLOBAL_KEYS.tokens, [{ id: 'old', token: 'old-token', retirementToken: 'old-life' }])
    await storage.set(GLOBAL_KEYS.copilotMemories, { old: [{ id: 'memory' }] })
    const values = await new ImportedGlobals(manifest({ copilots: true }), storage).prepare()
    expect(values.get(GLOBAL_KEYS.copilots)).toEqual([])
    expect(values.get(GLOBAL_KEYS.owners)).toEqual([])
    expect(values.get(GLOBAL_KEYS.copilotMemories)).toEqual({})
    expect(values.get(GLOBAL_KEYS.tokens)).toEqual([
      { id: 'old', token: expect.any(String), retirementToken: expect.any(String) },
    ])
    expect(values.get(GLOBAL_KEYS.tokens)).not.toEqual(await storage.get(GLOBAL_KEYS.tokens))
    expect(values.has(GLOBAL_KEYS.settings)).toBe(false)
    expect(values.has(GLOBAL_KEYS.memories)).toBe(false)
  })
  it('replaces included settings and empty memories without merging local credentials', async () => {
    const storage = new InMemoryKeyValueStorage()
    await storage.set(GLOBAL_KEYS.settings, { licenseKey: 'local-secret', language: 'zh-Hans' })
    await storage.set(GLOBAL_KEYS.memories, [{ id: 'local' }])
    const globals = new ImportedGlobals(manifest({ settings: true }), storage)
    globals.append({
      type: 'global',
      category: 'settings',
      id: 'settings',
      value: { language: 'en', memoryStateToken: 'source-global', memoryEnabled: true },
    })
    const values = await globals.prepare(),
      settings = values.get(GLOBAL_KEYS.settings)
    expect(settings).toMatchObject({ language: 'en', memoryStateToken: expect.any(String) })
    expect(settings).not.toHaveProperty('licenseKey')
    expect(values.get(GLOBAL_KEYS.memories)).toEqual([])
    const restored = globals.snapshot(snapshot({ memoryStateToken: combineMemoryStateTokens('', 'source-global') }), {})
    expect(restored.memoryStateToken).toBe(
      combineMemoryStateTokens('', (settings as { memoryStateToken: string }).memoryStateToken)
    )
  })
  it('keeps local folder identity, fields, and order; an included empty list does not clear it', async () => {
    const storage = new InMemoryKeyValueStorage(),
      local = [
        { id: 'same', name: 'Local' },
        { id: 'local', name: 'Other' },
      ]
    await storage.set(GLOBAL_KEYS.folders, local)
    const globals = new ImportedGlobals(manifest({ sessions: true }), storage)
    globals.append({ type: 'global', category: 'folder', id: 'same', value: { id: 'same', name: 'Imported' } })
    globals.append({ type: 'global', category: 'folder', id: 'new', value: { id: 'new', name: 'New' } })
    expect((await globals.prepare()).get(GLOBAL_KEYS.folders)).toEqual([...local, { id: 'new', name: 'New' }])
    expect((await new ImportedGlobals(manifest({ sessions: true }), storage).prepare()).has(GLOBAL_KEYS.folders)).toBe(
      false
    )
  })
  it('remaps valid imported Copilot memories and rejects stale snapshot and tool identities', async () => {
    const globals = new ImportedGlobals(manifest({ copilots: true }), new InMemoryKeyValueStorage())
    appendCopilot(globals)
    const values = await globals.prepare(),
      tokens = values.get(GLOBAL_KEYS.tokens) as Array<{ id: string; token: string; retirementToken: string }>,
      token = tokens.find((item) => item.id === 'tutor')!
    expect(token.token).not.toBe('source-token')
    expect(token.retirementToken).not.toBe('source-life')
    const valid = globals.snapshot(
      snapshot({
        memoryCopilotId: 'tutor',
        memoryCopilotLifecycleToken: 'source-life',
        memoryStateToken: 'source-token:',
      }),
      { copilotId: 'tutor' }
    )
    expect(valid.memoryStateToken).toBe(`${token.token}:`)
    expect(valid.memoryCopilotLifecycleToken).toBe(token.retirementToken)
    const stale = globals.snapshot(
      snapshot({ memoryCopilotId: 'tutor', memoryCopilotLifecycleToken: 'retired', memoryStateToken: 'retired:' }),
      { copilotId: 'tutor' }
    )
    expect(stale.memoryStateToken).not.toBe(`${token.token}:`)
    expect(stale.memoryCopilotLifecycleToken).not.toBe(token.retirementToken)
    expect(lifecycle(globals.message(message('source-life')))).toBe(token.retirementToken)
    expect(lifecycle(globals.message(message('retired')))).not.toBe(token.retirementToken)
  })
  it('does not let a session-only backup acquire the local same-ID Copilot identity', async () => {
    const storage = new InMemoryKeyValueStorage()
    await storage.set(GLOBAL_KEYS.owners, [{ id: 'tutor', name: 'Tutor' }])
    await storage.set(GLOBAL_KEYS.tokens, [{ id: 'tutor', token: 'local-token', retirementToken: 'source-life' }])
    const globals = new ImportedGlobals(manifest({ sessions: true }), storage)
    await globals.prepare()
    const restored = globals.snapshot(
      snapshot({
        memoryCopilotId: 'tutor',
        memoryCopilotLifecycleToken: 'source-life',
        memoryStateToken: 'local-token:',
      }),
      { copilotId: 'tutor' }
    )
    expect(restored.memoryCopilotLifecycleToken).not.toBe('source-life')
    expect(restored.memoryStateToken).not.toBe('local-token:')
    expect(lifecycle(globals.message(message('source-life')))).not.toBe('source-life')
    expect(await storage.get(GLOBAL_KEYS.tokens)).toEqual([
      { id: 'tutor', token: 'local-token', retirementToken: 'source-life' },
    ])
  })
})

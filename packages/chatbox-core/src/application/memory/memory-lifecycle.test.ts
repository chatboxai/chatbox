import { describe, expect, test, vi } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import {
  parseCopilotMemoryStateTokens,
  type SessionPromptContextSnapshot,
  SessionPromptContextSnapshotSchema,
} from '../../types/agent-persona'
import { captureChatMemorySnapshot } from './capture-chat-memory'
import { COPILOT_MEMORY_OWNERS_STORAGE_KEY, COPILOT_MEMORY_TOKENS_STORAGE_KEY } from './MemoryPreferences'
import { MemoryContextUnavailableError, MemoryService } from './MemoryService'
import { resolveSessionPromptContextSnapshot } from './prompt-context-snapshot'

const owner = { id: 'tutor', name: 'Tutor' }

async function capture(memory: MemoryService) {
  const { scope } = await memory.getCopilotMemorySelection(owner.id)
  return SessionPromptContextSnapshotSchema.parse(
    JSON.parse(JSON.stringify(await captureChatMemorySnapshot(memory, scope)))
  )
}

describe('durable Copilot memory lifecycle', () => {
  test('new libraries have distinct identities from their first enable and retain them through restart', async () => {
    const sourceStorage = new InMemoryKeyValueStorage()
    const destinationStorage = new InMemoryKeyValueStorage()
    const source = new MemoryService({ storage: sourceStorage })
    const destination = new MemoryService({ storage: destinationStorage })
    await source.enableCopilotMemory(owner)
    await destination.enableCopilotMemory(owner)
    const captured = await capture(source)
    const destinationSnapshot = await capture(destination)
    expect(captured.memoryCopilotLifecycleToken).toEqual(expect.any(String))
    expect(destinationSnapshot.memoryCopilotLifecycleToken).not.toBe(captured.memoryCopilotLifecycleToken)
    const restarted = new MemoryService({ storage: sourceStorage })
    expect((await capture(restarted)).memoryCopilotLifecycleToken).toBe(captured.memoryCopilotLifecycleToken)
    await expect(
      restarted.addMemoryForScope(await restarted.getPausedCallMemoryScope(captured, owner.id), 'Same library')
    ).resolves.toMatchObject({ ok: true })
    await expect(
      destination.addMemoryForScope(await destination.getPausedCallMemoryScope(captured, owner.id), 'Other device')
    ).resolves.toMatchObject({ ok: false })
  })

  test.each([true, false])(
    'derives legacy identity from its saved state token with ownership enabled=%s',
    async (enabled) => {
      const storage = new InMemoryKeyValueStorage()
      storage.values.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, enabled ? [owner] : [])
      storage.values.set(COPILOT_MEMORY_TOKENS_STORAGE_KEY, [{ id: owner.id, token: 'legacy-state' }])
      const memory = new MemoryService({ storage })
      const legacySnapshot = SessionPromptContextSnapshotSchema.parse({
        version: 1,
        capturedAt: 1,
        scope: 'chat',
        soul: '',
        memories: [],
        memoryEnabled: true,
        memoryCopilotId: owner.id,
        memoryStateToken: 'legacy-state:',
        workspaceInstructions: '',
        workspaceDirectories: [],
      })
      const paused = await memory.getPausedCallMemoryScope(legacySnapshot, owner.id)
      expect(paused).toMatchObject({ lifecycleToken: 'legacy-state' })
      await expect(memory.addMemoryForScope(paused, 'Known legacy source')).resolves.toMatchObject({ ok: true })
      await memory.enableCopilotMemory(owner)
      await memory.disableCopilotMemory(owner.id)
      await memory.enableCopilotMemory(owner)
      expect((await capture(memory)).memoryCopilotLifecycleToken).toBe('legacy-state')
      expect(await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY)).toEqual([
        { id: owner.id, token: expect.any(String), retirementToken: 'legacy-state' },
      ])
      const restarted = new MemoryService({ storage })
      await expect(
        restarted.addMemoryForScope(
          await restarted.getPausedCallMemoryScope(legacySnapshot, owner.id),
          'After migration'
        )
      ).resolves.toMatchObject({ ok: true })
      const foreignSnapshot = { ...legacySnapshot, memoryStateToken: 'unrelated-state:' }
      await expect(
        restarted.addMemoryForScope(
          await restarted.getPausedCallMemoryScope(foreignSnapshot, owner.id),
          'Unknown source'
        )
      ).resolves.toMatchObject({ ok: false })
    }
  )

  test('lazily creates a durable identity for an enabled legacy owner without tokens', async () => {
    const storage = new InMemoryKeyValueStorage()
    storage.values.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, [owner])
    const memory = new MemoryService({ storage })
    await memory.hydrate()
    expect(memory.peekState(owner.id, {})).toBeUndefined()
    const captured = await capture(memory)
    expect(captured.memoryCopilotLifecycleToken).toEqual(expect.any(String))
    const token = captured.memoryCopilotLifecycleToken
    expect(await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY)).toEqual([
      { id: owner.id, token, retirementToken: token },
    ])
    const restarted = new MemoryService({ storage })
    expect((await capture(restarted)).memoryCopilotLifecycleToken).toBe(token)
    await expect(
      restarted.addMemoryForScope(await restarted.getPausedCallMemoryScope(captured, owner.id), 'Identified owner')
    ).resolves.toMatchObject({ ok: true })
  })

  test.each([true, false])(
    'rejects legacy snapshots with no source identity when ownership enabled=%s',
    async (enabled) => {
      const storage = new InMemoryKeyValueStorage()
      storage.values.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, enabled ? [owner] : [])
      const memory = new MemoryService({ storage })
      const legacySnapshot = SessionPromptContextSnapshotSchema.parse({
        version: 1,
        capturedAt: 1,
        scope: 'chat',
        soul: '',
        memories: [],
        memoryEnabled: true,
        memoryCopilotId: owner.id,
        workspaceInstructions: '',
        workspaceDirectories: [],
      })
      const paused = await memory.getPausedCallMemoryScope(legacySnapshot, owner.id)
      expect(paused).toMatchObject({ epoch: -1 })
      await expect(memory.addMemoryForScope(paused, 'Unidentified legacy call')).resolves.toMatchObject({ ok: false })
      await memory.enableCopilotMemory(owner)
      await expect(memory.addMemoryForScope(paused, 'Cannot bind after enable')).resolves.toMatchObject({ ok: false })
    }
  )

  test('a failed legacy identity write can be retried before capturing a scope', async () => {
    const storage = new InMemoryKeyValueStorage()
    storage.values.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, [owner])
    const memory = new MemoryService({ storage })
    const set = storage.set.bind(storage)
    vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('Identity write failed'))
    await expect(memory.getCopilotMemorySelection(owner.id)).rejects.toThrow('Identity write failed')
    vi.mocked(storage.set).mockImplementation(set)
    const captured = await capture(memory)
    const restarted = new MemoryService({ storage })
    expect((await capture(restarted)).memoryCopilotLifecycleToken).toBe(captured.memoryCopilotLifecycleToken)
  })

  test('a paused initial-incarnation save cannot recreate a deleted library after restart', async () => {
    const storage = new InMemoryKeyValueStorage()
    const memory = new MemoryService({ storage })
    await memory.enableCopilotMemory(owner)
    const snapshot = await capture(memory)
    expect(snapshot.memoryCopilotLifecycleToken).toEqual(expect.any(String))
    await memory.retireCopilot(owner.id)

    const restarted = new MemoryService({ storage })
    const paused = await restarted.getPausedCallMemoryScope(snapshot, owner.id)
    await expect(restarted.addMemoryForScope(paused, 'Old request')).resolves.toMatchObject({ ok: false })
    expect(await restarted.listCopilotMemories(owner.id)).toEqual([])
  })

  test.each(['never-enabled', 'disabled'] as const)(
    'retiring a %s Copilot preserves frozen global memories in its conversations',
    async (state) => {
      const storage = new InMemoryKeyValueStorage()
      const memory = new MemoryService({ storage })
      let pausedSnapshot: SessionPromptContextSnapshot | undefined
      if (state === 'disabled') {
        await memory.enableCopilotMemory(owner)
        await memory.addCopilotMemory(owner.id, 'Private fact')
        pausedSnapshot = await capture(memory)
        await memory.disableCopilotMemory(owner.id)
      }
      await memory.addMemory('Frozen global fact')
      const settings = { memoryEnabled: true, memoryStateToken: 'global-version' }
      const resolve = async (service: MemoryService, snapshot?: SessionPromptContextSnapshot) => {
        const effective = await service.resolveState(owner.id, settings)
        return resolveSessionPromptContextSnapshot(
          {
            effectiveAgentMode: 'off',
            memoryEnabled: effective.enabled,
            memoryScope: effective.scope,
            memoryStateToken: effective.memoryStateToken,
            settings: { sessionPromptContextSnapshot: snapshot },
            copilotId: owner.id,
            messages: snapshot ? [{ id: 'reply', role: 'assistant', contentParts: [] }] : [],
            targetMsgIx: snapshot ? 1 : 0,
          },
          {
            listMemoriesForScope: (scope) => service.listMemoriesForScope(scope),
            capture: (_directories, _mode, scope) => captureChatMemorySnapshot(service, scope),
            matchesDirectories: () => true,
          }
        )
      }
      const frozen = await resolve(memory)
      expect(frozen?.memories.map((entry) => entry.content)).toEqual(['Frozen global fact'])
      if (!frozen) throw new Error('Expected a conversation snapshot')
      const before = await memory.resolveState(owner.id, settings)
      const previousTokens = parseCopilotMemoryStateTokens(await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY))
      const previousEpoch = memory.copilotMemoryEpoch(owner.id)
      await memory.addMemory('Added after the conversation began')

      const commitRemoval = vi.fn(async () => undefined)
      await memory.retireCopilot(owner.id, commitRemoval)
      expect(commitRemoval).toHaveBeenCalledOnce()
      expect(memory.copilotMemoryEpoch(owner.id)).toBe(previousEpoch + 1)
      expect(await memory.listCopilotMemories(owner.id)).toEqual([])
      const tokens = parseCopilotMemoryStateTokens(await storage.get(COPILOT_MEMORY_TOKENS_STORAGE_KEY))
      if (state === 'never-enabled') expect(tokens).toEqual([])
      else {
        expect(tokens).toEqual([{ id: owner.id, token: previousTokens[0].token, retirementToken: expect.any(String) }])
        expect(tokens[0].retirementToken).not.toBe(previousTokens[0].retirementToken)
      }

      const restarted = new MemoryService({ storage })
      const after = await restarted.resolveState(owner.id, settings)
      expect(after).toEqual(before)
      const readMemories = vi.spyOn(restarted, 'listMemoriesForScope')
      expect(await resolve(restarted, frozen)).toBe(frozen)
      expect(readMemories).not.toHaveBeenCalled()

      if (pausedSnapshot) {
        const paused = await restarted.getPausedCallMemoryScope(pausedSnapshot, owner.id)
        await expect(restarted.addMemoryForScope(paused, 'Old private request')).resolves.toMatchObject({ ok: false })
        await expect(restarted.deleteMemoryForScope(paused, 'old-id')).rejects.toThrow(MemoryContextUnavailableError)
        expect(await restarted.listCopilotMemories(owner.id)).toEqual([])
        expect(restarted.getSnapshot().error).toBeNull()
      }
    }
  )

  test('paused and in-flight delete calls cannot modify a re-created library', async () => {
    const storage = new InMemoryKeyValueStorage()
    const memory = new MemoryService({ storage, createId: () => 'same-memory-id' })
    await memory.enableCopilotMemory(owner)
    await memory.addCopilotMemory(owner.id, 'Old fact')
    const originalScope = (await memory.getCopilotMemorySelection(owner.id)).scope
    const snapshot = await capture(memory)
    await memory.disableCopilotMemory(owner.id)
    await memory.retireCopilot(owner.id)
    await memory.enableCopilotMemory(owner)
    await memory.addCopilotMemory(owner.id, 'New fact')

    const write = vi.spyOn(storage, 'set')
    await expect(memory.deleteMemoryForScope(originalScope, 'same-memory-id')).rejects.toThrow(
      MemoryContextUnavailableError
    )
    expect(memory.getSnapshot().error).toBeNull()
    const restarted = new MemoryService({ storage })
    const paused = await restarted.getPausedCallMemoryScope(snapshot, owner.id)
    await expect(restarted.deleteMemoryForScope(paused, 'same-memory-id')).rejects.toThrow(
      MemoryContextUnavailableError
    )
    expect(restarted.getSnapshot().error).toBeNull()
    await expect(restarted.addMemoryForScope(paused, 'Old save')).resolves.toMatchObject({ ok: false })
    expect(write).not.toHaveBeenCalled()
    expect((await restarted.listCopilotMemories(owner.id)).map((entry) => entry.content)).toEqual(['New fact'])
  })

  test('new-incarnation paused calls survive off/on, renaming and restart until another deletion', async () => {
    const storage = new InMemoryKeyValueStorage()
    const memory = new MemoryService({ storage })
    await memory.retireCopilot(owner.id)
    await memory.enableCopilotMemory(owner)
    const snapshot = await capture(memory)
    expect(snapshot.memoryCopilotLifecycleToken).toEqual(expect.any(String))
    await memory.disableCopilotMemory(owner.id)
    await memory.enableCopilotMemory({ ...owner, name: 'Renamed' })

    const restarted = new MemoryService({ storage })
    const paused = await restarted.getPausedCallMemoryScope(snapshot, owner.id)
    await expect(restarted.addMemoryForScope(paused, 'Still valid')).resolves.toMatchObject({ ok: true })
    await restarted.disableCopilotMemory(owner.id)
    await expect(restarted.addMemoryForScope(paused, 'Paused while disabled')).resolves.toMatchObject({ ok: true })
    await restarted.retireCopilot(owner.id)
    const restartedAgain = new MemoryService({ storage })
    const retired = await restartedAgain.getPausedCallMemoryScope(snapshot, owner.id)
    await expect(restartedAgain.addMemoryForScope(retired, 'Retired request')).resolves.toMatchObject({ ok: false })
  })

  test('a new generation reloads the new incarnation and clears its lifecycle when falling back to global', async () => {
    const memory = new MemoryService({ storage: new InMemoryKeyValueStorage() })
    await memory.enableCopilotMemory(owner)
    const original = await capture(memory)
    await memory.retireCopilot(owner.id)
    await memory.enableCopilotMemory(owner)
    await memory.addCopilotMemory(owner.id, 'New incarnation')
    const dependencies = {
      listMemoriesForScope: memory.listMemoriesForScope.bind(memory),
      capture: async () => original,
      matchesDirectories: () => true,
    }
    const resolve = async (snapshot: typeof original) => {
      const state = await memory.resolveState(owner.id, {})
      return resolveSessionPromptContextSnapshot(
        {
          effectiveAgentMode: 'off',
          memoryEnabled: state.enabled,
          memoryScope: state.scope,
          memoryStateToken: state.memoryStateToken,
          settings: { sessionPromptContextSnapshot: snapshot },
          copilotId: owner.id,
          messages: [],
          targetMsgIx: 0,
        },
        dependencies
      )
    }
    const reloaded = await resolve(original)
    expect(reloaded).toMatchObject({
      memoryCopilotLifecycleToken: expect.any(String),
      memories: [{ content: 'New incarnation' }],
    })
    if (!reloaded) throw new Error('Expected snapshot')
    await memory.disableCopilotMemory(owner.id)
    const global = await resolve(reloaded)
    expect(global?.memoryCopilotId).toBeUndefined()
    expect(global?.memoryCopilotLifecycleToken).toBeUndefined()
  })
})

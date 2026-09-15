import type { SessionPromptContextSnapshot, SessionSettings } from '@shared/types'
import { SessionPromptContextSnapshotSchema } from '@shared/types/agent-persona'
import { describe, expect, test, vi } from 'vitest'
import { InMemoryKeyValueStorage } from '../../testing/InMemoryKeyValueStorage'
import { captureChatMemorySnapshot } from './capture-chat-memory'
import { COPILOT_MEMORY_OWNERS_STORAGE_KEY, COPILOT_MEMORY_TOKENS_STORAGE_KEY } from './MemoryPreferences'
import { MemoryService } from './MemoryService'
import { resolveSessionPromptContextSnapshot } from './prompt-context-snapshot'

function fixture(storage = new InMemoryKeyValueStorage()) {
  const memory = new MemoryService({ storage, now: () => 50, createId: () => 'memory' })
  const dependencies = {
    listMemoriesForScope: memory.listMemoriesForScope.bind(memory),
    capture: (
      _directories: string[] | undefined,
      _mode: 'chat' | 'agent',
      scope: Parameters<MemoryService['listMemoriesForScope']>[0]
    ) => captureChatMemorySnapshot(memory, scope, { now: () => 100, utcOffsetMinutes: 480 }),
    matchesDirectories: () => true,
  }
  return { memory, dependencies }
}

async function legacyCopilotFixture(scope: 'chat' | 'agent') {
  const storage = new InMemoryKeyValueStorage()
  storage.values.set(COPILOT_MEMORY_OWNERS_STORAGE_KEY, [{ id: 'copilot', name: 'Copilot' }])
  storage.values.set(COPILOT_MEMORY_TOKENS_STORAGE_KEY, [{ id: 'copilot', token: 'saved-state' }])
  const { memory, dependencies } = fixture(storage)
  await memory.addCopilotMemory('copilot', 'Updated preference')
  const snapshot = SessionPromptContextSnapshotSchema.parse({
    version: 1,
    scope,
    soul: 'Frozen persona',
    memories: [{ id: 'frozen', content: 'Original preference', createdAt: 1 }],
    memoryCopilotId: 'copilot',
    memoryEnabled: true,
    memoryStateToken: 'saved-state:',
    workspaceInstructions: 'Frozen workspace instructions',
    workspaceDirectories: [],
    capturedAt: 10,
    capturedUtcOffsetMinutes: 480,
  })
  const state = await memory.resolveState('copilot', {})
  const read = vi.spyOn(dependencies, 'listMemoriesForScope')
  const capture = vi.spyOn(dependencies, 'capture')
  const persist = vi.fn()
  const resolve = (existing: SessionPromptContextSnapshot) =>
    resolveSessionPromptContextSnapshot(
      {
        effectiveAgentMode: scope === 'agent' ? 'on' : 'off',
        memoryEnabled: state.enabled,
        memoryScope: state.scope,
        memoryStateToken: state.memoryStateToken,
        settings: { sessionPromptContextSnapshot: existing },
        messages: [],
        targetMsgIx: 0,
        persist,
      },
      dependencies
    )
  return { snapshot, state, read, capture, persist, resolve }
}

describe.each(['chat', 'agent'] as const)('%s Copilot snapshot compatibility', (scope) => {
  test('keeps a published snapshot frozen when the saved state identifies the current library', async () => {
    const { snapshot, state, read, capture, persist, resolve } = await legacyCopilotFixture(scope)
    expect(snapshot.memoryCopilotLifecycleToken).toBeUndefined()
    expect(state.scope).toMatchObject({ lifecycleToken: 'saved-state' })

    const result = await resolve(snapshot)

    expect(result).toBe(snapshot)
    expect(result?.memories).toEqual([{ id: 'frozen', content: 'Original preference', createdAt: 1 }])
    expect(read).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  test('reloads a conflicting explicit lifecycle even when the saved state token matches', async () => {
    const { snapshot, state, read, capture, persist, resolve } = await legacyCopilotFixture(scope)
    const existing = { ...snapshot, memoryCopilotLifecycleToken: 'another-library' }

    const result = await resolve(existing)

    expect(result).toEqual({
      ...snapshot,
      memoryCopilotLifecycleToken: 'saved-state',
      memories: [{ id: 'memory', content: 'Updated preference', createdAt: 50 }],
    })
    expect(existing.memories).toEqual(snapshot.memories)
    expect(read).toHaveBeenCalledExactlyOnceWith(state.scope)
    expect(capture).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledExactlyOnceWith(result)
  })
})

describe('portable memory snapshot capture', () => {
  test('captures the selected store with injected clock and timezone', async () => {
    const { memory } = fixture()
    await memory.addCopilotMemory('copilot', 'fact')
    expect(
      await captureChatMemorySnapshot(
        memory,
        { type: 'copilot', copilotId: 'copilot', epoch: 0 },
        { now: () => 100, utcOffsetMinutes: 480 }
      )
    ).toMatchObject({
      scope: 'chat',
      soul: '',
      workspaceInstructions: '',
      workspaceDirectories: [],
      capturedAt: 100,
      capturedUtcOffsetMinutes: 480,
      memoryCopilotId: 'copilot',
      memories: [{ content: 'fact' }],
    })
  })

  test('full history prevents windowed messages from recapturing a started conversation', async () => {
    const { memory, dependencies } = fixture()
    await memory.addMemory('new fact')
    const options = {
      effectiveAgentMode: 'off' as const,
      memoryEnabled: true,
      settings: {} as SessionSettings,
      messages: [],
      targetMsgIx: 0,
      history: {
        hasAssistantMessage: true,
        firstMessageTimestamp: 12,
        userMessageCount: 10,
        hasLegacyCommandHistory: false,
        sandboxSeedAttachments: [],
      },
    }
    expect(await resolveSessionPromptContextSnapshot(options, dependencies)).toBeUndefined()
    const explicit = await resolveSessionPromptContextSnapshot(
      { ...options, memoryStateToken: ':new-token' },
      dependencies
    )
    expect(explicit).toMatchObject({
      memories: [{ content: 'new fact' }],
      capturedAt: 12,
      memoryStateToken: ':new-token',
    })
    expect(explicit?.capturedUtcOffsetMinutes).toBeUndefined()
  })

  test('synchronous state checks agree with hydrated generation state', async () => {
    const { memory } = fixture()
    expect(memory.peekState('copilot', {})).toBeUndefined()
    await memory.enableCopilotMemory({ id: 'copilot', name: 'Copilot' })
    expect(memory.peekState('copilot', { memoryEnabled: false })).toEqual(
      await memory.resolveState('copilot', { memoryEnabled: false })
    )
    expect(memory.peekState(undefined, { memoryEnabled: false })).toMatchObject({
      enabled: false,
      scope: { type: 'global' },
    })
  })
})

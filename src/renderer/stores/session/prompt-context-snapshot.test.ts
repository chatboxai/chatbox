import type { Message, SessionPromptContextSnapshot, SessionSettings } from '@shared/types'
import { COPILOT_PROMPT_MAX_CHARS } from '@shared/types/agent-persona'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { captureSnapshot, listMemoriesForScope, matchesDirectories } = vi.hoisted(() => ({
  captureSnapshot: vi.fn(),
  listMemoriesForScope: vi.fn(),
  matchesDirectories: vi.fn(),
}))

vi.mock('@/stores/agentPersonaStore', () => ({
  captureSessionPromptContextSnapshot: captureSnapshot,
  listMemoriesForScope,
  sessionPromptContextSnapshotMatchesDirectories: matchesDirectories,
}))

import {
  extractCopilotPersona,
  resolveSessionPromptContextSnapshot,
  sessionPromptContextSnapshotMatchesMemoryState,
} from './prompt-context-snapshot'

function snapshot(
  agentToolContractVersion: 1 | 2,
  extra: Partial<SessionPromptContextSnapshot> = {}
): SessionPromptContextSnapshot {
  return {
    version: 1,
    soul: '',
    memories: [],
    workspaceInstructions: '',
    workspaceDirectories: [],
    capturedAt: 1,
    memoryStateToken: '',
    scope: 'agent',
    agentToolContractVersion,
    ...extra,
  }
}

function systemMessage(text: string): Message {
  return {
    id: 'sys-1',
    role: 'system',
    contentParts: [{ type: 'text', text }],
  } as Message
}

describe('extractCopilotPersona', () => {
  test('reads the first system message before the target index', () => {
    expect(extractCopilotPersona([systemMessage('You are a pirate copilot.')], 1)).toBe('You are a pirate copilot.')
  })

  test('returns undefined when there is no system message', () => {
    expect(extractCopilotPersona([], 0)).toBeUndefined()
  })

  test('caps an oversized Copilot prompt to the Copilot budget', () => {
    const overlay = `pirate ${'x'.repeat(COPILOT_PROMPT_MAX_CHARS + 200)}`
    const bounded = extractCopilotPersona([systemMessage(overlay)], 1)
    expect(bounded).toContain('[Copilot truncated for context safety]')
    expect(bounded?.length).toBeLessThan(overlay.length)
  })
})

const assistantMessage = {
  id: 'assistant-1',
  role: 'assistant',
  timestamp: 1,
  contentParts: [{ type: 'text', text: 'done' }],
} as Message

test('a late memory load no longer matches after the live state token changes', () => {
  const loaded = snapshot(2, {
    scope: 'chat',
    memoryEnabled: true,
    memoryStateToken: 'copilot-old:global-old',
  })

  expect(
    sessionPromptContextSnapshotMatchesMemoryState(loaded, { type: 'global' }, true, 'copilot-new:global-new')
  ).toBe(false)
})

describe('resolveSessionPromptContextSnapshot', () => {
  beforeEach(() => {
    captureSnapshot.mockReset()
    listMemoriesForScope.mockReset()
    listMemoriesForScope.mockResolvedValue([])
    matchesDirectories.mockReset()
    matchesDirectories.mockReturnValue(false)
  })

  test.each([
    [2, 1],
    [1, 2],
  ] as const)('keeps frozen command contract %i when recapturing on contract %i', async (frozen, current) => {
    captureSnapshot.mockResolvedValue(snapshot(current))

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      settings: {
        workingDirectories: ['/new-workdir'],
        sessionPromptContextSnapshot: snapshot(frozen),
      },
      messages: [],
      targetMsgIx: 0,
    })

    expect(result?.agentToolContractVersion).toBe(frozen)
  })

  test('freezes the Copilot prompt into a new agent snapshot', async () => {
    captureSnapshot.mockResolvedValue(snapshot(2))

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      settings: {},
      messages: [systemMessage('You are a pirate copilot.')],
      targetMsgIx: 1,
      copilotId: 'copilot-1',
    })

    expect(result?.copilotPersona).toBe('You are a pirate copilot.')
  })

  test('persists a bounded Copilot overlay in the snapshot', async () => {
    captureSnapshot.mockResolvedValue(snapshot(2))
    const overlay = `pirate ${'x'.repeat(COPILOT_PROMPT_MAX_CHARS + 200)}`

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      settings: {},
      messages: [systemMessage(overlay)],
      targetMsgIx: 1,
      copilotId: 'copilot-1',
    })

    expect(result?.copilotPersona).toContain('[Copilot truncated for context safety]')
    expect(result?.copilotPersona?.length).toBeLessThan(overlay.length)
  })

  test('does not freeze a session system prompt without a Copilot', async () => {
    captureSnapshot.mockResolvedValue(snapshot(2))

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      settings: {},
      messages: [systemMessage('You are a helpful assistant.')],
      targetMsgIx: 1,
    })

    expect(result?.copilotPersona).toBeUndefined()
  })

  test('reuses a frozen Copilot overlay without re-reading messages', async () => {
    matchesDirectories.mockReturnValue(true)
    const existing = { ...snapshot(2), copilotPersona: 'Frozen pirate overlay.' }

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      settings: { sessionPromptContextSnapshot: existing },
      messages: [systemMessage('Live prompt that must not replace the snapshot.')],
      targetMsgIx: 1,
      copilotId: 'copilot-1',
    })

    expect(captureSnapshot).not.toHaveBeenCalled()
    expect(result?.copilotPersona).toBe('Frozen pirate overlay.')
  })

  test('agent mode reuses a snapshot whose memory scope still matches', async () => {
    matchesDirectories.mockReturnValue(true)
    const existing = snapshot(2, { memoryCopilotId: 'cp1' })

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
      settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
      messages: [],
      targetMsgIx: 0,
    })

    expect(result).toBe(existing)
    expect(captureSnapshot).not.toHaveBeenCalled()
  })

  test('agent mode reloads only memories when the memory scope changed', async () => {
    matchesDirectories.mockReturnValue(true)
    const copilotMemories = [{ id: 'cm1', content: 'copilot fact', createdAt: 1 }]
    listMemoriesForScope.mockResolvedValue(copilotMemories)
    const persist = vi.fn()

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'on',
      memoryEnabled: true,
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
      settings: { sessionPromptContextSnapshot: snapshot(2) } as SessionSettings,
      messages: [],
      targetMsgIx: 0,
      persist,
    })

    expect(captureSnapshot).not.toHaveBeenCalled()
    expect(listMemoriesForScope).toHaveBeenCalledWith({ type: 'copilot', copilotId: 'cp1', epoch: 0 })
    expect(result?.memories).toEqual(copilotMemories)
    expect(result?.memoryCopilotId).toBe('cp1')
    expect(result?.memoryEnabled).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  test('chat mode reuses a snapshot only when the memory scope matches', async () => {
    const existing = snapshot(2, { scope: 'chat', memoryCopilotId: 'cp1' })
    const settings = { sessionPromptContextSnapshot: existing } as SessionSettings

    await expect(
      resolveSessionPromptContextSnapshot({
        effectiveAgentMode: 'off',
        memoryEnabled: true,
        memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
        settings,
        messages: [assistantMessage],
        targetMsgIx: 1,
      })
    ).resolves.toBe(existing)

    // Mid-conversation scope change: the new store's latest memories replace the
    // old store while the rest of the frozen snapshot keeps anchoring the prompt.
    const globalMemories = [{ id: 'gm1', content: 'global fact', createdAt: 1 }]
    listMemoriesForScope.mockResolvedValue(globalMemories)
    const persist = vi.fn()
    const { memoryCopilotId: _dropped, ...withoutCopilot } = existing
    await expect(
      resolveSessionPromptContextSnapshot({
        effectiveAgentMode: 'off',
        memoryEnabled: true,
        memoryScope: { type: 'global' },
        settings,
        messages: [assistantMessage],
        targetMsgIx: 1,
        persist,
      })
    ).resolves.toEqual({ ...withoutCopilot, memories: globalMemories, memoryEnabled: true })
    expect(captureSnapshot).not.toHaveBeenCalled()
    expect(listMemoriesForScope).toHaveBeenCalledWith({ type: 'global' })
    // The store this generation's tools were built for is recorded, so a tool call
    // it pauses is continued against that store rather than the outgoing one.
    expect(persist).toHaveBeenCalledWith({ ...withoutCopilot, memories: globalMemories, memoryEnabled: true })
  })

  test('chat mode reloads the copilot store a mid-conversation switch moves to', async () => {
    const existing = snapshot(2, { scope: 'chat' })
    const copilotMemories = [{ id: 'cm1', content: 'copilot fact', createdAt: 1 }]
    listMemoriesForScope.mockResolvedValue(copilotMemories)
    const persist = vi.fn()

    await expect(
      resolveSessionPromptContextSnapshot({
        effectiveAgentMode: 'off',
        memoryEnabled: true,
        memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
        settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
        messages: [assistantMessage],
        targetMsgIx: 1,
        persist,
      })
    ).resolves.toEqual({ ...existing, memories: copilotMemories, memoryCopilotId: 'cp1', memoryEnabled: true })
    expect(listMemoriesForScope).toHaveBeenCalledWith({ type: 'copilot', copilotId: 'cp1', epoch: 0 })
    expect(persist).toHaveBeenCalledWith({
      ...existing,
      memories: copilotMemories,
      memoryCopilotId: 'cp1',
      memoryEnabled: true,
    })
  })

  test('chat mode keeps memories empty when a scope change disables memory', async () => {
    const existing = snapshot(2, {
      scope: 'chat',
      memoryCopilotId: 'cp1',
      memories: [{ id: 'cm1', content: 'copilot fact', createdAt: 1 }],
    })
    const persist = vi.fn()
    const { memoryCopilotId: _dropped, ...withoutCopilot } = existing

    await expect(
      resolveSessionPromptContextSnapshot({
        effectiveAgentMode: 'off',
        memoryEnabled: false,
        memoryScope: { type: 'global' },
        settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
        messages: [assistantMessage],
        targetMsgIx: 1,
        persist,
      })
    ).resolves.toEqual({ ...withoutCopilot, memories: [], memoryEnabled: false })
    expect(listMemoriesForScope).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith({ ...withoutCopilot, memories: [], memoryEnabled: false })
  })

  test('chat mode reloads global memory after the global switch is turned off and back on', async () => {
    const latestGlobalMemories = [{ id: 'gm2', content: 'latest global fact', createdAt: 2 }]
    const initial = snapshot(2, {
      scope: 'chat',
      memories: [{ id: 'gm1', content: 'frozen global fact', createdAt: 1 }],
      memoryEnabled: true,
    })

    const disabledSnapshot = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: false,
      memoryScope: { type: 'global' },
      settings: { sessionPromptContextSnapshot: initial } as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })
    listMemoriesForScope.mockResolvedValue(latestGlobalMemories)
    const enabledSnapshot = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryScope: { type: 'global' },
      settings: { sessionPromptContextSnapshot: disabledSnapshot } as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })

    expect(disabledSnapshot?.memories).toEqual([])
    expect(disabledSnapshot?.memoryEnabled).toBe(false)
    expect(enabledSnapshot?.memories).toEqual(latestGlobalMemories)
    expect(enabledSnapshot?.memoryEnabled).toBe(true)
    expect(listMemoriesForScope).toHaveBeenCalledTimes(1)
  })

  test('chat mode reloads after an off-on round trip before the next generation', async () => {
    const latestGlobalMemories = [{ id: 'gm2', content: 'latest global fact', createdAt: 2 }]
    listMemoriesForScope.mockResolvedValue(latestGlobalMemories)
    const existing = snapshot(2, {
      scope: 'chat',
      memories: [{ id: 'gm1', content: 'stale global fact', createdAt: 1 }],
      memoryEnabled: true,
      memoryStateToken: 'global-4',
    })

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryStateToken: 'global-6',
      memoryScope: { type: 'global' },
      settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })

    expect(result).toEqual({ ...existing, memories: latestGlobalMemories, memoryStateToken: 'global-6' })
    expect(listMemoriesForScope).toHaveBeenCalledWith({ type: 'global' })
  })

  test('chat mode keeps the frozen snapshot when regenerating the first assistant after a memory change', async () => {
    const latestGlobalMemories = [{ id: 'gm2', content: 'latest global fact', createdAt: 2 }]
    listMemoriesForScope.mockResolvedValue(latestGlobalMemories)
    const existing = snapshot(2, {
      scope: 'chat',
      soul: 'Frozen soul',
      workspaceInstructions: 'Frozen instructions',
      capturedAt: 1700000000000,
      memories: [{ id: 'gm1', content: 'stale global fact', createdAt: 1 }],
      memoryEnabled: true,
      memoryStateToken: 'global-4',
    })
    const userMessage = {
      id: 'user-1',
      role: 'user',
      timestamp: 1700000000000,
      contentParts: [{ type: 'text', text: 'hello' }],
    } as Message

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryStateToken: 'global-6',
      memoryScope: { type: 'global' },
      settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
      messages: [userMessage, assistantMessage],
      targetMsgIx: 1,
    })

    expect(result).toEqual({ ...existing, memories: latestGlobalMemories, memoryStateToken: 'global-6' })
    expect(captureSnapshot).not.toHaveBeenCalled()
  })

  test('chat mode reloads Copilot memory after an off-on round trip before the next generation', async () => {
    const latestCopilotMemories = [{ id: 'cm2', content: 'latest copilot fact', createdAt: 2 }]
    listMemoriesForScope.mockResolvedValue(latestCopilotMemories)
    const existing = snapshot(2, {
      scope: 'chat',
      memories: [{ id: 'cm1', content: 'stale copilot fact', createdAt: 1 }],
      memoryCopilotId: 'cp1',
      memoryEnabled: true,
      memoryStateToken: 'copilot-3',
    })

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryStateToken: 'copilot-5',
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
      settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })

    expect(result).toEqual({ ...existing, memories: latestCopilotMemories, memoryStateToken: 'copilot-5' })
    expect(listMemoriesForScope).toHaveBeenCalledWith({ type: 'copilot', copilotId: 'cp1', epoch: 0 })
  })

  test('chat mode records an empty disabled state so enabling global memory can reload it later', async () => {
    const capturedWhileDisabled = snapshot(2, {
      scope: 'chat',
      memories: [{ id: 'gm0', content: 'must stay disabled', createdAt: 0 }],
    })
    captureSnapshot.mockResolvedValue(capturedWhileDisabled)
    const persist = vi.fn()

    const disabledSnapshot = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: false,
      memoryScope: { type: 'global' },
      settings: {} as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
      persist,
    })

    expect(disabledSnapshot?.memories).toEqual([])
    expect(disabledSnapshot?.memoryEnabled).toBe(false)
    expect(persist).toHaveBeenCalledWith({ ...capturedWhileDisabled, memories: [], memoryEnabled: false })
  })

  test('chat mode records an empty Copilot marker for a started snapshot-less conversation', async () => {
    const captured = snapshot(2, {
      scope: 'chat',
      memoryCopilotId: 'cp1',
      memories: [{ id: 'cm1', content: 'copilot fact', createdAt: 1 }],
    })
    captureSnapshot.mockResolvedValue(captured)

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
      settings: {} as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
      copilotId: 'cp1',
    })

    expect(result).toEqual({ ...captured, memories: [], memoryEnabled: true })
    expect(captureSnapshot).toHaveBeenCalledWith(undefined, 'chat', {
      type: 'copilot',
      copilotId: 'cp1',
      epoch: 0,
    })
  })

  test('chat mode loads Copilot memory into a snapshot-less conversation after an explicit change', async () => {
    const captured = snapshot(2, {
      scope: 'chat',
      memoryCopilotId: 'cp1',
      memories: [{ id: 'cm1', content: 'copilot fact', createdAt: 1 }],
      capturedAt: 99,
      capturedUtcOffsetMinutes: 480,
    })
    captureSnapshot.mockResolvedValue(captured)

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryStateToken: 'copilot-1',
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
      settings: {} as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
      copilotId: 'cp1',
    })

    expect(result?.memories).toEqual(captured.memories)
    expect(result?.memoryStateToken).toBe('copilot-1')
    expect(result?.capturedAt).toBe(assistantMessage.timestamp)
    expect(result?.capturedUtcOffsetMinutes).toBeUndefined()
  })

  test('chat mode loads Global Memory after a snapshot-less off-on round trip', async () => {
    const captured = snapshot(2, {
      scope: 'chat',
      memories: [{ id: 'gm1', content: 'global fact', createdAt: 1 }],
    })
    captureSnapshot.mockResolvedValue(captured)

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryStateToken: 'global-2',
      memoryScope: { type: 'global' },
      settings: {} as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })

    expect(result?.memories).toEqual(captured.memories)
    expect(result?.memoryStateToken).toBe('global-2')
    expect(captureSnapshot).toHaveBeenCalledWith(undefined, 'chat', { type: 'global' })
  })

  test('chat mode reloads each selected store across an off-on Copilot sequence', async () => {
    const copilotScope = { type: 'copilot', copilotId: 'cp1', epoch: 0 } as const
    const globalMemories = [{ id: 'gm1', content: 'global fact', createdAt: 1 }]
    const copilotMemories = [{ id: 'cm1', content: 'latest copilot fact', createdAt: 2 }]
    listMemoriesForScope.mockImplementation(async (scope) =>
      scope.type === 'copilot' ? copilotMemories : globalMemories
    )
    const initial = snapshot(2, {
      scope: 'chat',
      memoryCopilotId: 'cp1',
      memories: [{ id: 'cm0', content: 'frozen copilot fact', createdAt: 0 }],
    })

    const globalSnapshot = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryScope: { type: 'global' },
      settings: { sessionPromptContextSnapshot: initial } as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })
    const copilotSnapshot = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryScope: copilotScope,
      settings: { sessionPromptContextSnapshot: globalSnapshot } as SessionSettings,
      messages: [assistantMessage],
      targetMsgIx: 1,
    })

    expect(globalSnapshot?.memories).toEqual(globalMemories)
    expect(globalSnapshot?.memoryCopilotId).toBeUndefined()
    expect(copilotSnapshot?.memories).toEqual(copilotMemories)
    expect(copilotSnapshot?.memoryCopilotId).toBe('cp1')
  })

  test('chat mode reloads only memories before the first assistant after a scope change', async () => {
    const globalMemories = [{ id: 'gm1', content: 'global fact', createdAt: 1 }]
    listMemoriesForScope.mockResolvedValue(globalMemories)
    const persist = vi.fn()
    const existing = snapshot(2, {
      scope: 'chat',
      soul: 'Frozen soul',
      workspaceInstructions: 'Frozen instructions',
      capturedAt: 1700000000000,
      memoryCopilotId: 'cp1',
    })

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryScope: { type: 'global' },
      settings: { sessionPromptContextSnapshot: existing } as SessionSettings,
      messages: [],
      targetMsgIx: 0,
      persist,
    })

    const { memoryCopilotId: _previousScope, ...frozenSnapshot } = existing
    expect(result).toEqual({ ...frozenSnapshot, memories: globalMemories, memoryEnabled: true })
    expect(captureSnapshot).not.toHaveBeenCalled()
    expect(result?.memoryCopilotId).toBeUndefined()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  test('chat mode captures from the copilot store at conversation start', async () => {
    listMemoriesForScope.mockResolvedValue([{ id: 'cm1', content: 'copilot fact', createdAt: 1 }])
    captureSnapshot.mockResolvedValue(snapshot(2, { scope: 'chat', memoryCopilotId: 'cp1' }))
    const persist = vi.fn()

    const result = await resolveSessionPromptContextSnapshot({
      effectiveAgentMode: 'off',
      memoryEnabled: true,
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
      settings: {} as SessionSettings,
      messages: [],
      targetMsgIx: 0,
      persist,
    })

    expect(listMemoriesForScope).not.toHaveBeenCalled()
    expect(captureSnapshot).toHaveBeenCalledWith(undefined, 'chat', { type: 'copilot', copilotId: 'cp1', epoch: 0 })
    expect(result?.memoryCopilotId).toBe('cp1')
    expect(persist).toHaveBeenCalledTimes(1)
  })
})

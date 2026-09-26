import { createMemoryToolContext, MemoryService } from '@chatbox/core/application/memory'
import { createDefaultSettings } from '@chatbox/core/domain/settings'
import type { GenerationPreparationRequest } from '@chatbox/core/generation'
import { InMemoryKeyValueStorage } from '@chatbox/core/testing'
import type { ModelInterface } from '@shared/models/types'
import type { Message } from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import type { MemoryScope } from '@shared/types/agent-persona'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPausedAgentMemoryTools } from '@/packages/model-calls/toolsets/agent-memory'
import { prepareCapacitorMemoryContext } from './memory-context'
import { capacitorWorkMode, prepareCapacitorWorkMode } from './runtime'

const state = vi.hoisted(() => ({ memory: undefined as MemoryService | undefined, seed: vi.fn() }))

function memory() {
  if (!state.memory) throw new Error('Missing test memory service')
  return state.memory
}

vi.mock('@/stores/copilotStore', () => ({
  getCopilotName: vi.fn().mockResolvedValue(undefined),
  getCopilotMemorySelection: (id: string | undefined) => memory().getCopilotMemorySelection(id),
}))
vi.mock('@/stores/memoryRuntime', () => ({
  rendererMemoryService: { listMemoriesForScope: (scope: MemoryScope) => memory().listMemoriesForScope(scope) },
}))
vi.mock('@/stores/agentPersonaStore', () => ({
  addMemoryForScope: (scope: MemoryScope, content: string) => memory().addMemoryForScope(scope, content),
  deleteMemoryForScope: (scope: MemoryScope, id: string) => memory().deleteMemoryForScope(scope, id),
  copilotMemoryEpoch: (id: string) => memory().copilotMemoryEpoch(id),
}))
vi.mock('@/i18n/locales', () => ({ languageNameMap: { en: 'English' } }))
vi.mock('@/adapters/CurrentBlobStorage', () => ({ currentBlobStorage: { get: vi.fn(), set: vi.fn() } }))
vi.mock('@/packages/model-calls/toolsets/web-search', () => ({
  parseLinkTool: {},
  webSearchTool: {},
}))
vi.mock('@/packages/web-search', () => ({ PROVIDERS_WITH_PARSE_LINK: new Set() }))
vi.mock('@/stores/settingActions', () => ({ getExtensionSettings: () => ({ webSearch: { provider: 'test' } }) }))
vi.mock('./CapacitorWorkspace', () => ({
  CapacitorWorkspace: class {
    seed = state.seed
  },
}))
vi.mock('./capacitor-system-tools', () => ({ createCapacitorSystemToolGroups: () => [] }))
vi.mock('./normalize-work-image', () => ({ normalizeWorkImage: vi.fn() }))

function request(): GenerationPreparationRequest<ModelDependencies> {
  const messages: Message[] = [
    { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'Session instructions' }] },
    { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Make a report' }] },
    { id: 'answer', role: 'assistant', contentParts: [] },
  ]
  return {
    session: { id: 'session', name: 'Session', type: 'chat' },
    settings: { modelId: 'test', localWorkCapabilities: [] },
    globalSettings: createDefaultSettings(),
    config: { uuid: 'installation' },
    messages,
    targetMessageIndex: 2,
    model: {
      apiStyle: 'openai',
      modelId: 'test',
      isSupportSystemMessage: () => true,
      isSupportVision: () => false,
      isSupportToolUse: () => true,
    } as unknown as ModelInterface,
    modelContext: {} as ModelDependencies,
    attachments: { read: vi.fn().mockResolvedValue(null) },
    webBrowsing: false,
    agentModeValue: 'on',
    agentModeLocked: true,
    agentModeSupported: true,
    signal: new AbortController().signal,
    preserveLastPromptMessageToolCalls: false,
    lockAgentMode: vi.fn(),
  }
}

async function prepare(input: GenerationPreparationRequest<ModelDependencies>) {
  return prepareCapacitorWorkMode(
    input,
    await prepareCapacitorMemoryContext(input, (snapshot) => {
      input.settings = { ...input.settings, sessionPromptContextSnapshot: snapshot }
    })
  )
}

describe('Capacitor Work memory integration', () => {
  beforeEach(() => {
    state.memory = new MemoryService({ storage: new InMemoryKeyValueStorage() })
    state.seed.mockReset()
  })

  it('keeps Copilot memory isolated and frozen while exposing it with local Work tools', async () => {
    await memory().addMemory('Global secret preference')
    await memory().enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    await memory().addCopilotMemory('tutor', 'Use short answers')
    const input = request()
    input.session.copilotId = 'tutor'
    input.globalSettings.memoryEnabled = false

    const prepared = await prepare(input)
    const scope = (await memory().getCopilotMemorySelection('tutor')).scope
    expect(prepared.memoryToolContext).toEqual(createMemoryToolContext(scope, true))
    const prompt = JSON.stringify(prepared.promptMessages)
    expect(prompt).toContain('Session instructions')
    expect(prompt).toContain('Use short answers')
    expect(prompt).toContain('Work mode executes locally')
    expect(prompt).not.toContain('Global secret preference')
    expect(Object.keys(prepared.tools)).toEqual(
      expect.arrayContaining(['save_memory', 'delete_memory', 'code_execution'])
    )
    const step = await prepared.chatOptions.prepareStep({ messages: [] })
    expect(step.activeTools).toEqual(expect.arrayContaining(['save_memory', 'delete_memory', 'code_execution']))

    await prepared.tools.save_memory.execute?.(
      { content: 'Added during this session' },
      { toolCallId: 'save', messages: [], context: undefined }
    )
    const continued = await prepare(input)
    expect(JSON.stringify(continued.promptMessages)).not.toContain('Added during this session')
    expect((await memory().listCopilotMemories('tutor')).map((entry) => entry.content)).toContain(
      'Added during this session'
    )
    expect((await memory().listMemories()).map((entry) => entry.content)).toEqual(['Global secret preference'])
  })

  it('honors global memory disable and reloads the frozen slice when the setting changes', async () => {
    await memory().addMemory('Remember this preference')
    const input = request()
    input.globalSettings.memoryEnabled = false
    const disabled = await prepare(input)
    expect(disabled.memoryToolContext).toEqual(createMemoryToolContext({ type: 'global' }, false))
    expect(disabled.tools).not.toHaveProperty('save_memory')
    expect(JSON.stringify(disabled.promptMessages)).not.toContain('Remember this preference')

    input.globalSettings.memoryEnabled = true
    input.globalSettings.memoryStateToken = 'enabled-now'
    const enabled = await prepare(input)
    expect(JSON.stringify(enabled.promptMessages)).toContain('Remember this preference')
    expect(enabled.tools).toHaveProperty('save_memory')
  })

  it('uses the paused call lifecycle after source changes and rejects a recreated library', async () => {
    await memory().enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    const scope = (await memory().getCopilotMemorySelection('tutor')).scope
    const targetMessage: Message = {
      id: 'paused',
      role: 'assistant',
      contentParts: [
        {
          type: 'tool-call',
          state: 'call',
          toolName: 'save_memory',
          toolCallId: 'paused-save',
          args: { content: 'Paused preference' },
          memoryToolContext: createMemoryToolContext(scope, true),
        },
      ],
    }
    await memory().disableCopilotMemory('tutor')
    const restored = await capacitorWorkMode.createTools(
      { sessionId: 'session', modelName: 'Test', capabilities: [], signal: new AbortController().signal },
      buildPausedAgentMemoryTools({ targetMessage }).tools,
      true
    )
    expect(restored.active.has('save_memory')).toBe(true)
    await expect(
      restored.tools.save_memory.execute?.(
        { content: 'Paused preference' },
        { toolCallId: 'paused-save', messages: [], context: undefined }
      )
    ).resolves.toHaveProperty('message')
    expect(await memory().listMemories()).toEqual([])
    expect((await memory().listCopilotMemories('tutor')).map((entry) => entry.content)).toEqual(['Paused preference'])

    await memory().retireCopilot('tutor')
    await memory().enableCopilotMemory({ id: 'tutor', name: 'Tutor' })
    await expect(
      restored.tools.save_memory.execute?.(
        { content: 'Stale preference' },
        { toolCallId: 'paused-save', messages: [], context: undefined }
      )
    ).resolves.toEqual({ error: 'The memory context for this call is no longer available. Start a new generation.' })
    expect(await memory().listCopilotMemories('tutor')).toEqual([])
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'

// ── Hoisted mocks (environment + modules) ──────────────────────────────────

const {
  discoverSkillsMock,
  installFromSandboxMock,
  loadSkillMock,
  settingsState,
  getSettingsMock,
  isProMock,
  webSearchProvider,
  buildCodeExecutionToolsMock,
  buildRunCommandToolMock,
  getSessionAttachmentRagToolSetMock,
  skillsChangedListeners,
  requestUserExecApprovalMock,
  cancelUserExecMock,
  userExecMock,
  readWorkspaceInstructionsMock,
  platformName,
  builtInBrowser,
  buildFileToolsMock,
} = vi.hoisted(() => ({
  buildFileToolsMock: vi.fn((_messages: unknown, filesystemRead?: unknown, _loadFileMessages?: unknown) => ({
    tools: { read_file: filesystemRead ?? { execute: async () => ({}) } },
  })),
  discoverSkillsMock: vi.fn(),
  installFromSandboxMock: vi.fn(),
  loadSkillMock: vi.fn(),
  settingsState: {
    licenseKey: undefined as string | undefined,
    licenseDetail: undefined as unknown,
    licensePlanName: undefined as string | undefined,
    licenseActivationMethod: undefined as 'login' | 'manual' | undefined,
    hasExpiredLicense: false,
  },
  getSettingsMock: vi.fn(),
  isProMock: vi.fn(),
  webSearchProvider: { current: 'build-in' },
  buildCodeExecutionToolsMock: vi.fn(),
  buildRunCommandToolMock: vi.fn(),
  getSessionAttachmentRagToolSetMock: vi.fn(),
  skillsChangedListeners: new Set<() => void>(),
  requestUserExecApprovalMock: vi.fn(),
  cancelUserExecMock: vi.fn(),
  userExecMock: vi.fn(),
  readWorkspaceInstructionsMock: vi.fn(),
  platformName: { current: 'darwin' },
  builtInBrowser: { current: undefined as { readPage: () => Promise<unknown> } | undefined },
}))

const memoryValues = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@/stores/agentPersonaStore', async () => {
  const { MemoryService } = await import('@chatbox/core/application/memory')
  const rendererMemoryService = new MemoryService({
    storage: {
      get: <T>(key: string) => Promise.resolve((memoryValues.get(key) ?? null) as T | null),
      set: async <T>(key: string, value: T) => {
        memoryValues.set(key, value)
      },
    },
  })
  return {
    rendererMemoryService,
    addMemoryForScope: rendererMemoryService.addMemoryForScope.bind(rendererMemoryService),
    deleteMemoryForScope: rendererMemoryService.deleteMemoryForScope.bind(rendererMemoryService),
    copilotMemoryEpoch: rendererMemoryService.copilotMemoryEpoch.bind(rendererMemoryService),
  }
})

vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
  const windowMock: Record<string, unknown> = {
    electronAPI: undefined,
    localStorage: storage,
  }
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).window = windowMock
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).localStorage = storage
  return {}
})

vi.mock('@/platform', () => ({
  default: {
    type: 'web',
    getPlatform: vi.fn().mockImplementation(() => Promise.resolve(platformName.current)),
    readWorkspaceInstructions: readWorkspaceInstructionsMock,
    // Presence enables view_image registration (isViewImageAvailable).
    fsReadImage: vi.fn(),
    get builtInBrowser() {
      return builtInBrowser.current
    },
  },
}))

const trackAgentModeFullAccessBypassMock = vi.fn()
vi.mock('@/analytics/agent-mode', () => ({
  trackAgentModeFullAccessBypass: (...args: unknown[]) => trackAgentModeFullAccessBypassMock(...args),
}))

vi.mock('@/packages/mcp/controller', () => ({
  mcpController: {
    getAvailableTools: () => ({
      mcp_tool: { execute: async () => ({}) },
    }),
  },
}))

vi.mock('@/packages/skills/controller', () => ({
  subscribeSkillsChanged: (listener: () => void) => {
    skillsChangedListeners.add(listener)
    return () => skillsChangedListeners.delete(listener)
  },
  skillsController: {
    discoverSkills: discoverSkillsMock,
    installFromSandbox: installFromSandboxMock,
    loadSkill: loadSkillMock,
    userExec: userExecMock,
    cancelUserExec: cancelUserExecMock,
  },
}))

vi.mock('@/packages/user-exec-approval', () => ({
  requestUserExecApproval: requestUserExecApprovalMock,
  UserExecApprovalPausedError: class UserExecApprovalPausedError extends Error {
    constructor(
      readonly toolCallId: string,
      readonly command: string,
      readonly explanation?: string,
      readonly explanationError?: boolean,
      readonly workdir?: string
    ) {
      super(`User approval required before executing command: ${command}`)
      this.name = 'UserExecApprovalPausedError'
    }
  },
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      ...settingsState,
      getSettings: getSettingsMock,
    }),
    setState: (patch: Record<string, unknown>) => {
      Object.assign(settingsState, patch)
    },
  },
}))

vi.mock('@/packages/remote', () => ({
  getLicenseDetailRealtime: vi.fn(),
}))

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => ({
    webSearch: {
      provider: webSearchProvider.current,
    },
  }),
  isPro: isProMock,
}))

vi.mock('@/packages/model-calls/toolsets/code-execution', () => ({
  buildCodeExecutionTools: buildCodeExecutionToolsMock,
}))

vi.mock('@/packages/model-calls/toolsets/run-command', () => ({
  buildRunCommandTool: buildRunCommandToolMock,
}))

vi.mock('@/packages/model-calls/toolsets/web-search', () => {
  const { tool } = require('ai')
  const { z } = require('zod')
  return {
    webSearchTool: tool({ description: 'web_search', inputSchema: z.object({}), execute: async () => ({}) }),
    parseLinkTool: tool({ description: 'parse_link', inputSchema: z.object({}), execute: async () => ({}) }),
  }
})

vi.mock('@/packages/model-calls/toolsets/file', () => ({
  fileToolSetDescription: 'file toolset',
  buildFileTools: buildFileToolsMock,
}))

vi.mock('@/packages/model-calls/toolsets/filesystem', () => ({
  buildFilesystemTools: () => ({
    description: 'filesystem toolset',
    tools: {
      list_files: { execute: async () => ({}) },
      search_files: { execute: async () => ({}) },
      write_file: { execute: async () => ({}) },
      edit_file: { execute: async () => ({}) },
    },
  }),
}))

vi.mock('@/packages/model-calls/toolsets/knowledge-base', () => ({
  getToolSet: async () => ({
    tools: { knowledge_base: { execute: async () => ({}) } },
  }),
}))

vi.mock('@/packages/model-calls/toolsets/session-attachment-rag', () => ({
  getToolSet: getSessionAttachmentRagToolSetMock,
}))

import type { ModelInterface } from '@shared/models/types'
import type { SandboxProvider } from '@shared/sandbox-provider'
import type { Message } from '@shared/types'
import type { MemoryToolContext } from '@shared/types/agent-persona'
import type { ToolSet } from 'ai'
import { rendererMemoryService } from '@/stores/agentPersonaStore'
import { type BuildToolsOptions, buildToolsForSession } from '../tools-builder'

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockModel(overrides?: Partial<ModelInterface>): ModelInterface {
  return {
    isSupportToolUse: vi.fn().mockReturnValue(true),
    isSupportVision: vi.fn().mockReturnValue(true),
    isSupportSystemMessage: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as ModelInterface
}

function createMockSandboxProvider(): SandboxProvider {
  return {
    type: 'cloud',
    init: vi.fn().mockResolvedValue({ success: true }),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    copyFileIn: vi.fn().mockResolvedValue(undefined),
    checkAvailability: vi.fn().mockResolvedValue({ available: true }),
    resolveWorkingDirectory: vi.fn().mockResolvedValue(null),
    destroy: vi.fn(),
  } as unknown as SandboxProvider
}

async function toModelOutput(tool: unknown, output: unknown) {
  const mapper = tool as {
    toModelOutput: (options: { toolCallId: string; input: unknown; output: unknown }) => Promise<unknown> | unknown
  }
  return await mapper.toModelOutput({ toolCallId: 'tool-call-id', input: {}, output })
}

const sandboxToolNames = [
  'sandbox_bash',
  'sandbox_read',
  'sandbox_write',
  'sandbox_edit',
  'sandbox_grep',
  'sandbox_ls',
  'sandbox_find',
]

beforeEach(async () => {
  vi.clearAllMocks()
  builtInBrowser.current = undefined
  memoryValues.clear()
  await rendererMemoryService.reload()
  for (const listener of skillsChangedListeners) {
    listener()
  }
  getSettingsMock.mockReturnValue({
    skills: { enabledSkillNames: ['test-skill'] },
  })
  settingsState.licenseKey = undefined
  settingsState.licenseDetail = undefined
  settingsState.licensePlanName = undefined
  settingsState.licenseActivationMethod = undefined
  settingsState.hasExpiredLicense = false
  webSearchProvider.current = 'build-in'
  platformName.current = 'darwin'
  isProMock.mockReturnValue(true)
  buildCodeExecutionToolsMock.mockReturnValue({
    description: 'code execution toolset',
    tools: {
      code_execution: { execute: async () => ({}) },
      parse_file: { execute: async () => ({}) },
    },
    ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
  })
  buildRunCommandToolMock.mockReturnValue({
    description: 'run command toolset',
    tool: { execute: async () => ({}) },
  })
  getSessionAttachmentRagToolSetMock.mockResolvedValue({
    description: 'session attachment rag toolset',
    tools: { query_session_attachment: { execute: async () => ({}) } },
  })
  requestUserExecApprovalMock.mockResolvedValue('ai')
  userExecMock.mockResolvedValue({ success: true, exitCode: 0, stdout: 'ok', stderr: '' })
  readWorkspaceInstructionsMock.mockResolvedValue({
    directories: [],
    files: [],
    skippedDirectoryCount: 0,
    budgetExhausted: false,
  })
  cancelUserExecMock.mockResolvedValue({ killed: true })
  installFromSandboxMock.mockResolvedValue({ success: true, skillName: 'new-skill' })
  discoverSkillsMock.mockResolvedValue([
    { name: 'test-skill', description: 'A test skill' },
    { name: 'chatbox-product-info', description: 'Chatbox product info' },
    { name: 'disabled-skill', description: 'Disabled' },
  ])
  loadSkillMock.mockResolvedValue({
    metadata: {},
    body: '# Skill instructions',
    skillRoot: '/mock/builtin-skills/test-skill',
    files: ['references/checklist.md', 'scripts/validate.mjs'],
  })
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildToolsForSession', () => {
  test('agentMode="off" — no skills tools, no sandbox tools in result', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
    }
    const result = await buildToolsForSession(model, options)

    expect(result.tools.load_skill).toBeUndefined()
    expect(result.tools.chatbox_cli).toBeUndefined()
    expect(result.tools.user_exec).toBeUndefined()
    expect(result.tools.mcp_tool).toBeUndefined()
    expect(result.instructions).not.toContain('## Skills')
    expect(result.instructions).not.toContain('Chatbox Account CLI')
    // Memory tools are mode-independent, so tool-use communication guidance stays.
    expect(result.tools.save_memory).toBeDefined()
    expect(result.instructions).toContain('## Persistent Memory')
    expect(result.instructions).not.toContain('## Workspace Instructions')
    expect(result.instructions).not.toContain('Co-authored-by: Chatbox <chatbox@chatboxai.com>')
    expect(readWorkspaceInstructionsMock).not.toHaveBeenCalled()
    expect(discoverSkillsMock).not.toHaveBeenCalled()
    for (const name of sandboxToolNames) {
      expect(result.tools[name]).toBeUndefined()
    }
  })

  test('memory tools follow the copilot scope even when the global switch is off', async () => {
    const model = createMockModel()
    const globalSettings = { memoryEnabled: false, language: 'en' } as Parameters<
      typeof buildToolsForSession
    >[1]['globalSettings']

    const withoutScope = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
      globalSettings,
    })
    expect(withoutScope.tools.save_memory).toBeUndefined()
    expect(withoutScope.tools.delete_memory).toBeUndefined()

    const withCopilotScope = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
      globalSettings,
      memoryScope: { type: 'copilot', copilotId: 'cp1', epoch: 0 },
    })
    expect(withCopilotScope.tools.save_memory).toBeDefined()
    expect(withCopilotScope.tools.delete_memory).toBeDefined()
    expect(withCopilotScope.instructions).toContain('## Persistent Memory')
  })

  function pausedMemoryMessage(
    contexts: Array<{ id: string; context?: MemoryToolContext; name?: 'save_memory' | 'delete_memory' }>
  ): Message {
    return {
      id: 'paused-message',
      role: 'assistant',
      contentParts: contexts.map(({ id, context, name }) => ({
        type: 'tool-call',
        toolCallId: id,
        toolName: name ?? 'save_memory',
        state: 'paused',
        pauseReason: { type: 'tool_call_limit', maxToolCalls: 1 },
        ...(context ? { memoryToolContext: context } : {}),
      })),
    }
  }

  async function executeMemoryTool(tools: ToolSet, name: string, toolCallId: string, input: unknown) {
    const execute = tools[name]?.execute
    if (!execute) throw new Error(`Missing executable ${name}`)
    return execute(input, { toolCallId, messages: [], context: undefined })
  }

  test('paused global memory executes its captured context after the switch is disabled', async () => {
    const targetMessage = pausedMemoryMessage([
      { id: 'global-save', context: { version: 1, enabled: true, scope: { type: 'global' } } },
    ])
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
      globalSettings: { memoryEnabled: false, language: 'en' },
      memoryScope: { type: 'copilot', copilotId: 'new-scope', epoch: 0 },
    }
    const resumed = await buildToolsForSession(createMockModel({ isSupportToolUse: () => false }), {
      ...options,
      pausedMemoryContext: { targetMessage },
    })
    await expect(
      executeMemoryTool(resumed.tools, 'save_memory', 'global-save', { content: 'Global fact' })
    ).resolves.toMatchObject({
      message: expect.any(String),
    })
    expect((await rendererMemoryService.listMemories()).map((entry) => entry.content)).toEqual(['Global fact'])
    expect(await rendererMemoryService.listCopilotMemories('new-scope')).toEqual([])

    const nextGeneration = await buildToolsForSession(createMockModel(), {
      ...options,
      memoryScope: { type: 'global' },
    })
    expect(nextGeneration.tools.save_memory).toBeUndefined()
    expect(nextGeneration.tools.delete_memory).toBeUndefined()
  })

  test('each call in an appended message retains its own global or Copilot destination', async () => {
    await rendererMemoryService.enableCopilotMemory({ id: 'cp-mixed', name: 'Tutor' })
    const selection = await rendererMemoryService.getCopilotMemorySelection('cp-mixed')
    if (selection.scope.type !== 'copilot') throw new Error('Expected Copilot memory')
    const globalEntry = await rendererMemoryService.addMemory('Global old')
    const copilotEntry = await rendererMemoryService.addCopilotMemory('cp-mixed', 'Copilot old')
    if (!globalEntry.ok || !copilotEntry.ok) throw new Error('Memory setup failed')
    const globalContext: MemoryToolContext = { version: 1, enabled: true, scope: { type: 'global' } }
    const copilotContext: MemoryToolContext = {
      version: 1,
      enabled: true,
      scope: { type: 'copilot', copilotId: 'cp-mixed', lifecycleToken: selection.scope.lifecycleToken },
    }
    const targetMessage = pausedMemoryMessage([
      { id: 'global-save', context: globalContext },
      { id: 'copilot-save', context: copilotContext },
      { id: 'global-delete', context: globalContext, name: 'delete_memory' },
      { id: 'copilot-delete', context: copilotContext, name: 'delete_memory' },
    ])
    const { tools } = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
      memoryScope: { type: 'copilot', copilotId: 'another-branch', epoch: 0, lifecycleToken: 'another-life' },
      pausedMemoryContext: { targetMessage },
    })
    await executeMemoryTool(tools, 'save_memory', 'global-save', { content: 'Global new' })
    await executeMemoryTool(tools, 'save_memory', 'copilot-save', { content: 'Copilot new' })
    await executeMemoryTool(tools, 'delete_memory', 'global-delete', { id: globalEntry.entry.id })
    await executeMemoryTool(tools, 'delete_memory', 'copilot-delete', { id: copilotEntry.entry.id })

    expect((await rendererMemoryService.listMemories()).map((entry) => entry.content)).toEqual(['Global new'])
    expect((await rendererMemoryService.listCopilotMemories('cp-mixed')).map((entry) => entry.content)).toEqual([
      'Copilot new',
    ])
    expect(await rendererMemoryService.listCopilotMemories('another-branch')).toEqual([])
  })

  test('an older branch cannot borrow a recreated Copilot lifecycle from the current scope', async () => {
    await rendererMemoryService.enableCopilotMemory({ id: 'cp-recreated', name: 'Original' })
    const initial = await rendererMemoryService.getCopilotMemorySelection('cp-recreated')
    if (initial.scope.type !== 'copilot') throw new Error('Expected Copilot memory')
    const oldBranch = pausedMemoryMessage([
      {
        id: 'old-save',
        context: {
          version: 1,
          enabled: true,
          scope: { type: 'copilot', copilotId: 'cp-recreated', lifecycleToken: initial.scope.lifecycleToken },
        },
      },
      {
        id: 'old-delete',
        name: 'delete_memory',
        context: {
          version: 1,
          enabled: true,
          scope: { type: 'copilot', copilotId: 'cp-recreated', lifecycleToken: initial.scope.lifecycleToken },
        },
      },
    ])
    await rendererMemoryService.retireCopilot('cp-recreated')
    await rendererMemoryService.enableCopilotMemory({ id: 'cp-recreated', name: 'Recreated' })
    const selection = await rendererMemoryService.getCopilotMemorySelection('cp-recreated')
    if (selection.scope.type !== 'copilot') throw new Error('Expected Copilot memory')
    const newBranch = pausedMemoryMessage([
      {
        id: 'new-save',
        context: {
          version: 1,
          enabled: true,
          scope: { type: 'copilot', copilotId: 'cp-recreated', lifecycleToken: selection.scope.lifecycleToken },
        },
      },
    ])
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
      memoryScope: selection.scope,
    }
    const oldTools = await buildToolsForSession(createMockModel(), {
      ...options,
      pausedMemoryContext: { targetMessage: oldBranch },
    })
    const newTools = await buildToolsForSession(createMockModel(), {
      ...options,
      pausedMemoryContext: { targetMessage: newBranch },
    })

    await expect(
      executeMemoryTool(oldTools.tools, 'save_memory', 'old-save', { content: 'Retired fact' })
    ).resolves.toMatchObject({ error: expect.any(String) })
    await expect(
      executeMemoryTool(newTools.tools, 'save_memory', 'new-save', { content: 'Current fact' })
    ).resolves.toMatchObject({ message: expect.any(String) })
    const currentEntry = (await rendererMemoryService.listCopilotMemories('cp-recreated'))[0]
    await expect(
      executeMemoryTool(oldTools.tools, 'delete_memory', 'old-delete', { id: currentEntry.id })
    ).resolves.toEqual({
      error: 'The memory context for this call is no longer available. Start a new generation.',
    })
    expect((await rendererMemoryService.listCopilotMemories('cp-recreated')).map((entry) => entry.content)).toEqual([
      'Current fact',
    ])
    expect(await rendererMemoryService.listMemories()).toEqual([])
  })

  test.each(['global', 'copilot'] as const)(
    'legacy calls reject a %s scope inferred from the current topic',
    async (scopeType) => {
      const existing = await rendererMemoryService.addMemory('Preserve this')
      if (!existing.ok) throw new Error('Memory setup failed')
      const targetMessage = pausedMemoryMessage([{ id: 'legacy-save' }, { id: 'legacy-delete', name: 'delete_memory' }])
      const { tools } = await buildToolsForSession(createMockModel(), {
        webBrowsing: false,
        messages: [],
        agentMode: 'off',
        memoryScope:
          scopeType === 'global' ? { type: 'global' } : { type: 'copilot', copilotId: 'cp-legacy', epoch: 0 },
        pausedMemoryContext: { targetMessage },
      })
      await expect(
        executeMemoryTool(tools, 'save_memory', 'legacy-save', { content: 'Unknown destination' })
      ).resolves.toMatchObject({ error: expect.any(String) })
      await expect(
        executeMemoryTool(tools, 'delete_memory', 'legacy-delete', { id: existing.entry.id })
      ).resolves.toMatchObject({ error: expect.any(String) })
      expect((await rendererMemoryService.listMemories()).map((entry) => entry.content)).toEqual(['Preserve this'])
      expect(await rendererMemoryService.listCopilotMemories('cp-legacy')).toEqual([])
    }
  )

  test('disabled captured memory cannot be enabled by the current settings', async () => {
    const targetMessage = pausedMemoryMessage([
      { id: 'disabled-save', context: { version: 1, enabled: false, scope: { type: 'global' } } },
    ])
    const { tools } = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
      globalSettings: { memoryEnabled: true, language: 'en' },
      pausedMemoryContext: { targetMessage },
    })
    await expect(
      executeMemoryTool(tools, 'save_memory', 'disabled-save', { content: 'Must not save' })
    ).resolves.toMatchObject({ error: expect.any(String) })
    expect(await rendererMemoryService.listMemories()).toEqual([])
  })

  test('agentMode="off" exposes selected Knowledge Base without Work Mode tools', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      knowledgeBase: { id: 1, name: 'Product Docs' },
      messages: [],
      agentMode: 'off',
    })

    expect(result.tools.knowledge_base).toBeDefined()
    expect(result.tools.mcp_tool).toBeUndefined()
    expect(result.tools.load_skill).toBeUndefined()
    expect(result.tools.user_exec).toBeUndefined()
    expect(result.tools.list_files).toBeUndefined()
    expect(result.tools.code_execution).toBeUndefined()
    expect(discoverSkillsMock).not.toHaveBeenCalled()
  })

  test('agentMode="off" can combine Web Search and Knowledge Base', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: true,
      knowledgeBase: { id: 1, name: 'Product Docs' },
      messages: [],
      agentMode: 'off',
    })

    expect(result.tools.web_search).toBeDefined()
    expect(result.tools.knowledge_base).toBeDefined()
    expect(result.tools.mcp_tool).toBeUndefined()
    expect(result.tools.load_skill).toBeUndefined()
  })

  test('agentMode="on" — has all tools', async () => {
    const model = createMockModel()
    const provider = createMockSandboxProvider()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      codeExecution: {
        sessionId: 'session-1',
        provider,
        files: [],
      },
    }

    const result = await buildToolsForSession(model, options)

    expect(result.tools.load_skill).toBeDefined()
    expect(result.tools.mcp_tool).toBeDefined()
    expect(result.tools.knowledge_base).toBeUndefined()
    // Sandbox tools NOT present when code_execution is active
    for (const name of sandboxToolNames) {
      expect(result.tools[name]).toBeUndefined()
    }
    expect(result.tools.code_execution).toBeDefined()
    expect(result.instructions).toContain('## Git')
    expect(result.instructions).toContain('prefix its name with `chatbox/`')
    expect(result.instructions).toContain('Co-authored-by: Chatbox <chatbox@chatboxai.com>')
  })

  test('v2 command contract exposes run_command and retires legacy command tools', async () => {
    const provider = createMockSandboxProvider()
    vi.mocked(provider.resolveWorkingDirectory).mockResolvedValue('/sandbox/session-1')
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      agentToolContractVersion: 2,
      sessionSettings: { commandApprovalMode: 'smart', workingDirectories: ['/workspace/project'] },
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      commandExecution: { sessionId: 'session-1', provider },
    })

    expect(result.tools.run_command).toBeDefined()
    expect(result.tools.code_execution).toBeUndefined()
    expect(result.tools.user_exec).toBeUndefined()
    expect(result.tools.parse_file).toBeDefined()
    expect(result.instructions).toContain('run_command')
    expect(result.instructions).toContain('workdir set to /sandbox/session-1')
    expect(result.instructions).toContain('Use run_command with workdir set to /sandbox/session-1')
    expect(result.tools.install_skill.description).toContain('Installing Skills')
    expect(buildRunCommandToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        platform: 'darwin',
        approvalMode: 'smart',
        workingDirectories: ['/workspace/project'],
      })
    )
  })

  test('v2 command contract preserves Node code_execution on HarmonyOS', async () => {
    platformName.current = 'harmony'
    const provider = createMockSandboxProvider()
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      agentToolContractVersion: 2,
      sessionSettings: { commandApprovalMode: 'smart', workingDirectories: ['/workspace/project'] },
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      commandExecution: { sessionId: 'session-1', provider },
    })

    expect(result.tools.code_execution).toBeDefined()
    expect(result.tools.run_command).toBeUndefined()
    expect(result.tools.user_exec).toBeUndefined()
    expect(result.instructions).toContain('Use code_execution to download and unpack skill files')
    expect(result.instructions).toContain('HarmonyOS currently supports sandboxed Node.js through code_execution')
    expect(result.instructions).not.toContain('Use run_command')
    expect(buildRunCommandToolMock).not.toHaveBeenCalled()
  })

  test('v2 Windows instructions leave the execution contract to run_command', async () => {
    platformName.current = 'win32'
    const provider = createMockSandboxProvider()
    vi.mocked(provider.resolveWorkingDirectory).mockResolvedValue('C:\\sandbox\\session-1')
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      agentToolContractVersion: 2,
      sessionSettings: { commandApprovalMode: 'smart' },
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      commandExecution: { sessionId: 'session-1', provider },
    })

    expect(buildRunCommandToolMock).toHaveBeenCalledWith(expect.objectContaining({ platform: 'win32' }))
    expect(result.instructions).toContain('run command toolset')
    expect(result.instructions).toContain('Sandbox working directory: C:/sandbox/session-1')
    expect(result.instructions).not.toContain('Bash')
    expect(result.instructions).not.toContain('sandboxed environment for lightweight code execution')
  })

  test('v2 Full Access instructions describe execution only through run_command', async () => {
    const provider = createMockSandboxProvider()
    vi.mocked(provider.resolveWorkingDirectory).mockResolvedValue('/sandbox/session-1')
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      agentToolContractVersion: 2,
      sessionSettings: { commandApprovalMode: 'full_access', workingDirectories: ['/workspace/project'] },
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      commandExecution: { sessionId: 'session-1', provider },
    })

    expect(buildRunCommandToolMock).toHaveBeenCalledWith(expect.objectContaining({ approvalMode: 'full_access' }))
    expect(result.instructions).toContain('Keep the prepared skill directory beneath that sandbox root')
    expect(result.instructions).not.toContain('file sandbox first')
    expect(result.instructions).not.toContain('sandbox-first')
    expect(result.instructions).not.toContain('### Running Commands')
  })

  test.each(['web', 'ios', 'android'])('v2 command contract does not expose Electron commands on %s', async (name) => {
    platformName.current = name
    const provider = createMockSandboxProvider()
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      agentToolContractVersion: 2,
      sessionSettings: { commandApprovalMode: 'smart', workingDirectories: ['/workspace/project'] },
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      commandExecution: { sessionId: 'session-1', provider },
    })

    expect(result.tools.code_execution).toBeDefined()
    expect(result.tools.run_command).toBeUndefined()
    expect(result.tools.user_exec).toBeUndefined()
    expect(result.instructions).toContain('Host command execution is unavailable')
    expect(result.instructions).not.toContain('Use run_command')
    expect(buildRunCommandToolMock).not.toHaveBeenCalled()
  })

  test('Windows legacy code_execution pauses before unconstrained execution', async () => {
    platformName.current = 'win32'
    const originalExecute = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    buildCodeExecutionToolsMock.mockReturnValue({
      description: 'code execution toolset',
      tools: { code_execution: { execute: originalExecute } },
      ensureSandbox: vi.fn().mockResolvedValue({ success: true }),
    })
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      codeExecution: { sessionId: 'session-1', provider: createMockSandboxProvider(), files: [] },
    })
    if (!result.tools.code_execution.execute) throw new Error('code_execution execute missing')

    await expect(
      result.tools.code_execution.execute({ code: 'console.log(1)', language: 'node' }, {
        toolCallId: 'tool-call-code',
        messages: [],
      } as never)
    ).rejects.toMatchObject({ name: 'UserExecApprovalPausedError', toolCallId: 'tool-call-code' })
    expect(originalExecute).not.toHaveBeenCalled()

    await result.tools.code_execution.execute({ code: 'console.log(1)', language: 'node' }, {
      toolCallId: 'tool-call-code',
      messages: [],
      approved: true,
    } as never)
    expect(originalExecute).toHaveBeenCalledTimes(1)
  })

  test('agentMode="on" keeps Knowledge Base alongside Work Mode tools', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      knowledgeBase: { id: 1, name: 'Product Docs' },
      messages: [],
      agentMode: 'on',
    })

    expect(result.tools.knowledge_base).toBeDefined()
    expect(result.tools.mcp_tool).toBeDefined()
    expect(result.tools.load_skill).toBeDefined()
    expect(result.tools.list_files).toBeDefined()
  })

  test('agentMode="on" proactively injects root AGENTS.md from selected working directories', async () => {
    readWorkspaceInstructionsMock.mockResolvedValue({
      directories: ['/workspace/alpha', 'C:\\workspace\\beta'],
      files: [
        { filePath: '/workspace/alpha/AGENTS.md', content: 'Use pnpm for checks.', truncated: false },
        {
          filePath: 'C:\\workspace\\beta\\AGENTS.md',
          content: 'Keep Windows paths portable.',
          truncated: false,
        },
      ],
      skippedDirectoryCount: 0,
      budgetExhausted: false,
    })

    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: {
        workingDirectories: ['/workspace/alpha/', 'C:\\workspace\\beta', '/workspace/alpha/'],
      },
    })

    expect(result.instructions).toContain('## Workspace Instructions')
    expect(result.instructions).toContain('Chatbox automatically checks each user-selected working directory')
    expect(result.instructions).toContain('check whether a closer AGENTS.md applies')
    expect(result.instructions).toContain('- /workspace/alpha')
    expect(result.instructions).toContain('- C:/workspace/beta')
    expect(result.instructions).toContain('<AGENTS_MD path="/workspace/alpha/AGENTS.md">')
    expect(result.instructions).toContain('Use pnpm for checks.')
    expect(result.instructions).toContain('<AGENTS_MD path="C:/workspace/beta/AGENTS.md">')
    expect(result.instructions).toContain('Keep Windows paths portable.')
    expect(readWorkspaceInstructionsMock).toHaveBeenCalledWith([
      '/workspace/alpha/',
      'C:\\workspace\\beta',
      '/workspace/alpha/',
    ])
  })

  test('reports shared-budget truncation and skipped unsafe directories', async () => {
    readWorkspaceInstructionsMock.mockResolvedValue({
      directories: ['/workspace/large'],
      files: [{ filePath: '/workspace/large/AGENTS.md', content: 'partial instructions', truncated: true }],
      skippedDirectoryCount: 2,
      budgetExhausted: true,
    })

    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { workingDirectories: ['/workspace/large', '/unsafe', '/overflow'] },
    })

    expect(result.instructions).toContain('partial instructions')
    expect(result.instructions).toContain('truncated or omitted to stay within the shared context budget')
    expect(result.instructions).toContain('2 working directories were skipped')
  })

  test('normalizes Windows paths and prefers PowerShell without redundant directory changes', async () => {
    platformName.current = 'win32'
    const model = createMockModel()
    const provider = createMockSandboxProvider()
    vi.mocked(provider.resolveWorkingDirectory).mockResolvedValue('C:\\Users\\themez\\workspace\\chatbox-pro')

    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { workingDirectories: ['D:\\Projects\\shared folder'] },
      codeExecution: {
        sessionId: 'session-1',
        provider,
        files: [],
      },
    })

    expect(result.instructions).toContain('C:/Users/themez/workspace/chatbox-pro')
    expect(result.instructions).toContain('D:/Projects/shared folder')
    expect(result.instructions).not.toContain('C:\\Users\\themez')
    expect(result.instructions).not.toContain('no approval needed')
    expect(result.instructions).toContain('The host validates each binding before use')
    expect(result.instructions).toContain('rejected bindings follow the normal approval flow')
    expect(result.instructions).toContain('Do not prepend `cd <working-directory>`')
    expect(result.instructions).toContain(
      'On Windows, prefer PowerShell for terminal commands and native filesystem paths'
    )
    expect(result.instructions).toContain('do not prepend `Set-Location <working-directory>`')
    expect(result.instructions).toContain('Use Bash only for POSIX-specific scripts')
    expect(result.instructions).toContain('When using Bash on Windows, use Unix shell syntax and forward slashes')
    expect(result.instructions).toContain('For files inside the working directory, prefer relative paths')
    expect(result.instructions).toContain('Use an absolute path when the target is outside the working directory')
    expect(result.instructions).toContain(
      'Git Bash accepts `C:/Users/name/...`, while WSL uses `/mnt/c/Users/name/...`'
    )
    expect(result.instructions).toContain('structured file tools for host paths outside it')
  })

  test('webBrowsing=true exposes parse_link when configured search provider supports it', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: true,
      messages: [],
      agentMode: 'off',
    })

    expect(result.tools.web_search).toBeDefined()
    expect(result.tools.parse_link).toBeDefined()
    expect(result.instructions).toContain('## Tool-use Communication')
    expect(result.instructions).toContain('one short visible sentence')
    expect(result.instructions).toContain("in the user's language")
    expect(result.instructions).toContain('trivial single lookups')
    expect(result.instructions).not.toContain('## parse_link')
    expect(result.instructions).not.toContain('## web_search')
  })

  test('webBrowsing=true does not expose parse_link when configured search provider does not support it', async () => {
    webSearchProvider.current = 'bing'
    const model = createMockModel()

    const result = await buildToolsForSession(model, {
      webBrowsing: true,
      messages: [],
      agentMode: 'off',
    })

    expect(result.tools.web_search).toBeDefined()
    expect(result.tools.parse_link).toBeUndefined()
    expect(result.instructions).not.toContain('## parse_link')
  })

  function commandsOf(tool: ToolSet[string] | undefined) {
    return (tool?.inputSchema as unknown as { jsonSchema: { properties: { command: { enum: string[] } } } }).jsonSchema
      .properties.command.enum
  }

  test('Work Mode offers the built-in browser as one tool without a standing instruction section', async () => {
    builtInBrowser.current = { readPage: vi.fn() }
    const model = createMockModel()

    const result = await buildToolsForSession(model, { webBrowsing: false, messages: [], agentMode: 'on' })

    expect(Object.keys(result.tools).filter((name) => /browse|script|screenshot|browser/.test(name))).toEqual([
      'browser',
    ])
    expect(result.instructions).not.toContain('## Built-in browser')
  })

  test('the built-in-browser skill is listed and loadable only alongside the built-in browser', async () => {
    const model = createMockModel()
    const withoutBrowser = await buildToolsForSession(model, { webBrowsing: false, messages: [], agentMode: 'on' })
    expect(withoutBrowser.instructions).not.toContain('**built-in-browser**')

    builtInBrowser.current = { readPage: vi.fn() }
    const result = await buildToolsForSession(model, { webBrowsing: false, messages: [], agentMode: 'on' })
    expect(result.instructions).toContain('**built-in-browser**')
    const loadSkillTool = result.tools.load_skill
    if (!loadSkillTool?.execute) throw new Error('load_skill execute missing')
    const loaded = await loadSkillTool.execute({ name: 'built-in-browser' }, {} as never)
    expect(loaded).toEqual({ instructions: expect.stringContaining('browser.click(target)') })
    expect(loadSkillMock).not.toHaveBeenCalled()
  })

  test('the screenshot command and its skill section exist only for vision models', async () => {
    builtInBrowser.current = { readPage: vi.fn() }

    const vision = await buildToolsForSession(createMockModel(), { webBrowsing: false, messages: [], agentMode: 'on' })
    expect(commandsOf(vision.tools.browser)).toEqual(['read', 'run', 'screenshot'])
    expect(vision.prepareStepMessages).toBeDefined()
    const visionSkill = await vision.tools.load_skill.execute?.({ name: 'built-in-browser' }, {} as never)
    expect(JSON.stringify(visionSkill)).toContain('## Screenshots')

    const textOnly = createMockModel()
    vi.mocked(textOnly.isSupportVision).mockReturnValue(false)
    const withoutVision = await buildToolsForSession(textOnly, { webBrowsing: false, messages: [], agentMode: 'on' })
    expect(commandsOf(withoutVision.tools.browser)).toEqual(['read', 'run'])
    const textSkill = await withoutVision.tools.load_skill.execute?.({ name: 'built-in-browser' }, {} as never)
    expect(JSON.stringify(textSkill)).not.toContain('Screenshots')
  })

  test('the browser stays off in chat mode and without a built-in browser', async () => {
    const model = createMockModel()
    const withoutBrowser = await buildToolsForSession(model, { webBrowsing: true, messages: [], agentMode: 'on' })
    expect(withoutBrowser.tools.browser).toBeUndefined()
    expect(withoutBrowser.instructions).not.toContain('built-in-browser')

    builtInBrowser.current = { readPage: vi.fn() }
    const chatMode = await buildToolsForSession(model, { webBrowsing: true, messages: [], agentMode: 'off' })
    expect(chatMode.tools.browser).toBeUndefined()
    expect(chatMode.instructions).not.toContain('built-in-browser')
  })

  test('agentMode="on" without codeExecution — load_skill only, no code-exec tools', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      // no codeExecution
    }

    const result = await buildToolsForSession(model, options)

    expect(result.tools.load_skill).toBeDefined()

    // Low-level sandbox_* tools are not exposed; code_execution is the supported sandbox surface.
    for (const name of sandboxToolNames) {
      expect(result.tools[name]).toBeUndefined()
    }

    // But code execution tools are NOT present (no codeExecution option)
    expect(result.tools.code_execution).toBeUndefined()
    expect(result.tools.parse_file).toBeUndefined()
    expect(result.instructions).toContain('## Tool-use Communication')
    expect(buildCodeExecutionToolsMock).not.toHaveBeenCalled()
  })

  test('resets discovered skills cache when skills change', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    }

    getSettingsMock.mockReturnValue({
      skills: { enabledSkillNames: ['test-skill', 'new-skill'] },
    })
    discoverSkillsMock
      .mockResolvedValueOnce([{ name: 'test-skill', description: 'A test skill' }])
      .mockResolvedValueOnce([{ name: 'new-skill', description: 'A newly discovered skill' }])

    const first = await buildToolsForSession(model, options)
    expect(first.instructions).toContain('test-skill')

    const cached = await buildToolsForSession(model, options)
    expect(cached.instructions).toContain('test-skill')
    expect(discoverSkillsMock).toHaveBeenCalledTimes(1)

    for (const listener of skillsChangedListeners) {
      listener()
    }

    const refreshed = await buildToolsForSession(model, options)
    expect(refreshed.instructions).toContain('new-skill')
    expect(discoverSkillsMock).toHaveBeenCalledTimes(2)
  })

  test('agentFullAccess=true skips user_exec approval', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: true },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    const executeResult = await result.tools.user_exec.execute({ command: 'touch /tmp/full-access' }, {
      toolCallId: 'tool-call-1',
      messages: [],
    } as never)

    expect(requestUserExecApprovalMock).not.toHaveBeenCalled()
    expect(userExecMock).toHaveBeenCalledWith('touch /tmp/full-access', {
      sessionId: undefined,
      toolCallId: 'tool-call-1',
      approvalSource: 'full_access',
    })
    expect(executeResult).toMatchObject({ success: true, exitCode: 0, stdout: 'ok', stderr: '' })
    expect(trackAgentModeFullAccessBypassMock).toHaveBeenCalledWith({ tool: 'user_exec' })
  })

  test('agentFullAccess=false requests user_exec approval', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      sessionId: 'session-1',
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: false },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    await result.tools.user_exec.execute({ command: 'touch /tmp/needs-approval' }, {
      toolCallId: 'tool-call-2',
      messages: [],
    } as never)

    expect(requestUserExecApprovalMock).toHaveBeenCalledWith(
      'tool-call-2',
      'touch /tmp/needs-approval',
      expect.any(Object),
      undefined
    )
    expect(userExecMock).toHaveBeenCalledWith('touch /tmp/needs-approval', {
      sessionId: 'session-1',
      toolCallId: 'tool-call-2',
      approvalSource: 'ai',
    })
    expect(trackAgentModeFullAccessBypassMock).not.toHaveBeenCalled()
  })

  test('always_ask pauses legacy user_exec without running smart approval', async () => {
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { commandApprovalMode: 'always_ask', workingDirectories: ['/workspace/project'] },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    await expect(
      result.tools.user_exec.execute({ command: 'pwd' }, { toolCallId: 'tool-call-always', messages: [] } as never)
    ).rejects.toMatchObject({
      name: 'UserExecApprovalPausedError',
      toolCallId: 'tool-call-always',
      workdir: '/workspace/project',
    })
    expect(requestUserExecApprovalMock).not.toHaveBeenCalled()
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('records whitelist auto-approval as the execution source', async () => {
    requestUserExecApprovalMock.mockResolvedValueOnce('whitelist')
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: false },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    await result.tools.user_exec.execute({ command: 'pwd' }, {
      toolCallId: 'tool-call-whitelist',
      messages: [],
    } as never)

    expect(userExecMock).toHaveBeenCalledWith('pwd', {
      sessionId: undefined,
      toolCallId: 'tool-call-whitelist',
      approvalSource: 'whitelist',
    })
  })

  test('records resumed user approval as the execution source', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: false },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    await result.tools.user_exec.execute({ command: 'touch /tmp/user-approved' }, {
      toolCallId: 'tool-call-user-approved',
      messages: [],
      approved: true,
    } as never)

    expect(requestUserExecApprovalMock).not.toHaveBeenCalled()
    expect(userExecMock).toHaveBeenCalledWith('touch /tmp/user-approved', {
      sessionId: undefined,
      toolCallId: 'tool-call-user-approved',
      approvalSource: 'user',
    })
  })

  test('deduplicates repeated user_exec calls with the same toolCallId', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: false },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    const context = { toolCallId: 'tool-call-repeated', messages: [] } as never
    const first = result.tools.user_exec.execute({ command: 'touch /tmp/once' }, context)
    const second = result.tools.user_exec.execute({ command: 'touch /tmp/once' }, context)

    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, exitCode: 0, stdout: 'ok', stderr: '' },
      { success: true, exitCode: 0, stdout: 'ok', stderr: '' },
    ])
    expect(requestUserExecApprovalMock).toHaveBeenCalledTimes(1)
    expect(userExecMock).toHaveBeenCalledTimes(1)
  })

  test('rejects a reused user_exec toolCallId with a different command', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: false },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    const context = { toolCallId: 'tool-call-reused', messages: [] } as never
    await result.tools.user_exec.execute({ command: 'touch /tmp/first' }, context)

    await expect(result.tools.user_exec.execute({ command: 'touch /tmp/second' }, context)).rejects.toThrow(
      'was reused with a different command'
    )
    expect(requestUserExecApprovalMock).toHaveBeenCalledTimes(1)
    expect(userExecMock).toHaveBeenCalledTimes(1)
  })

  test('does not execute user_exec when generation is aborted during approval', async () => {
    let finishApproval: ((approvalSource: 'ai') => void) | undefined
    requestUserExecApprovalMock.mockImplementationOnce(
      () =>
        new Promise<'ai'>((resolve) => {
          finishApproval = resolve
        })
    )
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: false },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    const controller = new AbortController()
    const execution = result.tools.user_exec.execute({ command: 'touch /tmp/aborted' }, {
      toolCallId: 'tool-call-aborted',
      messages: [],
      abortSignal: controller.signal,
    } as never)
    await vi.waitFor(() => expect(requestUserExecApprovalMock).toHaveBeenCalledTimes(1))

    controller.abort()
    finishApproval?.('ai')

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    expect(userExecMock).not.toHaveBeenCalled()
  })

  test('cancels user_exec after host execution has started', async () => {
    let finishExecution:
      | ((result: { success: boolean; exitCode: number; stdout: string; stderr: string; cancelled: boolean }) => void)
      | undefined
    userExecMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishExecution = resolve
        })
    )
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      sessionId: 'session-cancel',
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { agentFullAccess: true },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    const controller = new AbortController()
    const execution = result.tools.user_exec.execute({ command: 'sleep 30' }, {
      toolCallId: 'tool-call-running',
      messages: [],
      abortSignal: controller.signal,
    } as never)
    await vi.waitFor(() => expect(userExecMock).toHaveBeenCalledTimes(1))

    controller.abort()
    expect(cancelUserExecMock).toHaveBeenCalledWith({
      sessionId: 'session-cancel',
      toolCallId: 'tool-call-running',
    })
    finishExecution?.({ success: false, exitCode: 130, stdout: 'partial\n', stderr: '', cancelled: true })

    await expect(execution).resolves.toEqual({
      success: false,
      exitCode: 130,
      stdout: 'partial\n',
      stderr: '',
      cancelled: true,
    })
  })
})

describe('load_skill tool', () => {
  test('calls onAgentModeActivated callback', async () => {
    const model = createMockModel()
    const onAgentModeActivated = vi.fn()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      onAgentModeActivated,
    }

    const result = await buildToolsForSession(model, options)

    // Execute the load_skill tool
    const loadSkillTool = result.tools.load_skill
    expect(loadSkillTool).toBeDefined()
    if (!loadSkillTool.execute) throw new Error('load_skill execute missing')

    const executeResult = await loadSkillTool.execute({ name: 'test-skill' }, {} as never)
    expect(onAgentModeActivated).toHaveBeenCalledTimes(1)
    expect(executeResult).toHaveProperty('instructions', '# Skill instructions')
    expect(executeResult).toHaveProperty('skillRoot', '/mock/builtin-skills/test-skill')
    expect(executeResult).toHaveProperty('files', ['references/checklist.md', 'scripts/validate.mjs'])
  })

  test('returns error for non-enabled skill', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    }

    const result = await buildToolsForSession(model, options)
    const loadSkillTool = result.tools.load_skill
    if (!loadSkillTool.execute) throw new Error('load_skill execute missing')

    const executeResult = await loadSkillTool.execute({ name: 'disabled-skill' }, {} as never)
    expect(executeResult).toHaveProperty('error')
    expect((executeResult as { error: string }).error).toContain('not enabled')
  })

  test('maps loaded instructions to readable model text', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })

    await expect(
      toModelOutput(result.tools.load_skill, {
        instructions: '# Skill instructions',
        skillRoot: '/mock/builtin-skills/test-skill',
        files: ['references/checklist.md'],
      })
    ).resolves.toEqual({
      type: 'text',
      value:
        '# Skill instructions\n\n' +
        'Skill root: /mock/builtin-skills/test-skill\n' +
        'Replace <SKILL_ROOT> with this absolute path when using referenced files.\n\n' +
        'Available skill files:\n- references/checklist.md',
    })
  })

  test('maps empty loaded instructions to an empty-skill result', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })

    await expect(toModelOutput(result.tools.load_skill, { instructions: '' })).resolves.toEqual({
      type: 'text',
      value: 'Skill instructions are empty.',
    })
  })
})

describe('chatbox_cli tool', () => {
  test('uses an OpenAI-compatible top-level function schema', async () => {
    const model = createMockModel()
    getSettingsMock.mockReturnValue({
      skills: { enabledSkillNames: ['chatbox-product-info'] },
    })

    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })
    const inputSchema = result.tools.chatbox_cli.inputSchema as unknown as {
      jsonSchema: Record<string, unknown>
    }

    expect(inputSchema.jsonSchema).toMatchObject({
      type: 'object',
      properties: {
        command: { type: 'string' },
        argv: { type: 'array' },
      },
      additionalProperties: false,
    })
    expect(inputSchema.jsonSchema).not.toHaveProperty('oneOf')
    expect(inputSchema.jsonSchema).not.toHaveProperty('anyOf')
    expect(inputSchema.jsonSchema).not.toHaveProperty('allOf')
  })

  test('is available only when chatbox-product-info is enabled', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    }

    getSettingsMock.mockReturnValueOnce({
      skills: { enabledSkillNames: ['chatbox-product-info'] },
    })
    const enabled = await buildToolsForSession(model, options)
    expect(enabled.tools.chatbox_cli).toBeDefined()

    getSettingsMock.mockReturnValueOnce({
      skills: { enabledSkillNames: ['test-skill'] },
    })
    const disabled = await buildToolsForSession(model, options)
    expect(disabled.tools.chatbox_cli).toBeUndefined()
  })

  test('returns masked license status for CLI-style command', async () => {
    const model = createMockModel()
    const onAgentModeActivated = vi.fn()
    settingsState.licenseKey = 'license-key-secret-1234'
    settingsState.licenseActivationMethod = 'manual'
    settingsState.licensePlanName = 'Chatbox AI Pro'

    getSettingsMock.mockReturnValue({
      skills: { enabledSkillNames: ['chatbox-product-info'] },
    })

    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      onAgentModeActivated,
    })
    if (!result.tools.chatbox_cli.execute) throw new Error('chatbox_cli execute missing')

    const executeResult = await result.tools.chatbox_cli.execute({ command: 'chatbox account status' }, {} as never)

    expect(onAgentModeActivated).toHaveBeenCalledTimes(1)
    expect(executeResult).toMatchObject({
      licenseConfigured: true,
      licenseKey: 'configured (...1234)',
      activationMethod: 'manual',
      plan: { name: 'Chatbox AI Pro' },
    })
    expect(JSON.stringify(executeResult)).not.toContain('license-key-secret-1234')
  })

  test('advertises the structured command hierarchy through capabilities', async () => {
    const model = createMockModel()
    getSettingsMock.mockReturnValue({
      skills: { enabledSkillNames: ['chatbox-product-info'] },
    })

    const result = await buildToolsForSession(model, {
      sessionId: 'session-1',
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })
    if (!result.tools.chatbox_cli.execute) throw new Error('chatbox_cli execute missing')

    const executeResult = await result.tools.chatbox_cli.execute({ argv: ['capabilities'] }, {} as never)
    expect(executeResult).toMatchObject({
      ok: true,
      command: 'capabilities',
      domains: ['account', 'settings', 'chats', 'image'],
    })
  })
})

describe('session attachment RAG tools', () => {
  function retrievalMessage(): Message {
    return {
      id: 'm1',
      role: 'user',
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'What does the uploaded manual say?' }],
      files: [
        {
          id: 'f1',
          name: 'manual.md',
          fileType: 'text/markdown',
          ragMode: 'session-retrieval',
          sessionAttachmentId: 42,
          sessionAttachmentAvailability: 'allowed',
          sessionAttachmentIndexStatus: 'ready',
        },
      ],
    }
  }

  test('adds retrieval tools and instructions for session retrieval attachments', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [retrievalMessage()],
      agentMode: 'off',
    })

    expect(getSessionAttachmentRagToolSetMock).toHaveBeenCalledWith([42])
    expect(result.instructions).toContain('session attachment rag toolset')
    expect(result.tools.query_session_attachment).toBeDefined()
  })

  test('does not add retrieval tools when the model cannot use tools', async () => {
    const model = createMockModel({ isSupportToolUse: vi.fn().mockReturnValue(false) })
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [retrievalMessage()],
      agentMode: 'off',
    })

    expect(getSessionAttachmentRagToolSetMock).not.toHaveBeenCalled()
    expect(result.instructions).not.toContain('session attachment rag toolset')
    expect(result.tools.query_session_attachment).toBeUndefined()
  })
})

describe('install_skill tool', () => {
  test('install_skill is in tools when agentMode="on" AND codeExecution is provided', async () => {
    const model = createMockModel()
    const provider = createMockSandboxProvider()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      codeExecution: {
        sessionId: 'session-1',
        provider,
        files: [],
      },
    }

    const result = await buildToolsForSession(model, options)
    expect(result.tools.install_skill).toBeDefined()
  })

  test('install_skill is NOT in tools when agentMode="off"', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
    }

    const result = await buildToolsForSession(model, options)
    expect(result.tools.install_skill).toBeUndefined()
  })

  test('install_skill is NOT in tools when agentMode="on" but no codeExecution', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      // no codeExecution
    }

    const result = await buildToolsForSession(model, options)
    expect(result.tools.install_skill).toBeUndefined()
  })

  test('maps installed skill result to readable model text', async () => {
    const model = createMockModel()
    const provider = createMockSandboxProvider()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      codeExecution: {
        sessionId: 'session-1',
        provider,
        files: [],
      },
    })

    await expect(
      toModelOutput(result.tools.install_skill, {
        success: true,
        skillName: 'new-skill',
        message: 'Skill "new-skill" installed and enabled.',
      })
    ).resolves.toEqual({
      type: 'text',
      value: 'Status: success\nMessage: Skill "new-skill" installed and enabled.',
    })
  })

  test('maps empty install message to a completed-install result', async () => {
    const model = createMockModel()
    const provider = createMockSandboxProvider()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      codeExecution: {
        sessionId: 'session-1',
        provider,
        files: [],
      },
    })

    await expect(toModelOutput(result.tools.install_skill, { message: '' })).resolves.toEqual({
      type: 'text',
      value: 'Skill installation completed.',
    })
  })
})

describe('user_exec tool', () => {
  test('user_exec is in tools when agentMode="on"', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    }
    const result = await buildToolsForSession(model, options)
    expect(result.tools.user_exec).toBeDefined()
  })

  test('user_exec is NOT in tools when agentMode="off"', async () => {
    const model = createMockModel()
    const options: BuildToolsOptions = {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
    }
    const result = await buildToolsForSession(model, options)
    expect(result.tools.user_exec).toBeUndefined()
  })

  test('user_exec is available in on mode without requiring a loaded skill', async () => {
    getSettingsMock.mockReturnValue({ skills: { enabledSkillNames: [] } })
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })

    expect(result.tools.user_exec).toBeDefined()
    expect(result.instructions).toContain('It is not limited to skill-driven tasks')
    expect(result.instructions).toContain('subject to the host approval policy')
  })

  test('uses the first granted directory as cwd and describes the platform shell', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: {
        agentFullAccess: true,
        workingDirectories: ['C:\\Users\\themez\\workspace\\chatbox-pro', 'D:\\other'],
      },
    })
    if (!result.tools.user_exec.execute) throw new Error('user_exec execute missing')

    expect(result.instructions).toContain('On Windows, user_exec runs PowerShell commands')
    expect(result.instructions).toContain('instead of Bash-only operators such as &&')
    expect(result.instructions).toContain('user_exec already starts in the first user-granted working directory')
    await result.tools.user_exec.execute({ command: 'git status' }, {
      toolCallId: 'tool-call-windows-cwd',
      messages: [],
    } as never)

    expect(userExecMock).toHaveBeenCalledWith('git status', {
      cwd: 'C:\\Users\\themez\\workspace\\chatbox-pro',
      sessionId: undefined,
      toolCallId: 'tool-call-windows-cwd',
      approvalSource: 'full_access',
    })
  })

  test('maps command results to readable model text', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })

    await expect(
      toModelOutput(result.tools.user_exec, { success: true, exitCode: 0, stdout: 'ok\n', stderr: '' })
    ).resolves.toEqual({
      type: 'text',
      value: 'Exit code: 0\n\nStdout:\nok\n',
    })
  })

  test('exposes retained legacy command output captures to the model', async () => {
    const result = await buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })

    await expect(
      toModelOutput(result.tools.user_exec, {
        success: true,
        exitCode: 0,
        stdout: 'preview',
        stderr: '',
        outputFile: '/tmp/chatbox-command-output/capture.txt',
      })
    ).resolves.toEqual({
      type: 'text',
      value: 'Exit code: 0\n\nStdout:\npreview\n\nOutput capture: /tmp/chatbox-command-output/capture.txt',
    })
  })

  test('maps command success with no output to an explicit no-output result', async () => {
    const model = createMockModel()
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })

    await expect(
      toModelOutput(result.tools.user_exec, { success: true, exitCode: 0, stdout: '', stderr: '' })
    ).resolves.toEqual({
      type: 'text',
      value: 'Exit code: 0\n\n(no output)',
    })
  })
})

describe('buildToolsForSession — view_image gating', () => {
  test('registers view_image for vision models on media-capable protocols in agent mode', async () => {
    const model = createMockModel({ apiStyle: 'anthropic' } as Partial<ModelInterface>)
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })
    expect(result.tools.view_image).toBeDefined()
    expect(result.instructions).toContain('view_image')
  })

  test('registers view_image with user-message injection for chat-completions style providers', async () => {
    const model = createMockModel({ apiStyle: 'openai' } as Partial<ModelInterface>)
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })
    // Chat-completions protocols cannot embed images in tool results, so the image is
    // delivered via the prepareStep messages rewrite instead of being dropped.
    expect(result.tools.view_image).toBeDefined()
    expect(result.prepareStepMessages).toBeDefined()
  })

  test('media-capable protocols use the step-message rewrite to bound image replay', async () => {
    const model = createMockModel({ apiStyle: 'anthropic' } as Partial<ModelInterface>)
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })
    expect(result.tools.view_image).toBeDefined()
    expect(result.prepareStepMessages).toBeDefined()
  })

  test('omits view_image without vision support', async () => {
    const model = createMockModel({
      apiStyle: 'anthropic',
      isSupportVision: vi.fn().mockReturnValue(false),
    } as Partial<ModelInterface>)
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
    })
    expect(result.tools.view_image).toBeUndefined()
  })

  test('omits view_image outside agent mode', async () => {
    const model = createMockModel({ apiStyle: 'anthropic' } as Partial<ModelInterface>)
    const result = await buildToolsForSession(model, {
      webBrowsing: false,
      messages: [],
      agentMode: 'off',
    })
    expect(result.tools.view_image).toBeUndefined()
  })
})

test('registers file tools from branch history after prompt compaction', async () => {
  const result = await buildToolsForSession(createMockModel(), {
    webBrowsing: false,
    agentMode: 'off',
    messages: [
      { id: 'summary', role: 'user', contentParts: [{ type: 'text', text: 'Continue reading the uploaded report.' }] },
    ],
    fileMessages: [
      {
        id: 'original',
        role: 'user',
        contentParts: [],
        files: [{ id: 'report', name: 'report.txt', fileType: 'text/plain', storageKey: 'report' }],
      },
    ],
  })
  expect(result.tools.read_file).toBeDefined()
  expect(result.instructions).toContain('file toolset')
  expect(buildFileToolsMock.mock.lastCall?.[0]).toEqual([
    expect.objectContaining({ id: 'original', files: expect.any(Array) }),
  ])
})

test('keeps the virtual reader available for compacted resource lookups', async () => {
  const loadFileMessages = vi.fn(async () => [])
  const result = await buildToolsForSession(createMockModel(), {
    webBrowsing: false,
    agentMode: 'off',
    messages: [],
    loadFileMessages,
  })
  expect(result.tools.read_file).toBeDefined()
  expect(buildFileToolsMock.mock.lastCall?.[2]).toBe(loadFileMessages)
  expect(loadFileMessages).not.toHaveBeenCalled()
})

describe('buildToolsForSession script tool and sandbox guidance', () => {
  const buildAgentTools = (overrides: Partial<BuildToolsOptions>) =>
    buildToolsForSession(createMockModel(), {
      webBrowsing: false,
      messages: [],
      agentMode: 'on',
      sessionSettings: { commandApprovalMode: 'smart' },
      ...overrides,
    })

  test.each([
    { name: 'v2 desktop', platform: 'darwin', version: 2, commandExecution: true, scriptTool: 'run_command' },
    { name: 'v1 desktop', platform: 'darwin', version: 1, commandExecution: true, scriptTool: 'code_execution' },
    { name: 'v2 HarmonyOS', platform: 'harmony', version: 2, commandExecution: true, scriptTool: 'code_execution' },
    {
      name: 'v2 desktop without commandExecution',
      platform: 'darwin',
      version: 2,
      commandExecution: false,
      scriptTool: 'code_execution',
    },
  ] as const)('$name names the registered script tool', async ({ platform, version, commandExecution, scriptTool }) => {
    platformName.current = platform
    const provider = { ...createMockSandboxProvider(), type: 'local' } as SandboxProvider
    const result = await buildAgentTools({
      agentToolContractVersion: version,
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      ...(commandExecution ? { commandExecution: { sessionId: 'session-1', provider } } : {}),
    })

    expect(buildCodeExecutionToolsMock).toHaveBeenCalledWith(expect.objectContaining({ scriptTool }))
    expect(result.tools.view_image.description).toContain('Relative paths resolve in the session sandbox')
    if (version === 1) expect(result.tools.user_exec.description).toContain('Prefer code_execution (sandbox)')
    if (scriptTool === 'run_command') {
      expect(result.tools.run_command).toBeDefined()
      expect(result.tools.code_execution).toBeUndefined()
    } else {
      expect(result.tools.code_execution).toBeDefined()
      expect(result.tools.run_command).toBeUndefined()
    }
  })

  test.each([1, 2] as const)('v%s without a sandbox omits skill installation steps', async (version) => {
    const result = await buildAgentTools({
      agentToolContractVersion: version,
      commandExecution: { sessionId: 'session-1' },
    })

    expect(result.tools.install_skill).toBeUndefined()
    expect(result.instructions).toContain('Installing skills requires the session sandbox')
    expect(result.instructions).not.toContain('call install_skill')
    expect(result.instructions).not.toContain('Call install_skill')
    expect(result.instructions).not.toContain('Prefer code_execution (sandbox)')
    if (version === 1) expect(result.tools.user_exec.description).not.toContain('code_execution')
    expect(result.tools.view_image.description).toContain('Use absolute paths')
    expect(result.tools.view_image.description).not.toContain('Relative paths resolve')
  })

  test.each([
    { platform: 'darwin', windows: false, bashHome: true },
    { platform: 'win32', windows: true, bashHome: true },
    { platform: 'harmony', windows: false, bashHome: false },
  ])('working-directory guidance on $platform covers only its shells', async ({ platform, windows, bashHome }) => {
    platformName.current = platform
    const provider = createMockSandboxProvider()
    const result = await buildAgentTools({
      agentToolContractVersion: platform === 'harmony' ? 2 : 1,
      codeExecution: { sessionId: 'session-1', provider, files: [] },
      commandExecution: { sessionId: 'session-1', provider },
    })

    expect(result.instructions.includes('On Windows, prefer PowerShell')).toBe(windows)
    expect(result.instructions.includes('In Bash, `~` and `$HOME` point to the working directory')).toBe(bashHome)
  })
})

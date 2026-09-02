import { beforeEach, describe, expect, test, vi } from 'vitest'

const { discoverSkillsMock, getSettingsMock, mcpToolsMock, sandboxProviderMock, skillsChangedListeners } = vi.hoisted(
  () => ({
    discoverSkillsMock: vi.fn(),
    getSettingsMock: vi.fn(),
    mcpToolsMock: vi.fn(),
    sandboxProviderMock: {
      type: 'local',
      init: vi.fn(),
      exec: vi.fn(),
      copyBlobIn: vi.fn(),
      checkAvailability: vi.fn(),
      resolveWorkingDirectory: vi.fn(async () => null),
      setExtraWritableDirs: vi.fn(),
      destroy: vi.fn(),
    },
    skillsChangedListeners: new Set<() => void>(),
  })
)

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
    getPlatform: vi.fn().mockResolvedValue('darwin'),
    getVersion: vi.fn().mockResolvedValue('test-version'),
  },
}))

vi.mock('@/storage', () => {
  // In-memory store: agentPersonaStore reads soul/memories through it when
  // capturing the agent persona snapshot.
  const values = new Map<string, unknown>()
  return {
    default: {
      getBlob: vi.fn().mockResolvedValue(null),
      setBlob: vi.fn().mockResolvedValue(undefined),
      getItem: vi.fn((key: string, initialValue: unknown) => Promise.resolve(values.get(key) ?? initialValue)),
      setItem: vi.fn((key: string, value: unknown) => {
        values.set(key, value)
        return Promise.resolve()
      }),
      setItemNow: vi.fn((key: string, value: unknown) => {
        values.set(key, value)
        return Promise.resolve()
      }),
    },
    StorageKey: { MyCopilots: 'myCopilots' },
  }
})

vi.mock('@/sandbox', () => ({
  createSandboxProvider: () => sandboxProviderMock,
}))

vi.mock('@/packages/mcp/controller', () => ({
  mcpController: {
    getAvailableTools: mcpToolsMock,
  },
}))

vi.mock('@/packages/skills/controller', () => ({
  subscribeSkillsChanged: (listener: () => void) => {
    skillsChangedListeners.add(listener)
    return () => skillsChangedListeners.delete(listener)
  },
  skillsController: {
    discoverSkills: discoverSkillsMock,
    loadSkill: vi.fn().mockResolvedValue({ metadata: {}, body: '# Skill instructions' }),
    installFromSandbox: vi.fn(),
  },
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: getSettingsMock,
    }),
    setState: vi.fn(),
  },
}))

vi.mock('@/stores/settingActions', () => ({
  getExtensionSettings: () => ({
    webSearch: { provider: 'tavily' },
  }),
  getRemoteConfig: vi.fn().mockResolvedValue({}),
  isPro: () => true,
}))

vi.mock('@/packages/user-exec-approval', () => ({
  requestUserExecApproval: vi.fn(),
}))

import { convertToOpenAICompatibleChatMessages } from '@ai-sdk/openai-compatible/internal'
import type { ModelInterface } from '@shared/models/types'
import { sandboxAttachmentRelPath } from '@shared/sandbox/attachment-path'
import type { SandboxProvider } from '@shared/sandbox-provider'
import {
  type Config,
  type Message,
  MessageRoleEnum,
  ModelProviderEnum,
  type Session,
  type SessionSettings,
  type Settings,
} from '@shared/types'
import type { ModelDependencies } from '@shared/types/adapters'
import { getMessageText } from '@shared/utils/message'
import { formatTimestampWithZone, TIME_REMINDER_MIN_GAP_MS } from '@shared/utils/system-reminder'
import type { ModelMessage } from 'ai'
import { convertToLanguageModelPrompt, standardizePrompt } from 'ai/internal'
import { addOrUpdateMyCopilot, disableCopilotMemory, enableCopilotMemory, removeMyCopilot } from '@/stores/copilotStore'
import { computeEffectiveAgentMode, prepareAgentGenerationHarness } from './agent-harness'

function createMockModel(overrides?: Partial<ModelInterface>): ModelInterface {
  return {
    name: 'Test Model',
    modelId: 'test-model',
    isSupportToolUse: vi.fn().mockReturnValue(true),
    isSupportVision: vi.fn().mockReturnValue(true),
    isSupportSystemMessage: vi.fn().mockReturnValue(true),
    chat: vi.fn(),
    chatStream: vi.fn(),
    paint: vi.fn(),
    ...overrides,
  } as unknown as ModelInterface
}

function createModelDependencies(): ModelDependencies {
  return {
    request: {
      apiRequest: vi.fn(),
      fetchWithOptions: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn(),
    },
    getRemoteConfig: vi.fn(),
  }
}

function createSession(copilotId?: string): Session {
  return {
    id: 'session-1',
    name: 'Session',
    type: 'chat',
    messages: [],
    threads: [],
    messageForksHash: {},
    ...(copilotId ? { copilotId } : {}),
  } as unknown as Session
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const listener of skillsChangedListeners) {
    listener()
  }
  sandboxProviderMock.type = 'local'
  sandboxProviderMock.checkAvailability.mockResolvedValue({ available: true })
  sandboxProviderMock.init.mockResolvedValue({ success: true })
  sandboxProviderMock.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  sandboxProviderMock.copyBlobIn.mockResolvedValue({ success: true })
  mcpToolsMock.mockReturnValue({})
  discoverSkillsMock.mockResolvedValue([{ name: 'analysis', description: 'Analyze files' }])
  getSettingsMock.mockReturnValue({
    skills: { enabledSkillNames: ['analysis'] },
  })
})

/** Runs the same prompt conversion `streamText` performs before a provider call. */
async function toUpstreamMessages(coreMessages: ModelMessage[]) {
  const prompt = await convertToLanguageModelPrompt({
    prompt: await standardizePrompt({ messages: coreMessages }),
    supportedUrls: {},
    download: undefined,
  })
  return convertToOpenAICompatibleChatMessages(prompt)
}

describe('computeEffectiveAgentMode', () => {
  test('off when the platform does not support agent mode', () => {
    expect(computeEffectiveAgentMode('on', false)).toBe('off')
    expect(computeEffectiveAgentMode('auto', false)).toBe('off')
    expect(computeEffectiveAgentMode('off', false)).toBe('off')
  })

  test('on only when explicitly on and supported', () => {
    expect(computeEffectiveAgentMode('on', true)).toBe('on')
  })

  test('treats auto and off as off when supported (auto only triggers the suggestion)', () => {
    expect(computeEffectiveAgentMode('auto', true)).toBe('off')
    expect(computeEffectiveAgentMode('off', true)).toBe('off')
  })
})

describe('prepareAgentGenerationHarness', () => {
  test('prepares the real context, system prompt, tools, and sandbox gating for an uploaded file', async () => {
    const userMessage: Message = {
      id: 'msg-1',
      role: MessageRoleEnum.User,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'Analyze this spreadsheet and create an HTML report.' }],
      files: [
        {
          id: 'file-1',
          name: 'sales.xlsx',
          storageKey: 'parsed-sales',
          rawStorageKey: 'raw-sales',
          byteLength: 2048,
          parserType: 'sandbox-raw',
        },
      ],
    } as unknown as Message

    const lockAgentMode = vi.fn()
    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'on',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
      sideEffects: {
        lockAgentMode,
      },
    })

    expect(lockAgentMode).toHaveBeenCalledWith('message_sent')
    expect(sandboxProviderMock.checkAvailability).toHaveBeenCalled()
    expect(prepared.debug.effectiveAgentMode).toBe('on')
    expect(prepared.debug.canExecuteCode).toBe(true)
    expect(prepared.debug.instructions).toContain('## Response Language')
    expect(prepared.debug.instructions).toContain("same language as the user's latest message")

    expect(prepared.tools.run_command).toBeDefined()
    expect(prepared.tools.code_execution).toBeUndefined()
    expect(prepared.tools.read_file).toBeDefined()
    expect(prepared.tools.write_file).toBeDefined()
    expect(prepared.tools.load_skill).toBeDefined()
    expect(prepared.tools.install_skill).toBeDefined()

    const lastPromptMessage = prepared.promptMsgs.at(-1)
    expect(lastPromptMessage).toBeDefined()
    const promptText = lastPromptMessage ? getMessageText(lastPromptMessage, true, false) : ''
    expect(promptText).toContain('<ATTACHMENT_FILE>')
    expect(promptText).toContain('<SANDBOX_MODE>true</SANDBOX_MODE>')
    expect(promptText).toContain(`<SANDBOX_PATH>${sandboxAttachmentRelPath('sales.xlsx', 'raw-sales')}</SANDBOX_PATH>`)
    expect(promptText).not.toContain('ATTACHED_FILES')

    const serializedCoreMessages = JSON.stringify(prepared.coreMessages)
    expect(serializedCoreMessages).toContain('Current model: test-model')
    expect(serializedCoreMessages).toContain('## Response Language')
    expect(serializedCoreMessages).toContain("same language as the user's latest message")
    expect(serializedCoreMessages).toContain('run_command')
    expect(serializedCoreMessages).toContain('Available Skills')
    expect(prepared.systemPrompt).toContain('Current model: test-model')
    expect(prepared.systemPrompt).toContain('## Response Language')

    expect(prepared.chatOptions.tools).toBe(prepared.tools)
    expect(prepared.chatOptions.agentMode).toBe(true)
    expect(prepared.chatOptions.prepareStep).toBeUndefined()
  })

  test('keeps legacy auto mode on the plain chat path when there are no files', async () => {
    const userMessage: Message = {
      id: 'msg-1',
      role: MessageRoleEnum.User,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'Make a small HTML demo.' }],
    }

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'auto',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    expect(prepared.debug.effectiveAgentMode).toBe('off')
    expect(prepared.chatOptions.agentMode).toBe(false)
    expect(prepared.tools.code_execution).toBeUndefined()
    expect(prepared.tools.load_skill).toBeUndefined()
    // Memory tools are mode-independent: chat mode can save/recall too.
    expect(prepared.tools.save_memory).toBeDefined()
    expect(prepared.chatOptions.prepareStep).toBeUndefined()

    const serializedCoreMessages = JSON.stringify(prepared.coreMessages)
    expect(serializedCoreMessages).not.toContain('SANDBOX_MODE')
  })

  test('keeps legacy auto mode on the plain chat path for a single simple file', async () => {
    const userMessage: Message = {
      id: 'msg-1',
      role: MessageRoleEnum.User,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'Summarize this note.' }],
      files: [
        {
          id: 'file-1',
          name: 'note.txt',
          fileType: 'text/plain',
          storageKey: 'note-key',
        },
      ],
    } as Message

    const lockAgentMode = vi.fn()
    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'auto',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
      sideEffects: {
        lockAgentMode,
      },
    })

    expect(lockAgentMode).not.toHaveBeenCalled()
    expect(prepared.debug.effectiveAgentMode).toBe('off')
    expect(prepared.tools.code_execution).toBeUndefined()
    expect(prepared.chatOptions.prepareStep).toBeUndefined()
  })

  test('flattens historical tool calls to text when the request registers no tools', async () => {
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: MessageRoleEnum.User,
        timestamp: Date.now(),
        contentParts: [{ type: 'text', text: 'Search for the latest release notes.' }],
      },
      {
        id: 'msg-2',
        role: MessageRoleEnum.Assistant,
        timestamp: Date.now(),
        contentParts: [
          { type: 'text', text: 'Looking it up.' },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tc-1',
            toolName: 'web_search',
            args: { query: 'release notes' },
            result: { hits: ['v2 changelog'] },
          },
        ],
      },
      {
        id: 'msg-3',
        role: MessageRoleEnum.User,
        timestamp: Date.now(),
        contentParts: [{ type: 'text', text: 'Now answer without tools.' }],
      },
    ] as Message[]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: 3,
      model: createMockModel({ isSupportToolUse: vi.fn().mockReturnValue(false) } as Partial<ModelInterface>),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: false,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    // No tools registered for this request: the wire must not carry tool blocks.
    expect(prepared.chatOptions.tools).toBeUndefined()
    const assistantMessage = prepared.promptMsgs.find((message) => message.id === 'msg-2')
    expect(assistantMessage?.contentParts.some((part) => part.type === 'tool-call')).toBe(false)
    const flattened = assistantMessage?.contentParts.find(
      (part) => part.type === 'text' && part.text.includes('[tool web_search]')
    )
    expect(flattened).toBeDefined()
    const serializedCoreMessages = JSON.stringify(prepared.coreMessages)
    expect(serializedCoreMessages).not.toContain('"tool-call"')
    expect(serializedCoreMessages).toContain('v2 changelog')
  })

  test('keeps instructions ahead of the first user turn for models without system support', async () => {
    const systemMessage: Message = {
      id: 'msg-sys',
      role: MessageRoleEnum.System,
      timestamp: 1,
      contentParts: [{ type: 'text', text: 'HOUSE_RULES_PROMPT' }],
    }
    const userMessage: Message = {
      id: 'msg-1',
      role: MessageRoleEnum.User,
      timestamp: 2,
      contentParts: [{ type: 'text', text: 'USER_QUESTION_TEXT' }],
    }

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [systemMessage, userMessage],
      targetMsgIx: 2,
      model: createMockModel({ isSupportSystemMessage: vi.fn().mockReturnValue(false) } as Partial<ModelInterface>),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    // The injected block rides the (coerced) system message, so after the
    // user-role merge the order is: session prompt → instructions/runtime →
    // user request. Injecting into the user message itself would flip the
    // instructions behind the request.
    expect(prepared.coreMessages.map((message) => message.role)).not.toContain('system')
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized.indexOf('HOUSE_RULES_PROMPT')).toBeGreaterThanOrEqual(0)
    expect(serialized.indexOf('HOUSE_RULES_PROMPT')).toBeLessThan(serialized.indexOf('## Runtime'))
    expect(serialized.indexOf('## Runtime')).toBeLessThan(serialized.indexOf('USER_QUESTION_TEXT'))
  })

  test('injects no time reminder during a rapid exchange', async () => {
    const userMessage: Message = {
      id: 'msg-1',
      role: MessageRoleEnum.User,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'USER_QUESTION_TEXT' }],
    }

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    // No gap since the conversation start: reminding on every message would be
    // noise, so the request carries none. The system prompt still documents the
    // <system-reminder> contract for when one does appear.
    expect(JSON.stringify(prepared.coreMessages)).not.toContain('Current date and time:')
    expect(prepared.systemPrompt).toContain('<system-reminder>')
  })

  test('injects a deterministic time reminder after a conversation gap', async () => {
    const now = Date.now()
    const firstTs = now - 45 * 60 * 1000
    const latestTs = now - 60 * 1000
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: MessageRoleEnum.User,
        timestamp: firstTs,
        contentParts: [{ type: 'text', text: 'EARLIER_QUESTION' }],
      },
      {
        id: 'msg-2',
        role: MessageRoleEnum.Assistant,
        timestamp: firstTs + 60 * 1000,
        contentParts: [{ type: 'text', text: 'EARLIER_ANSWER' }],
      },
      {
        id: 'msg-3',
        role: MessageRoleEnum.User,
        timestamp: latestTs,
        contentParts: [{ type: 'text', text: 'USER_QUESTION_TEXT' }],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: 3,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    // The reminder rides the gapped user turn's tail and freezes that message's
    // own timestamp (not the build-time clock), so every rebuild reproduces the
    // same bytes at the same position — it joins the stable cached prefix.
    const lastMessage = prepared.coreMessages.at(-1)
    expect(lastMessage?.role).toBe('user')
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized.indexOf('USER_QUESTION_TEXT')).toBeLessThan(serialized.indexOf('Current date and time:'))
    expect(serialized).toContain(`Current date and time: ${formatTimestampWithZone(latestTs)}`)

    // Never persisted: the reminder exists only in the converted request, not
    // in the prompt messages that flow back to storage-facing paths.
    expect(JSON.stringify(prepared.promptMsgs)).not.toContain('Current date and time:')
  })

  test('keeps a historical gap reminder in place once the conversation moves on', async () => {
    const now = Date.now()
    const gapTs = now - 3 * 60 * 1000
    const messages: Message[] = [
      {
        id: 'msg-1',
        role: MessageRoleEnum.User,
        timestamp: now - 50 * 60 * 1000,
        contentParts: [{ type: 'text', text: 'EARLIER_QUESTION' }],
      },
      {
        id: 'msg-2',
        role: MessageRoleEnum.Assistant,
        timestamp: now - 49 * 60 * 1000,
        contentParts: [{ type: 'text', text: 'EARLIER_ANSWER' }],
      },
      {
        id: 'msg-3',
        role: MessageRoleEnum.User,
        timestamp: gapTs,
        contentParts: [{ type: 'text', text: 'RETURNING_QUESTION' }],
      },
      {
        id: 'msg-4',
        role: MessageRoleEnum.Assistant,
        timestamp: gapTs + 30 * 1000,
        contentParts: [{ type: 'text', text: 'RETURNING_ANSWER' }],
      },
      {
        id: 'msg-5',
        role: MessageRoleEnum.User,
        timestamp: now - 60 * 1000,
        contentParts: [{ type: 'text', text: 'FOLLOW_UP_QUESTION' }],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: 5,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    // The gap reminder re-materializes at the same historical position on every
    // rebuild (msg-3's turn, before the assistant reply), so the bytes ahead of
    // the newest turn stay prefix-cache stable; the rapid follow-up adds none.
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized.split('Current date and time:')).toHaveLength(2)
    const reminderIndex = serialized.indexOf(`Current date and time: ${formatTimestampWithZone(gapTs)}`)
    expect(reminderIndex).toBeGreaterThan(serialized.indexOf('RETURNING_QUESTION'))
    expect(reminderIndex).toBeLessThan(serialized.indexOf('RETURNING_ANSWER'))
  })

  test('keeps the toolset and context clean when agent mode is manually off', async () => {
    const userMessage: Message = {
      id: 'msg-1',
      role: MessageRoleEnum.User,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'Answer normally.' }],
    }

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    expect(prepared.debug.effectiveAgentMode).toBe('off')
    expect(prepared.debug.canExecuteCode).toBe(false)
    expect(prepared.tools.code_execution).toBeUndefined()
    expect(prepared.tools.read_file).toBeUndefined()
    // Only the mode-independent memory tools remain in chat mode.
    expect(prepared.tools.save_memory).toBeDefined()
    expect(prepared.tools.delete_memory).toBeDefined()
    expect(JSON.stringify(prepared.coreMessages)).not.toContain('SANDBOX_MODE')
  })

  test('disables chatbox_cli while a resumed image task waits for its callback', async () => {
    discoverSkillsMock.mockResolvedValue([
      { name: 'chatbox-product-info', description: 'Operate Chatbox product features' },
    ])
    getSettingsMock.mockReturnValue({
      skills: { enabledSkillNames: ['chatbox-product-info'] },
    })
    const messages: Message[] = [
      {
        id: 'user-1',
        role: MessageRoleEnum.User,
        contentParts: [{ type: 'text', text: 'Generate a red fox image.' }],
      },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'chatbox_cli',
            args: { argv: ['image', 'generate', '--prompt', 'red fox'] },
            result: {
              ok: true,
              command: 'image generate',
              accepted: true,
              background: true,
              recordId: 'record-1',
              status: 'pending',
              startedAt: 1_000,
              wait: { mode: 'callback', managedBy: 'chatbox', modelShouldPoll: false, pollIntervalMs: 2_000 },
            },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel(),
      dependencies: {} as never,
      webBrowsing: false,
      agentModeValue: 'on',
      agentModeLocked: true,
      agentModeSupported: true,
      signal: new AbortController().signal,
      preserveLastPromptMessageToolCalls: true,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    expect(prepared.tools.chatbox_cli).toBeDefined()
    expect(prepared.chatOptions.prepareStep).toBeDefined()
    const stepSettings = await prepared.chatOptions.prepareStep?.({ steps: [] } as never)
    expect(stepSettings?.activeTools).not.toContain('chatbox_cli')
  })

  test('keeps a still-generating resumed message with its tool calls in the model context', async () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: MessageRoleEnum.User,
        contentParts: [{ type: 'text', text: 'Count from 1 to 30 with one tool call each.' }],
      },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        // A paused-tool-call continuation hands off to the follow-up generation while
        // the message is still flagged generating; its tool results must stay in context.
        generating: true,
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-26',
            toolName: 'code_execution',
            args: { code: 'console.log(26)' },
            result: { stdout: '26' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel(),
      dependencies: {} as never,
      webBrowsing: false,
      agentModeValue: 'on',
      agentModeLocked: true,
      agentModeSupported: true,
      signal: new AbortController().signal,
      preserveLastPromptMessageToolCalls: true,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    expect(prepared.promptMsgs.some((message) => message.id === 'assistant-1')).toBe(true)
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('tool-26')
    expect(serialized).toContain('console.log(26)')
    expect(prepared.tools.code_execution).toBeDefined()
    expect(prepared.tools.run_command).toBeUndefined()

    // A fresh continuation (snapshot just captured, no conversation gap) does
    // not need a time reminder.
    expect(serialized).not.toContain('Current date and time:')
  })

  test('appends a live trailing reminder when resuming a stale tool run', async () => {
    const capturedAt = Date.now() - 2 * TIME_REMINDER_MIN_GAP_MS
    const messages: Message[] = [
      {
        id: 'user-1',
        role: MessageRoleEnum.User,
        timestamp: capturedAt + 60_000,
        contentParts: [{ type: 'text', text: 'Count from 1 to 30 with one tool call each.' }],
      },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        timestamp: capturedAt + 120_000,
        generating: true,
        contentParts: [
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-26',
            toolName: 'code_execution',
            args: { code: 'console.log(26)' },
            result: { stdout: '26' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: '',
          memories: [],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt,
          scope: 'agent',
        },
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel(),
      dependencies: {} as never,
      webBrowsing: false,
      agentModeValue: 'on',
      agentModeLocked: true,
      agentModeSupported: true,
      signal: new AbortController().signal,
      preserveLastPromptMessageToolCalls: true,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    // The wall clock outran everything in the context (e.g. a tool approval
    // granted much later), and no new user message exists to carry the gap: the
    // live reminder stays its own trailing user turn after the tool results
    // (the PR-729-verified wire shape).
    const lastMessage = prepared.coreMessages.at(-1)
    expect(lastMessage?.role).toBe('user')
    expect(JSON.stringify(lastMessage)).toContain('Current date and time:')
    expect(JSON.stringify(prepared.promptMsgs)).not.toContain('Current date and time:')
  })

  test.each([
    { provider: 'opencode-go', modelId: 'deepseek-v4-pro' },
    { provider: ModelProviderEnum.SiliconFlow, modelId: 'deepseek-ai/DeepSeek-R1' },
    { provider: ModelProviderEnum.VolcEngine, modelId: 'deepseek-r1-250528' },
  ])('passes prior DeepSeek reasoning back as reasoning_content through $provider', async ({ provider, modelId }) => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: MessageRoleEnum.User,
        contentParts: [{ type: 'text', text: 'Solve this carefully.' }],
      },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          { type: 'reasoning', text: 'Prior private reasoning' },
          { type: 'text', text: 'Prior answer' },
        ],
      },
      {
        id: 'user-2',
        role: MessageRoleEnum.User,
        contentParts: [{ type: 'text', text: 'Continue.' }],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider, modelId } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId, apiStyle: 'openai' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    const upstreamMessages = await toUpstreamMessages(prepared.coreMessages)
    expect(upstreamMessages.find((message) => message.role === 'assistant')).toEqual({
      role: 'assistant',
      content: 'Prior answer',
      reasoning_content: 'Prior private reasoning',
    })
  })

  test.each(['grok-4', 'mistral-large-latest', 'gemini-2.5-pro'])(
    'does not pass prior reasoning to an unrelated OpenAI-compatible %s model',
    async (modelId) => {
      const messages: Message[] = [
        {
          id: 'user-1',
          role: MessageRoleEnum.User,
          contentParts: [{ type: 'text', text: 'Question' }],
        },
        {
          id: 'assistant-1',
          role: MessageRoleEnum.Assistant,
          contentParts: [
            { type: 'reasoning', text: 'Must stay local' },
            { type: 'text', text: 'Answer' },
          ],
        },
        {
          id: 'user-2',
          role: MessageRoleEnum.User,
          contentParts: [{ type: 'text', text: 'Continue' }],
        },
      ]

      const prepared = await prepareAgentGenerationHarness({
        session: createSession(),
        settings: { provider: 'custom-openai', modelId } as SessionSettings,
        globalSettings: {} as Settings,
        configs: { uuid: 'config-1' } as Config,
        messages,
        targetMsgIx: messages.length,
        model: createMockModel({ modelId, apiStyle: 'openai' }),
        dependencies: createModelDependencies(),
        webBrowsing: false,
        agentModeValue: 'off',
        agentModeLocked: false,
        agentModeSupported: true,
        signal: new AbortController().signal,
      })

      const upstreamMessages = await toUpstreamMessages(prepared.coreMessages)
      expect(upstreamMessages.find((message) => message.role === 'assistant')).toEqual({
        role: 'assistant',
        content: 'Answer',
      })
    }
  )

  test('replays signed Anthropic thinking on every assistant turn', async () => {
    const signedParts = (signature: string): Message['contentParts'] => [
      {
        type: 'reasoning',
        text: 'Let me look that up.',
        providerMetadata: { anthropic: { signature } },
      },
      {
        type: 'tool-call',
        state: 'result',
        toolCallId: `tool-${signature}`,
        toolName: 'lookup',
        args: {},
        result: { value: 'found' },
      },
    ]
    const messages: Message[] = [
      { id: 'user-1', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'First question' }] },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        aiProvider: ModelProviderEnum.Claude,
        model: 'Claude API (claude-sonnet-5)',
        modelId: 'claude-sonnet-5',
        contentParts: signedParts('signature-old'),
      },
      { id: 'user-2', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'assistant-2',
        role: MessageRoleEnum.Assistant,
        aiProvider: ModelProviderEnum.Claude,
        model: 'Claude API (claude-sonnet-5)',
        modelId: 'claude-sonnet-5',
        contentParts: signedParts('signature-current'),
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.Claude, modelId: 'claude-sonnet-5' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'claude-sonnet-5', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    const assistantMessages = prepared.coreMessages.filter((message) => message.role === 'assistant')
    expect(assistantMessages[0]?.content).toMatchObject([
      {
        type: 'reasoning',
        text: 'Let me look that up.',
        providerOptions: { anthropic: { signature: 'signature-old' } },
      },
      { type: 'tool-call', toolCallId: 'tool-signature-old' },
    ])
    expect(assistantMessages[1]?.content).toMatchObject([
      {
        type: 'reasoning',
        text: 'Let me look that up.',
        providerOptions: { anthropic: { signature: 'signature-current' } },
      },
      { type: 'tool-call', toolCallId: 'tool-signature-current' },
    ])
  })

  test('still replays signed thinking after switching Claude models in the same session', async () => {
    const messages: Message[] = [
      { id: 'user-1', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        aiProvider: ModelProviderEnum.Claude,
        modelId: 'claude-sonnet-5',
        contentParts: [
          {
            type: 'reasoning',
            text: 'Let me look that up.',
            providerMetadata: { anthropic: { signature: 'signature-a' } },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.Claude, modelId: 'claude-opus-5' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'claude-opus-5', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    const assistantMessage = prepared.coreMessages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.content).toMatchObject([
      {
        type: 'reasoning',
        text: 'Let me look that up.',
        providerOptions: { anthropic: { signature: 'signature-a' } },
      },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
  })

  test('degrades an unsigned resumed turn to a thinking-free request', async () => {
    const messages: Message[] = [
      { id: 'user-1', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'First question' }] },
      {
        // An earlier signed turn: its blocks must also stay off the wire once
        // this request degrades to thinking-off.
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          {
            type: 'reasoning',
            text: 'Signed earlier turn',
            providerMetadata: { anthropic: { signature: 'signature-early' } },
          },
          { type: 'text', text: 'Done.' },
        ],
      },
      { id: 'user-2', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'assistant-2',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          { type: 'reasoning', text: 'Legacy unsigned thought' },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.Claude, modelId: 'claude-haiku-4-5' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'claude-haiku-4-5', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    expect(prepared.chatOptions.providerOptions?.claude?.thinking).toEqual({ type: 'disabled' })
    const assistantMessages = prepared.coreMessages.filter((message) => message.role === 'assistant')
    for (const message of assistantMessages) {
      const content = Array.isArray(message.content) ? message.content : []
      expect(content.some((part) => part.type === 'reasoning')).toBe(false)
    }
    expect(assistantMessages.at(-1)?.content).toMatchObject([{ type: 'tool-call', toolCallId: 'tool-1' }])
  })

  test('keeps thinking on when a resumed multi-step turn opens with signed thinking', async () => {
    // Non-interleaved budget thinking: only the first loop step carries a
    // thinking block; later steps are bare tool calls. Resuming must not
    // degrade this documented shape.
    const messages: Message[] = [
      { id: 'user-1', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          {
            type: 'reasoning',
            text: 'Signed opening thought',
            providerMetadata: { anthropic: { signature: 'signature-a' } },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-2',
            toolName: 'lookup',
            args: {},
            result: { value: 'found more' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.Claude, modelId: 'claude-haiku-4-5' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'claude-haiku-4-5', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    expect(prepared.chatOptions.providerOptions?.claude?.thinking).toBeUndefined()
    // The wire mirrors the documented shape: the turn opens with the signed
    // thinking block, and the later loop step ships as a bare tool_use message.
    const assistantMessages = prepared.coreMessages.filter((message) => message.role === 'assistant')
    expect(assistantMessages[0]?.content).toMatchObject([
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'signature-a' } } },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
    expect(assistantMessages[1]?.content).toMatchObject([{ type: 'tool-call', toolCallId: 'tool-2' }])
  })

  test('leaves thinking untouched on a fresh user turn after an unsigned tool history', async () => {
    const messages: Message[] = [
      { id: 'user-1', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          { type: 'reasoning', text: 'Legacy unsigned thought' },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
          { type: 'text', text: 'Found it.' },
        ],
      },
      { id: 'user-2', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'New question' }] },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.Claude, modelId: 'claude-haiku-4-5' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'claude-haiku-4-5', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    // The request ends with the user message: no resumed tool exchange, so the
    // turn-start rule must not degrade thinking for the new turn.
    expect(prepared.chatOptions.providerOptions?.claude?.thinking).toBeUndefined()
  })

  test('still replays signed thinking when a stale resume appends a trailing time reminder', async () => {
    const staleTs = Date.now() - 2 * TIME_REMINDER_MIN_GAP_MS
    const messages: Message[] = [
      {
        id: 'user-1',
        role: MessageRoleEnum.User,
        timestamp: staleTs,
        contentParts: [{ type: 'text', text: 'Look this up.' }],
      },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        timestamp: staleTs + 60_000,
        aiProvider: ModelProviderEnum.Claude,
        modelId: 'claude-sonnet-5',
        contentParts: [
          {
            type: 'reasoning',
            text: 'Let me look that up.',
            providerMetadata: { anthropic: { signature: 'signature-a' } },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.Claude, modelId: 'claude-sonnet-5' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'claude-sonnet-5', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    // The synthetic trailing user reminder must not drop the paused assistant
    // turn's signed thinking: both coexist on the wire.
    const lastMessage = prepared.coreMessages.at(-1)
    expect(lastMessage?.role).toBe('user')
    expect(JSON.stringify(lastMessage)).toContain('Current date and time:')
    const assistantMessage = prepared.coreMessages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.content).toMatchObject([
      {
        type: 'reasoning',
        text: 'Let me look that up.',
        providerOptions: { anthropic: { signature: 'signature-a' } },
      },
      { type: 'tool-call', toolCallId: 'tool-1' },
    ])
  })

  test('does not replay Anthropic-namespace thinking metadata on the Bedrock route', async () => {
    const messages: Message[] = [
      { id: 'user-1', role: MessageRoleEnum.User, contentParts: [{ type: 'text', text: 'Look this up.' }] },
      {
        id: 'assistant-1',
        role: MessageRoleEnum.Assistant,
        contentParts: [
          {
            type: 'reasoning',
            text: 'Let me look that up.',
            providerMetadata: { anthropic: { signature: 'signature-a' } },
          },
          {
            type: 'tool-call',
            state: 'result',
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: {},
            result: { value: 'found' },
          },
        ],
      },
    ]

    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.Bedrock,
        modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel({ modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', apiStyle: 'anthropic' }),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
    })

    const assistantMessage = prepared.coreMessages.find((message) => message.role === 'assistant')
    expect(assistantMessage?.content).toMatchObject([{ type: 'tool-call', toolCallId: 'tool-1' }])
  })
})

describe('session prompt context snapshot', () => {
  function createUserMessage(text = 'Help me with a task.'): Message {
    return {
      id: 'msg-user-1',
      role: MessageRoleEnum.User,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text }],
    }
  }

  function createSystemMessage(text: string): Message {
    return {
      id: 'msg-system-1',
      role: MessageRoleEnum.System,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text }],
    }
  }

  function prepareWith(settings: SessionSettings, messages: Message[], sideEffects = {}, copilotId?: string) {
    return prepareAgentGenerationHarness({
      session: createSession(copilotId),
      settings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'on',
      agentModeLocked: true,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
      sideEffects,
    })
  }

  test('captures and persists a snapshot, drops session system prompts, and pins the capture date', async () => {
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await prepareWith(
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      [createSystemMessage('You are a pirate copilot.'), createUserMessage()],
      { persistSessionPromptContextSnapshot }
    )

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    const snapshot = persistSessionPromptContextSnapshot.mock.calls[0][0]
    expect(snapshot.version).toBe(1)
    expect(snapshot.workspaceDirectories).toEqual([])

    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('You are Chatbox agent')
    expect(serialized).toContain('## Soul')
    // Untouched template falls back to the default persona.
    expect(serialized).toContain('Be genuinely helpful, not performatively helpful')
    expect(serialized).toContain('Session context captured:')
    // A session system prompt without a Copilot stays out of the agent request.
    expect(serialized).not.toContain('You are a pirate copilot.')
    // Memory tools are part of the agent tool set.
    expect(prepared.tools.save_memory).toBeDefined()
    expect(prepared.tools.delete_memory).toBeDefined()
  })

  test('splices a Copilot prompt into the frozen Soul section', async () => {
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await prepareWith(
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      [createSystemMessage('You are a pirate copilot.'), createUserMessage()],
      { persistSessionPromptContextSnapshot },
      'copilot-pirate'
    )

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    expect(persistSessionPromptContextSnapshot.mock.calls[0][0].copilotPersona).toBe('You are a pirate copilot.')

    const serialized = JSON.stringify(prepared.coreMessages)
    const soulIx = serialized.indexOf('## Soul')
    const overlayIx = serialized.indexOf('You are a pirate copilot.')
    expect(serialized).toContain('You are Chatbox agent')
    expect(soulIx).toBeGreaterThanOrEqual(0)
    expect(overlayIx).toBeGreaterThan(soulIx)
    expect(overlayIx).toBeLessThan(serialized.indexOf('## Runtime'))
    expect(serialized).toContain('This session is using a Copilot.')
    // The Copilot is inside Soul, not a leftover session system message.
    expect(prepared.promptMsgs.some((message) => message.role === 'system')).toBe(false)
  })

  test('reuses a snapshot Copilot overlay without reading the live system prompt', async () => {
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await prepareWith(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'My frozen custom persona content.',
          copilotPersona: 'Frozen pirate overlay.',
          memories: [],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1700000000000,
          scope: 'agent',
        },
      } as SessionSettings,
      [createSystemMessage('Live pirate that must not appear.'), createUserMessage()],
      { persistSessionPromptContextSnapshot },
      'copilot-pirate'
    )

    expect(persistSessionPromptContextSnapshot).not.toHaveBeenCalled()
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('Frozen pirate overlay.')
    expect(serialized).not.toContain('Live pirate that must not appear.')
  })

  test('does not backfill a Copilot onto an already-frozen snapshot', async () => {
    const prepared = await prepareWith(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'My frozen custom persona content.',
          memories: [],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1700000000000,
          scope: 'agent',
        },
      } as SessionSettings,
      [createSystemMessage('You are a pirate copilot.'), createUserMessage()],
      {},
      'copilot-pirate'
    )

    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('My frozen custom persona content.')
    expect(serialized).not.toContain('You are a pirate copilot.')
  })

  test('reuses an existing snapshot verbatim without re-capturing', async () => {
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await prepareWith(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'My frozen custom persona content.',
          memories: [{ id: 'm1', content: 'User prefers pnpm over npm', createdAt: 1700000000000 }],
          workspaceInstructions: '\n## Workspace Instructions\nFROZEN-WORKSPACE-MARKER\n',
          workspaceDirectories: [],
          capturedAt: 1700000000000,
        },
      } as SessionSettings,
      [createUserMessage()],
      { persistSessionPromptContextSnapshot }
    )

    expect(persistSessionPromptContextSnapshot).not.toHaveBeenCalled()
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('My frozen custom persona content.')
    expect(serialized).toContain('[m1] User prefers pnpm over npm')
    expect(serialized).toContain('FROZEN-WORKSPACE-MARKER')
  })

  test('re-captures when the working directories change', async () => {
    const persistSessionPromptContextSnapshot = vi.fn()
    await prepareWith(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        workingDirectories: ['/new/dir'],
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'Stale soul.',
          memories: [],
          workspaceInstructions: '',
          workspaceDirectories: ['/old/dir'],
          capturedAt: 1700000000000,
        },
      } as SessionSettings,
      [createUserMessage()],
      { persistSessionPromptContextSnapshot }
    )

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    const snapshot = persistSessionPromptContextSnapshot.mock.calls[0][0]
    expect(snapshot.workspaceDirectories).toEqual(['/new/dir'])
  })

  test('re-captures when the existing snapshot was chat-scoped', async () => {
    const persistSessionPromptContextSnapshot = vi.fn()
    await prepareWith(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'Chat-era soul that must not gate agent identity.',
          memories: [],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1700000000000,
          scope: 'chat',
        },
      } as SessionSettings,
      [createUserMessage()],
      { persistSessionPromptContextSnapshot }
    )

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    expect(persistSessionPromptContextSnapshot.mock.calls[0][0].scope).toBe('agent')
  })

  test('chat mode keeps the legacy system prompt path untouched', async () => {
    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [createSystemMessage('You are a pirate copilot.'), createUserMessage()],
      targetMsgIx: 2,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('You are a pirate copilot.')
    expect(serialized).not.toContain('You are Chatbox agent')
  })
})

describe('chat mode memories', () => {
  function chatPrepare(settings: SessionSettings, messages: Message[], sideEffects = {}, session = createSession()) {
    return prepareAgentGenerationHarness({
      session,
      settings,
      globalSettings: {} as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages,
      targetMsgIx: messages.length,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
      sideEffects,
    })
  }

  const userMessage: Message = {
    id: 'msg-user-1',
    role: MessageRoleEnum.User,
    timestamp: Date.now(),
    contentParts: [{ type: 'text', text: 'Hello there' }],
  }

  const systemMessage: Message = {
    id: 'msg-system-1',
    role: MessageRoleEnum.System,
    timestamp: Date.now(),
    contentParts: [{ type: 'text', text: 'You are a pirate copilot.' }],
  }

  test('injects snapshot memories read-only while keeping the session system prompt', async () => {
    const prepared = await chatPrepare(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'Custom soul that must stay agent-only.',
          memories: [{ id: 'm1', content: 'User prefers pnpm over npm', createdAt: 1700000000000 }],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1700000000000,
        },
      } as SessionSettings,
      [systemMessage, userMessage]
    )

    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('You are a pirate copilot.')
    expect(serialized).toContain('[m1] User prefers pnpm over npm')
    // No Soul/identity leaks into chat mode.
    expect(serialized).not.toContain('You are Chatbox agent')
    expect(serialized).not.toContain('Custom soul that must stay agent-only.')
    // Memory tools are registered, so the guidance references them.
    expect(prepared.tools.save_memory).toBeDefined()
    expect(serialized).toContain('save_memory')
  })

  test('captures a memories snapshot on first chat generation when memories exist', async () => {
    const storage = (await import('@/storage')).default
    await storage.setItemNow('agent-memories', [{ id: 'm2', content: 'Timezone is UTC+8', createdAt: 1700000000000 }])
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await chatPrepare(
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      [userMessage],
      { persistSessionPromptContextSnapshot }
    )
    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(prepared.coreMessages)).toContain('[m2] Timezone is UTC+8')
  })

  test('memory switch off removes tools and injection in both modes', async () => {
    // tools-builder reads the switch from the settings store; the harness reads
    // the same settings through the globalSettings parameter.
    getSettingsMock.mockReturnValue({
      skills: { enabledSkillNames: [] },
      memoryEnabled: false,
    })
    const prepared = await prepareAgentGenerationHarness({
      session: createSession(),
      settings: {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: 'Persisted soul.',
          memories: [{ id: 'm9', content: 'Should not appear', createdAt: 1700000000000 }],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1700000000000,
        },
      } as SessionSettings,
      globalSettings: { memoryEnabled: false } as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'on',
      agentModeLocked: true,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
    })

    expect(prepared.tools.save_memory).toBeUndefined()
    expect(prepared.tools.delete_memory).toBeUndefined()
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).not.toContain('Should not appear')
    expect(serialized).not.toContain('## Memories')
    // Soul is independent of the memory switch.
    expect(serialized).toContain('Persisted soul.')
  })

  test('does not capture mid-conversation even when memories appear', async () => {
    const storage = (await import('@/storage')).default
    await storage.setItemNow('agent-memories', [
      { id: 'm3', content: 'Appeared mid-conversation', createdAt: 1700000000000 },
    ])
    const persistSessionPromptContextSnapshot = vi.fn()
    const assistantMessage: Message = {
      id: 'msg-assistant-1',
      role: MessageRoleEnum.Assistant,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'Sure, done.' }],
    }
    const prepared = await chatPrepare(
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      [userMessage, assistantMessage, { ...userMessage, id: 'msg-user-2' }],
      { persistSessionPromptContextSnapshot }
    )
    expect(persistSessionPromptContextSnapshot).not.toHaveBeenCalled()
    expect(JSON.stringify(prepared.coreMessages)).not.toContain('Appeared mid-conversation')
    await storage.setItemNow('agent-memories', [])
  })

  test('skips snapshot capture entirely when no memories exist', async () => {
    const storage = (await import('@/storage')).default
    await storage.setItemNow('agent-memories', [])
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await chatPrepare(
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      [userMessage],
      { persistSessionPromptContextSnapshot }
    )
    expect(persistSessionPromptContextSnapshot).not.toHaveBeenCalled()
    expect(JSON.stringify(prepared.coreMessages)).not.toContain('## Memories')
  })

  test('copilot memory replaces the global store even when the global switch is off', async () => {
    const storage = (await import('@/storage')).default
    await enableCopilotMemory({ id: 'cp1', name: 'Tutor' })
    await storage.setItemNow('copilot-memories', {
      cp1: [{ id: 'cm1', content: 'Copilot-only fact', createdAt: 1700000000000 }],
    })
    await storage.setItemNow('agent-memories', [{ id: 'gm1', content: 'Global-only fact', createdAt: 1700000000000 }])
    getSettingsMock.mockReturnValue({ skills: { enabledSkillNames: [] }, memoryEnabled: false })
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await prepareAgentGenerationHarness({
      session: { ...createSession(), copilotId: 'cp1' },
      settings: { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      globalSettings: { memoryEnabled: false } as Settings,
      configs: { uuid: 'config-1' } as Config,
      messages: [userMessage],
      targetMsgIx: 1,
      model: createMockModel(),
      dependencies: createModelDependencies(),
      webBrowsing: false,
      agentModeValue: 'off',
      agentModeLocked: false,
      agentModeSupported: true,
      signal: new AbortController().signal,
      sandboxProviderFactory: () => sandboxProviderMock as unknown as SandboxProvider,
      isPro: () => true,
      sideEffects: { persistSessionPromptContextSnapshot },
    })

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    expect(persistSessionPromptContextSnapshot.mock.calls[0][0].memoryCopilotId).toBe('cp1')
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('[cm1] Copilot-only fact')
    expect(serialized).not.toContain('Global-only fact')
    expect(prepared.tools.save_memory).toBeDefined()

    await disableCopilotMemory('cp1')
    await storage.setItemNow('copilot-memories', {})
    await storage.setItemNow('agent-memories', [])
  })

  test('a copilot without its own memory keeps the session on the global store', async () => {
    const storage = (await import('@/storage')).default
    await addOrUpdateMyCopilot({ id: 'cp1', name: 'Tutor', prompt: 'persona' })
    await storage.setItemNow('copilot-memories', {
      cp1: [{ id: 'cm1', content: 'Copilot-only fact', createdAt: 1700000000000 }],
    })
    await storage.setItemNow('agent-memories', [{ id: 'gm1', content: 'Global-only fact', createdAt: 1700000000000 }])
    const persistSessionPromptContextSnapshot = vi.fn()
    const prepared = await chatPrepare(
      { provider: ModelProviderEnum.ChatboxAI, modelId: 'test-model' } as SessionSettings,
      [userMessage],
      { persistSessionPromptContextSnapshot },
      { ...createSession(), copilotId: 'cp1' }
    )

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    expect(persistSessionPromptContextSnapshot.mock.calls[0][0].memoryCopilotId).toBeUndefined()
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('[gm1] Global-only fact')
    expect(serialized).not.toContain('Copilot-only fact')

    await removeMyCopilot('cp1')
    await storage.setItemNow('copilot-memories', {})
    await storage.setItemNow('agent-memories', [])
  })

  test('reloads global memory after a copilot memory round trip', async () => {
    const storage = (await import('@/storage')).default
    const copilotId = 'cp-memory-round-trip'
    await enableCopilotMemory({ id: copilotId, name: 'Tutor' })
    await disableCopilotMemory(copilotId)
    await storage.setItemNow('agent-memories', [
      { id: 'gm-latest', content: 'Latest global fact', createdAt: 1700000000000 },
    ])
    const persistSessionPromptContextSnapshot = vi.fn()
    const assistantMessage: Message = {
      id: 'msg-assistant-round-trip',
      role: MessageRoleEnum.Assistant,
      timestamp: Date.now(),
      contentParts: [{ type: 'text', text: 'Previous response' }],
    }

    const prepared = await chatPrepare(
      {
        provider: ModelProviderEnum.ChatboxAI,
        modelId: 'test-model',
        sessionPromptContextSnapshot: {
          version: 1,
          soul: '',
          memories: [{ id: 'gm-stale', content: 'Stale global fact', createdAt: 1600000000000 }],
          workspaceInstructions: '',
          workspaceDirectories: [],
          capturedAt: 1600000000000,
          memoryEnabled: true,
          memoryStateToken: '',
        },
      } as SessionSettings,
      [userMessage, assistantMessage, { ...userMessage, id: 'msg-user-round-trip' }],
      { persistSessionPromptContextSnapshot },
      { ...createSession(), copilotId }
    )

    expect(persistSessionPromptContextSnapshot).toHaveBeenCalledTimes(1)
    expect(persistSessionPromptContextSnapshot.mock.calls[0][0]).toMatchObject({
      memories: [{ id: 'gm-latest', content: 'Latest global fact', createdAt: 1700000000000 }],
      memoryEnabled: true,
      memoryStateToken: expect.any(String),
    })
    const serialized = JSON.stringify(prepared.coreMessages)
    expect(serialized).toContain('[gm-latest] Latest global fact')
    expect(serialized).not.toContain('Stale global fact')

    await storage.setItemNow('agent-memories', [])
  })
})

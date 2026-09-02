import { describe, expect, test } from 'vitest'
import { settings as defaultSettings } from '../defaults'
import {
  combineMemoryStateTokens,
  EFFECTIVE_MEMORY_STATE_TOKEN_MAX_CHARS,
  MEMORY_STATE_TOKEN_MAX_CHARS,
} from './agent-persona'
import { SessionSettingsSchema, SettingsSchema } from './settings'

test('SessionSettingsSchema preserves the largest effective memory state token', () => {
  const componentToken = 'x'.repeat(MEMORY_STATE_TOKEN_MAX_CHARS)
  const effectiveToken = combineMemoryStateTokens(componentToken, componentToken)
  const parsed = SessionSettingsSchema.parse({
    sessionPromptContextSnapshot: {
      version: 1,
      soul: '',
      memories: [],
      memoryStateToken: effectiveToken,
      workspaceInstructions: '',
      workspaceDirectories: [],
      capturedAt: 1,
    },
  })

  expect(effectiveToken).toHaveLength(EFFECTIVE_MEMORY_STATE_TOKEN_MAX_CHARS)
  expect(parsed.sessionPromptContextSnapshot?.memoryStateToken).toBe(effectiveToken)
})

describe('SessionSettingsSchema max output tokens', () => {
  test.each([0, -1, 0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'treats %s as unset',
    (maxTokens) => {
      expect(SessionSettingsSchema.parse({ maxTokens }).maxTokens).toBeUndefined()
    }
  )

  test.each([undefined, 1, 4096])('preserves valid value %s', (maxTokens) => {
    expect(SessionSettingsSchema.parse({ maxTokens }).maxTokens).toBe(maxTokens)
  })
})

describe('SettingsSchema RAG default models', () => {
  test('parses default embedding and rerank model selections', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      defaultEmbeddingModel: {
        provider: 'openai',
        model: 'text-embedding-3-small',
      },
      defaultRerankModel: {
        provider: 'cohere',
        model: 'rerank-v3.5',
      },
    })

    expect(parsed.defaultEmbeddingModel).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
    })
    expect(parsed.defaultRerankModel).toEqual({
      provider: 'cohere',
      model: 'rerank-v3.5',
    })
  })

  test('defaults leave RAG model fallbacks unset', () => {
    const parsed = SettingsSchema.parse(defaultSettings())

    expect(parsed.defaultEmbeddingModel).toBeUndefined()
    expect(parsed.defaultRerankModel).toBeUndefined()
  })
})

describe('SettingsSchema MCP protocol mode', () => {
  test.each(['auto', 'legacy'] as const)('parses %s protocol mode', (protocolMode) => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      mcp: {
        enabledBuiltinServers: [],
        servers: [
          {
            id: 'custom-mcp',
            name: 'Custom MCP',
            enabled: true,
            protocolMode,
            transport: { type: 'http', url: 'https://example.com/mcp' },
          },
        ],
      },
    })

    expect(parsed.mcp.servers[0].protocolMode).toBe(protocolMode)
  })

  test('keeps the protocol mode absent for existing custom servers', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      mcp: {
        enabledBuiltinServers: [],
        servers: [
          {
            id: 'legacy-mcp',
            name: 'Legacy MCP',
            enabled: true,
            transport: { type: 'http', url: 'https://example.com/mcp' },
          },
        ],
      },
    })

    expect(parsed.mcp.servers[0].protocolMode).toBeUndefined()
  })

  test('treats an unknown protocol mode as legacy-compatible configuration', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      mcp: {
        enabledBuiltinServers: [],
        servers: [
          {
            id: 'unknown-protocol-mcp',
            name: 'Unknown protocol MCP',
            enabled: true,
            protocolMode: 'unknown',
            transport: { type: 'http', url: 'https://example.com/mcp' },
          },
        ],
      },
    })

    expect(parsed.mcp.servers[0].protocolMode).toBeUndefined()
  })
})

describe('SettingsSchema background image opacity', () => {
  test('uses the original opacity for existing settings', () => {
    const legacySettings: Record<string, unknown> = { ...defaultSettings() }
    delete legacySettings.backgroundImageOpacity

    expect(SettingsSchema.parse(legacySettings).backgroundImageOpacity).toBe(0.16)
  })
})

describe('SettingsSchema new message scroll behavior', () => {
  test('defaults new message auto-scroll to top to disabled for existing settings', () => {
    const { autoScrollNewMessagesToTop: _unset, ...legacySettings } = defaultSettings()

    expect(SettingsSchema.parse(legacySettings).autoScrollNewMessagesToTop).toBe(false)
  })
})

describe('SettingsSchema shortcut compatibility', () => {
  test('adds the new thread shortcut when loading settings without the historical key', () => {
    const shortcuts: Record<string, unknown> = { ...defaultSettings().shortcuts }
    delete shortcuts.messageListRefreshContext

    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      shortcuts,
    })

    expect(parsed.shortcuts.messageListRefreshContext).toBe('mod+shift+n')
  })

  test('migrates the removed cmd+r shortcut to cmd+shift+n', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      shortcuts: {
        ...defaultSettings().shortcuts,
        messageListRefreshContext: 'mod+r',
      },
    })

    expect(parsed.shortcuts.messageListRefreshContext).toBe('mod+shift+n')
  })

  test('moves the old image creator shortcut away from cmd+shift+n', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      shortcuts: {
        ...defaultSettings().shortcuts,
        newPictureChat: 'mod+shift+n',
      },
    })

    expect(parsed.shortcuts.newPictureChat).toBe('')
  })
})

describe('SettingsSchema VibeDrop publication history', () => {
  test('parses session publication metadata without a schema migration', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      vibedropSessionPublications: {
        'session-1': [
          {
            slug: 'site-1',
            url: 'https://site-1.vibedrop.site',
            visibility: 'public',
            uniqueId: 'artifact-1',
            updatedAt: 1,
          },
        ],
      },
    })

    expect(parsed.vibedropSessionPublications?.['session-1']?.[0]).toEqual({
      slug: 'site-1',
      url: 'https://site-1.vibedrop.site',
      visibility: 'public',
      uniqueId: 'artifact-1',
      updatedAt: 1,
    })
  })

  test('ignores malformed publication history from older or external settings', () => {
    const parsed = SettingsSchema.parse({
      ...defaultSettings(),
      vibedropSessionPublications: {
        'session-1': [{ slug: 'site-1' }],
      },
    })

    expect(parsed.vibedropSessionPublications).toBeUndefined()
  })
})

describe('SessionSettingsSchema per-model provider options', () => {
  test('parses the per-model map alongside the legacy shared field', () => {
    const parsed = SessionSettingsSchema.parse({
      provider: 'chatbox-ai',
      modelId: 'deepseek-v4-pro',
      providerOptions: { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: 'max' } },
      providerOptionsByModel: {
        'chatbox-ai:deepseek-v4-pro': { claude: { thinking: { type: 'enabled' }, effort: 'max' } },
        'chatbox-ai:claude-sonnet-4-20250514': { claude: { thinking: { type: 'enabled', budgetTokens: 4096 } } },
      },
    })

    expect(parsed.providerOptionsByModel?.['chatbox-ai:deepseek-v4-pro']?.claude?.effort).toBe('max')
    expect(parsed.providerOptionsByModel?.['chatbox-ai:claude-sonnet-4-20250514']?.claude?.thinking?.budgetTokens).toBe(
      4096
    )
  })

  test('drops an invalid map without failing the whole settings parse', () => {
    const parsed = SessionSettingsSchema.parse({
      provider: 'chatbox-ai',
      providerOptionsByModel: 'not-a-map',
    })

    expect(parsed.providerOptionsByModel).toBeUndefined()
    expect(parsed.provider).toBe('chatbox-ai')
  })
})

describe('SessionSettingsSchema command approval mode', () => {
  test.each(['always_ask', 'smart', 'full_access'] as const)('accepts %s', (commandApprovalMode) => {
    expect(SessionSettingsSchema.parse({ commandApprovalMode }).commandApprovalMode).toBe(commandApprovalMode)
  })

  test('drops an unknown mode while retaining the legacy full-access field', () => {
    const parsed = SessionSettingsSchema.parse({ commandApprovalMode: 'unknown', agentFullAccess: true })

    expect(parsed.commandApprovalMode).toBeUndefined()
    expect(parsed.agentFullAccess).toBe(true)
  })
})

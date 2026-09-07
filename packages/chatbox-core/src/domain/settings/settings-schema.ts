import { z } from 'zod'
import { DEFAULT_INTERFACE_COLORS, getDefaultInterfaceColors } from '../../theme-colors'
import { MEMORY_STATE_TOKEN_MAX_CHARS, SessionPromptContextSnapshotSchema } from '../../types/agent-persona'
import { COMMAND_APPROVAL_MODES } from '../../types/command-execution'
import { ModelProviderEnum, ModelProviderType } from '../../types/provider'
import { DEFAULT_ENABLED_BUILTIN_SKILL_NAMES, SkillSettingsSchema } from '../../types/skills'

// Re-export for backward compatibility
export { ModelProviderType } from '../../types/provider'

// ===== Document Parser Types =====

/**
 * Document parser service type
 * - none: No parsing service, only supports basic text files (legacy mobile/web setting)
 * - local: Local parsing using built-in libraries (desktop default)
 * - chatbox-ai: Local-first parsing with Chatbox cloud fallback (mobile/web default)
 * - mineru: Third-party MinerU parsing service (desktop only)
 */
export type DocumentParserType = 'none' | 'local' | 'chatbox-ai' | 'mineru'

export const DocumentParserConfigSchema = z.object({
  type: z.enum(['none', 'local', 'chatbox-ai', 'mineru']),
  mineru: z
    .object({
      apiToken: z.string(),
    })
    .optional(),
})

export type DocumentParserConfig = z.infer<typeof DocumentParserConfigSchema>

export const DEFAULT_DOCUMENT_PARSER_CONFIG: DocumentParserConfig = {
  type: 'local',
}

export const AgentModeEntrySchema = z.object({
  value: z.enum(['auto', 'on', 'off']),
  locked: z.boolean(),
  lockReason: z.enum(['file_upload', 'load_skill', 'message_sent']).nullable(),
})

export const ProviderModelInfoSchema = z.object({
  modelId: z.string(),
  // The provider id this model was resolved under (e.g. 'chatbox-ai', 'qwen').
  // Stamped at model-resolution time (getModel); not part of persisted model lists.
  // Used to evaluate reasoning-control support with the same provider+model-id logic as the UI.
  providerId: z.string().optional().catch(undefined),
  type: z.enum(['chat', 'embedding', 'rerank', 'image']).optional().catch(undefined),
  apiStyle: z.enum(['google', 'openai', 'openai-responses', 'anthropic']).optional().catch(undefined),
  nickname: z.string().optional().catch(undefined),
  labels: z.array(z.string()).optional().catch([]),
  capabilities: z
    .array(z.enum(['vision', 'reasoning', 'tool_use', 'web_search']))
    .optional()
    .catch([]),
  contextWindow: z.number().optional().catch(undefined),
  maxOutput: z.number().optional().catch(undefined),
})

export const OAuthCredentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional().catch(undefined),
  expiresAt: z.number().optional().catch(undefined),
  extra: z.record(z.string(), z.unknown()).optional().catch(undefined),
})

export const ProviderSettingsSchema = z.object({
  apiKey: z.string().optional().catch(undefined),
  apiHost: z.string().optional().catch(undefined),
  apiPath: z.string().optional().catch(undefined),
  models: z.array(ProviderModelInfoSchema).optional().catch(undefined),
  excludedModels: z.array(z.string()).optional().catch(undefined),
  useProxy: z.boolean().optional().catch(undefined),

  // oauth
  oauth: OAuthCredentialsSchema.optional().catch(undefined),
  /** Which auth method is active: 'apikey' (default) or 'oauth' */
  activeAuthMode: z.enum(['apikey', 'oauth']).optional().catch(undefined),

  // azure
  endpoint: z.string().optional().catch(undefined),
  deploymentName: z.string().optional().catch(undefined),
  dalleDeploymentName: z.string().optional().catch(undefined),
  apiVersion: z.string().optional().catch(undefined),

  // credentials (e.g. AWS Bedrock)
  accessKey: z.string().optional().catch(undefined),
  secretKey: z.string().optional().catch(undefined),
  sessionToken: z.string().optional().catch(undefined),
  region: z.string().optional().catch(undefined),
})

const BuiltinProviderBaseInfoSchema = z.object({
  id: z.nativeEnum(ModelProviderEnum),
  name: z.string(),
  type: z.nativeEnum(ModelProviderType).catch(ModelProviderType.OpenAI),
  isCustom: z.literal(false).optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  urls: z
    .object({
      website: z.string().nullish(),
      apiKey: z.string().nullish(),
      docs: z.string().nullish(),
      models: z.string().nullish(),
    })
    .optional()
    .catch(undefined),
  defaultSettings: ProviderSettingsSchema.optional().catch(undefined),
})

const CustomProviderBaseInfoSchema = BuiltinProviderBaseInfoSchema.extend({
  id: z.string(),
  iconUrl: z.string().optional().catch(undefined),
  isCustom: z.literal(true),
})

const ProviderBaseInfoSchema = z.discriminatedUnion('isCustom', [
  BuiltinProviderBaseInfoSchema,
  CustomProviderBaseInfoSchema,
])

const ClaudeParamsSchema = z.object({
  thinking: z
    .object({
      type: z.enum(['enabled', 'disabled']).default('enabled'),
      budgetTokens: z.number().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().catch(undefined),
})

const OpenAIParamsSchema = z.object({
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional().catch(undefined),
  reasoningSummary: z.enum(['auto', 'concise', 'detailed']).optional().catch(undefined),
  include: z.array(z.string()).optional().catch(undefined),
  forceReasoning: z.boolean().optional().catch(undefined),
})

const GoogleParamsSchema = z.object({
  thinkingConfig: z.object({
    thinkingBudget: z.number().optional().catch(undefined),
    thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional().catch(undefined),
    includeThoughts: z.boolean().catch(true),
  }),
})

const DeepSeekParamsSchema = z.object({
  thinking: z
    .object({
      type: z.enum(['enabled', 'disabled']).default('enabled'),
    })
    .optional()
    .catch(undefined),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().catch(undefined),
})

const ReasoningOptionsSchema = z.object({
  effort: z.enum(['minimal', 'low', 'medium', 'high']).optional().catch(undefined),
  max_tokens: z.number().optional().catch(undefined),
  enabled: z.boolean().optional().catch(undefined),
  exclude: z.boolean().optional().catch(undefined),
})

const OpenAICompatibleParamsSchema = z.object({
  reasoningEffort: z.string().optional().catch(undefined),
  reasoning: ReasoningOptionsSchema.optional().catch(undefined),
  include: z.array(z.string()).optional().catch(undefined),
  enable_thinking: z.boolean().optional().catch(undefined),
  thinking_budget: z.number().optional().catch(undefined),
})

const OpenRouterParamsSchema = z.object({
  reasoning: ReasoningOptionsSchema.optional().catch(undefined),
})

export const ProviderOptionsSchema = z.object({
  claude: ClaudeParamsSchema.optional(),
  openai: OpenAIParamsSchema.optional(),
  google: GoogleParamsSchema.optional(),
  deepseek: DeepSeekParamsSchema.optional(),
  openaiCompatible: OpenAICompatibleParamsSchema.optional(),
  openrouter: OpenRouterParamsSchema.optional(),
})

// NOTICE: Global settings is for new session default settings, set to session when session created, changes will not affect existing sessions
export const GlobalSessionSettingsSchema = z.object({
  maxContextMessageCount: z.number().optional().catch(undefined),
  temperature: z.number().optional().catch(undefined),
  topP: z.number().optional().catch(undefined),
  maxTokens: z.number().finite().int().min(1).optional().catch(undefined),
  stream: z.boolean().optional().catch(true),
})

export const SessionSettingsSchema = GlobalSessionSettingsSchema.extend({
  provider: z.string().optional().catch(undefined),
  modelId: z.string().optional().catch(undefined),
  dalleStyle: z.enum(['vivid', 'natural']).optional().catch('vivid'),
  imageGenerateNum: z.number().optional().catch(1),
  // Legacy shared reasoning options; no longer read (superseded by
  // providerOptionsByModel) and cleared on writes. Kept in the schema so old
  // clients' data still parses.
  providerOptions: ProviderOptionsSchema.optional().catch(undefined),
  // Reasoning options scoped to the `${provider}:${modelId}` they were written for,
  // so switching models never applies another model's thinking parameters.
  // See resolveReasoningProviderOptions.
  providerOptionsByModel: z.record(z.string(), ProviderOptionsSchema).optional().catch(undefined),
  autoCompaction: z.boolean().optional().catch(undefined),
  // Whether generation pauses for user confirmation after a run of consecutive
  // tool calls. Undefined follows the global setting; true/false override it.
  pauseOnToolCallLimit: z.boolean().optional().catch(undefined),
  // Real local directories the user grants the agent sandbox read/write access to
  // (like /tmp): files under these paths are read/written without per-action approval.
  // Desktop only.
  workingDirectories: z.array(z.string()).optional().catch(undefined),
  // When enabled, Work Mode skips per-action approval for user_exec and real filesystem mutations.
  agentFullAccess: z.boolean().optional().catch(undefined),
  // Per-session command policy. Keep agentFullAccess for older clients; readers
  // fall back to it when this newer field is missing or stripped during sync.
  commandApprovalMode: z.enum(COMMAND_APPROVAL_MODES).optional().catch(undefined),
  agentMode: AgentModeEntrySchema.optional().catch(undefined),
  // Frozen session prompt-context inputs (Soul + memories + workspace AGENTS.md),
  // captured on the session's first agent-mode generation so the system prompt
  // prefix stays byte-stable for provider prompt caches. Cleared on new thread.
  sessionPromptContextSnapshot: SessionPromptContextSnapshotSchema.optional().catch(undefined),
})

const UnifiedTokenUsageDetailSchema = z.object({
  type: z.string(), // "plan" | "invitation_reward" | ... (more types in future)
  token_usage: z.number(),
  token_limit: z.number(),
  expires_at: z.string().nullish(),
})

const ChatboxAIPlanTypeSchema = z.enum(['free', 'lite', 'pro', 'pro_plus', 'quota_pack'])

const ChatboxAILicenseDetailSchema = z.object({
  type: z.enum(['chatboxai-3.5', 'chatboxai-4']).optional(),
  name: z.string(),
  plan: ChatboxAIPlanTypeSchema.optional().catch(undefined),
  status: z.string().optional(),
  defaultModel: z.enum(['chatboxai-3.5', 'chatboxai-4']).optional(),
  remaining_quota_35: z.number(),
  remaining_quota_4: z.number(),
  remaining_quota_image: z.number(),
  image_used_count: z.number(),
  image_total_quota: z.number(),
  plan_image_limit: z.number(),
  token_refreshed_time: z.string(),
  token_next_refresh_time: z.string().optional(),
  token_expire_time: z.string().nullish(),
  remaining_quota_unified: z.number(),
  expansion_pack_limit: z.number(),
  expansion_pack_usage: z.number(),
  unified_token_usage: z.number(),
  unified_token_limit: z.number(),
  unified_token_usage_details: z.array(UnifiedTokenUsageDetailSchema).default([]),
  aggregated_reward_details: UnifiedTokenUsageDetailSchema.default({
    type: 'reward',
    token_usage: 0,
    token_limit: 0,
    expires_at: null,
  }),
  key: z.string().optional(),
  price_type: z.string().optional(),
  order_type: z.string().optional(),
  utm_source: z.string().optional(),
  expires_at: z.string().optional(),
  recurring_canceled: z.boolean().nullish(),
  payment_type: z.string().optional(),
})

export const shortcutSendValues = [
  '',
  'Enter',
  'Ctrl+Enter',
  'Command+Enter',
  'Shift+Enter',
  'Ctrl+Shift+Enter',
  'CommandOrControl+Enter',
]
const ShortcutSendValueSchema = z.enum(shortcutSendValues as [string, ...string[]])

export const shortcutToggleWindowValues = ['', 'Alt+`', 'Alt+Space', 'Ctrl+Alt+Space', 'Ctrl+Space']
const ShortcutToggleWindowValueSchema = z.enum(shortcutToggleWindowValues as [string, ...string[]])

const newThreadShortcut = 'mod+shift+n'
const legacyNewThreadShortcut = 'mod+r'
const legacyNewPictureChatShortcut = 'mod+shift+n'

const ShortcutSettingSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value
    }

    const shortcuts: Record<string, unknown> = { ...value }
    if (
      shortcuts.messageListRefreshContext === undefined ||
      shortcuts.messageListRefreshContext === legacyNewThreadShortcut
    ) {
      shortcuts.messageListRefreshContext = newThreadShortcut
    }
    if (shortcuts.newPictureChat === legacyNewPictureChatShortcut) {
      shortcuts.newPictureChat = ''
    }
    return shortcuts
  },
  z.object({
    quickToggle: ShortcutToggleWindowValueSchema,
    inputBoxFocus: z.string(),
    inputBoxWebBrowsingMode: z.string(),
    newChat: z.string(),
    newPictureChat: z.string(),
    sessionListNavNext: z.string(),
    sessionListNavPrev: z.string(),
    sessionListNavTargetIndex: z.string(),
    // Keep the historical key name so exported settings still load in downgrade/import paths.
    messageListRefreshContext: z.string().default(newThreadShortcut),
    dialogOpenSearch: z.string(),
    optionNavUp: z.string(),
    optionNavDown: z.string(),
    optionSelect: z.string(),
    inputBoxSendMessage: ShortcutSendValueSchema,
    inputBoxSendMessageWithoutResponse: ShortcutSendValueSchema,
  })
)

const ExtensionSettingsSchema = z.object({
  webSearch: z.object({
    provider: z.enum(['build-in', 'bing', 'tavily', 'bocha', 'querit', 'searxng']).catch('build-in'),
    tavilyApiKey: z.string().optional(),
    bochaApiKey: z.string().optional(),
    queritApiKey: z.string().optional(),
    queritMaxResults: z.number().optional(),
    queritTimeRange: z.string().nullable().optional(),
    searxngBaseUrl: z.string().optional(),
  }),
  knowledgeBase: z
    .object({
      models: z.object({
        embedding: z
          .object({
            modelId: z.string(),
            providerId: z.string(),
          })
          .nullable()
          .optional(),
        rerank: z
          .object({
            modelId: z.string(),
            providerId: z.string(),
          })
          .nullable()
          .optional(),
      }),
    })
    .optional(),
  // Document parser configuration for global default
  documentParser: DocumentParserConfigSchema.optional(),
})

const MCPTransportConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

const MCPServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  protocolMode: z.enum(['auto', 'legacy']).optional().catch(undefined),
  transport: MCPTransportConfigSchema,
})

const MCPSettingsSchema = z.object({
  servers: z.array(MCPServerConfigSchema),
  enabledBuiltinServers: z.array(z.string()),
})

const VibedropPublicationSchema = z.object({
  slug: z.string(),
  url: z.string(),
  visibility: z.enum(['unlisted', 'public']),
  uniqueId: z.string().optional(),
  updatedAt: z.number(),
})

export enum Theme {
  Dark,
  Light,
  System,
}

const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

const createInterfaceThemeColorsSchema = (defaultBrand: string) =>
  z.object({
    backgroundPrimary: HexColorSchema,
    backgroundSecondary: HexColorSchema,
    backgroundTertiary: HexColorSchema,
    brand: HexColorSchema.default(defaultBrand),
  })

const InterfaceColorsSchema = z
  .object({
    light: createInterfaceThemeColorsSchema(DEFAULT_INTERFACE_COLORS.light.brand),
    dark: createInterfaceThemeColorsSchema(DEFAULT_INTERFACE_COLORS.dark.brand),
  })
  .catch(getDefaultInterfaceColors())

const InterfaceColorPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  colors: InterfaceColorsSchema,
})

const DefaultModelSelectionSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
  })
  .optional()
  .catch(undefined)

export const SettingsSchema = GlobalSessionSettingsSchema.extend({
  providers: z.record(z.string(), ProviderSettingsSchema).optional().catch(undefined),
  customProviders: z.array(CustomProviderBaseInfoSchema).optional().catch(undefined),
  favoritedModels: z
    .array(
      z.object({
        provider: z.string(),
        model: z.string(),
      })
    )
    .optional()
    .catch(undefined),

  // default models
  defaultChatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  threadNamingModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  searchTermConstructionModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  ocrModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  defaultEmbeddingModel: DefaultModelSelectionSchema,
  defaultRerankModel: DefaultModelSelectionSchema,

  // chatboxai
  licenseKey: z.string().optional(),
  licenseInstances: z.record(z.string(), z.string()).optional().catch(undefined),
  licenseDetail: ChatboxAILicenseDetailSchema.optional().catch(undefined),
  licensePlanName: z.string().optional(),
  licenseActivationMethod: z.enum(['login', 'manual']).optional(),
  hasExpiredLicense: z.boolean().default(false),
  lastSelectedLicenseByUser: z.record(z.string(), z.string()).optional().catch(undefined),
  // 在 licensekeyview UI中显示/记忆的key，以免用户使用 login 方式后老 key 被清除，他也不记得
  memorizedManualLicenseKey: z.string().optional(),
  chatboxAIDesktopPromptDismissed: z.boolean().default(false),

  // VibeDrop HTML artifact publishing
  // Cached publish key issued by chatbox-backend, bound to the account email it
  // was issued for so it is never reused across accounts. Cleared on logout.
  vibedropPublishKey: z.object({ email: z.string(), key: z.string() }).optional().catch(undefined),
  // Maps a code block's uniqueId → its published VibeDrop slug, so re-publishing
  // the same artifact updates the same site (stable URL) instead of creating new.
  vibedropSlugs: z.record(z.string(), z.string()).optional().catch(undefined),
  // Recent published sites grouped by session. Used to let users explicitly
  // choose between creating a page and replacing an existing page.
  vibedropSessionPublications: z.record(z.string(), z.array(VibedropPublicationSchema)).optional().catch(undefined),

  // chat settings
  showWordCount: z.boolean().optional().catch(undefined),
  showTokenCount: z.boolean().optional().catch(undefined),
  showTokenUsed: z.boolean().optional().catch(undefined),
  showModelName: z.boolean().optional().catch(undefined),
  showMessageTimestamp: z.boolean().optional().catch(undefined),
  showFirstTokenLatency: z.boolean().optional().catch(undefined),

  showAvatar: z.boolean().optional().catch(undefined),
  hideSystemPromptMessage: z.boolean().optional().catch(undefined),
  messageLayout: z.enum(['left', 'bubble']).optional().catch(undefined),
  autoScrollNewMessagesToTop: z.boolean().default(false),

  theme: z.nativeEnum(Theme),
  interfaceColors: InterfaceColorsSchema,
  interfaceColorPresets: z.array(InterfaceColorPresetSchema).default([]),
  language: z.enum([
    'en',
    'zh-Hans',
    'zh-Hant',
    'ja',
    'ko',
    'ru',
    'de',
    'fr',
    'pt-PT',
    'es',
    'ar',
    'it-IT',
    'sv',
    'nb-NO',
  ]),
  languageInited: z.boolean().optional(),
  fontSize: z.number().catch(14),
  spellCheck: z.boolean().optional(),

  startupPage: z.enum(['home', 'session']).optional(),

  // disableQuickToggleShortcut?: boolean // 是否关闭快捷键切换窗口显隐（弃用，为了兼容历史数据，这个字段永远不要使用）

  defaultPrompt: z.string().optional(), // 新会话的默认 prompt

  proxy: z.string().optional(), // 代理地址

  allowReportingAndTracking: z.boolean().optional(), // 是否允许错误报告和事件追踪

  userAvatarKey: z.string().optional(), // 用户头像的 key
  defaultAssistantAvatarKey: z.string().optional(), // 默认助手头像的 key
  backgroundImageKey: z.string().optional(), // 应用背景图片的 key（本地上传）
  backgroundImageOpacity: z.number().min(0).max(1).catch(0.16),

  enableMarkdownRendering: z.boolean().default(true),
  enableMermaidRendering: z.boolean().default(true),
  enableLaTeXRendering: z.boolean().default(true),
  injectDefaultMetadata: z.boolean().default(true), // 是否注入默认附加元数据（如模型名称、当前日期）
  autoPreviewArtifacts: z.boolean().default(false), // 是否自动展开预览 artifacts
  autoCollapseCodeBlock: z.boolean().default(true), // 是否自动折叠代码块
  pasteLongTextAsAFile: z.boolean().default(true), // 是否将长文本粘贴为文件

  autoGenerateTitle: z.boolean().default(true),

  autoCompaction: z.boolean().default(true),
  compactionThreshold: z.number().min(0.4).max(0.9).default(0.6),

  // Global default for the tool-call-limit confirmation. Individual sessions
  // can override it via SessionSettingsSchema.pauseOnToolCallLimit.
  pauseOnToolCallLimit: z.boolean().default(true),

  autoLaunch: z.boolean().default(false),
  autoUpdate: z.boolean().default(true), // 是否自动检查更新
  betaUpdate: z.boolean().default(false), // 是否自动检查 beta 更新

  shortcuts: ShortcutSettingSchema,

  // Persistent agent memory feature switch. Undefined means enabled; when off,
  // memory tools are not registered and stored memories are not injected in
  // either mode (Soul is unaffected).
  memoryEnabled: z.boolean().optional().catch(undefined),
  // Opaque version of effective Global Memory state. Sessions compare it lazily
  // at generation time so an off-on round trip still refreshes memory.
  memoryStateToken: z.string().max(MEMORY_STATE_TOKEN_MAX_CHARS).optional().catch(undefined),

  extension: ExtensionSettingsSchema,
  mcp: MCPSettingsSchema,
  skills: SkillSettingsSchema.catch({
    enabledSkillNames: [...DEFAULT_ENABLED_BUILTIN_SKILL_NAMES],
    translationEnabled: true,
    builtinDefaultsInitialized: true,
    appliedDefaultBuiltinSkillNames: [...DEFAULT_ENABLED_BUILTIN_SKILL_NAMES],
  }),
})

// TODO: provider的 base info 和 settings混在一起了，可以考虑像 session settings 和 global settings一样拆开
export type ProviderInfo = (ProviderBaseInfo | CustomProviderBaseInfo) & ProviderSettings

export type SessionSettings = z.infer<typeof SessionSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type ProviderModelInfo = z.infer<typeof ProviderModelInfoSchema>
export type ProviderBaseInfo = z.infer<typeof ProviderBaseInfoSchema>
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>
export type BuiltinProviderBaseInfo = z.infer<typeof BuiltinProviderBaseInfoSchema>
export type CustomProviderBaseInfo = z.infer<typeof CustomProviderBaseInfoSchema>
export type ClaudeParams = z.infer<typeof ClaudeParamsSchema>
export type OpenAIParams = z.infer<typeof OpenAIParamsSchema>
export type GoogleParams = z.infer<typeof GoogleParamsSchema>
export type ProviderOptions = z.infer<typeof ProviderOptionsSchema>
export type GlobalSessionSettings = z.infer<typeof GlobalSessionSettingsSchema>
export type ChatboxAILicenseDetail = z.infer<typeof ChatboxAILicenseDetailSchema>
export type ChatboxAIPlanType = z.infer<typeof ChatboxAIPlanTypeSchema>
export type UnifiedTokenUsageDetail = z.infer<typeof UnifiedTokenUsageDetailSchema>
export type ShortcutSendValue = z.infer<typeof ShortcutSendValueSchema>
export type ShortcutToggleWindowValue = z.infer<typeof ShortcutToggleWindowValueSchema>
export type ShortcutName = keyof ShortcutSetting
export type ShortcutSetting = z.infer<typeof ShortcutSettingSchema>
export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>
export type MCPTransportConfig = z.infer<typeof MCPTransportConfigSchema>
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
export type MCPSettings = z.infer<typeof MCPSettingsSchema>

// Re-export SkillSettings for convenience
export type { SkillSettings } from '../../types/skills'

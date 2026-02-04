import { z } from 'zod'
import { ModelProviderEnum, ModelProviderType } from './provider'

// Re-export for backward compatibility
export { ModelProviderType } from './provider'

export const ProviderModelInfoSchema = z.object({
  modelId: z.string(),
  type: z.enum(['chat', 'embedding', 'rerank']).optional().catch(undefined),
  apiStyle: z.enum(['google', 'openai', 'anthropic']).optional().catch(undefined),
  nickname: z.string().optional().catch(undefined),
  labels: z.array(z.string()).optional().catch([]),
  capabilities: z
    .array(z.enum(['vision', 'reasoning', 'tool_use', 'web_search']))
    .optional()
    .catch([]),
  contextWindow: z.number().optional().catch(undefined),
  maxOutput: z.number().optional().catch(undefined),
})

export const ProviderSettingsSchema = z.object({
  apiKey: z.string().optional().catch(undefined),
  apiHost: z.string().optional().catch(undefined),
  apiPath: z.string().optional().catch(undefined),
  models: z.array(ProviderModelInfoSchema).optional().catch(undefined),
  excludedModels: z.array(z.string()).optional().catch(undefined),
  useProxy: z.boolean().optional().catch(undefined),

  // azure
  endpoint: z.string().optional().catch(undefined),
  deploymentName: z.string().optional().catch(undefined),
  dalleDeploymentName: z.string().optional().catch(undefined),
  apiVersion: z.string().optional().catch(undefined),
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
  thinking: z.object({
    type: z.enum(['enabled', 'disabled']).default('enabled'),
    budgetTokens: z.number().catch(1024),
  }),
})

const OpenAIParamsSchema = z.object({
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional().catch(undefined),
})

const GoogleParamsSchema = z.object({
  thinkingConfig: z.object({
    thinkingBudget: z.number().catch(1024),
    includeThoughts: z.boolean().catch(true),
  }),
})

export const ProviderOptionsSchema = z.object({
  claude: ClaudeParamsSchema.optional(),
  openai: OpenAIParamsSchema.optional(),
  google: GoogleParamsSchema.optional(),
})

// NOTICE: Global settings is for new session default settings, set to session when session created, changes will not affect existing sessions
export const GlobalSessionSettingsSchema = z.object({
  maxContextMessageCount: z.number().optional().catch(undefined),
  temperature: z.number().optional().catch(undefined),
  topP: z.number().optional().catch(undefined),
  maxTokens: z.number().optional().catch(undefined),
  stream: z.boolean().optional().catch(true),
})

export const SessionSettingsSchema = GlobalSessionSettingsSchema.extend({
  provider: z.string().optional().catch(undefined),
  modelId: z.string().optional().catch(undefined),
  dalleStyle: z.enum(['vivid', 'natural']).optional().catch('vivid'),
  imageGenerateNum: z.number().optional().catch(1),
  providerOptions: ProviderOptionsSchema.optional().catch(undefined),
})

const ChatboxAILicenseDetailSchema = z.object({
  type: z.enum(['chatboxai-3.5', 'chatboxai-4']).optional(),
  name: z.string(),
  defaultModel: z.enum(['chatboxai-3.5', 'chatboxai-4']).optional(),
  remaining_quota_35: z.number(),
  remaining_quota_4: z.number(),
  remaining_quota_image: z.number(),
  image_used_count: z.number(),
  image_total_quota: z.number(),
  token_refreshed_time: z.string(),
  token_next_refresh_time: z.string().optional(),
  token_expire_time: z.string().nullish(),
  remaining_quota_unified: z.number(),
  expansion_pack_limit: z.number(),
  expansion_pack_usage: z.number(),
  unified_token_usage: z.number(),
  unified_token_limit: z.number(),
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

const ShortcutSettingSchema = z.object({
  quickToggle: ShortcutToggleWindowValueSchema,
  inputBoxFocus: z.string(),
  inputBoxWebBrowsingMode: z.string(),
  newChat: z.string(),
  newPictureChat: z.string(),
  sessionListNavNext: z.string(),
  sessionListNavPrev: z.string(),
  sessionListNavTargetIndex: z.string(),
  messageListRefreshContext: z.string(),
  dialogOpenSearch: z.string(),
  optionNavUp: z.string(),
  optionNavDown: z.string(),
  optionSelect: z.string(),
  inputBoxSendMessage: ShortcutSendValueSchema,
  inputBoxSendMessageWithoutResponse: ShortcutSendValueSchema,
})

const ExtensionSettingsSchema = z.object({
  webSearch: z.object({
    provider: z.enum(['build-in', 'bing', 'tavily']),
    tavilyApiKey: z.string().optional(),
    tavilySearchDepth: z.string().optional(),
    tavilyMaxResults: z.number().optional(),
    tavilyTimeRange: z.string().optional(),
    tavilyIncludeRawContent: z.string().optional(),
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
  transport: MCPTransportConfigSchema,
})

const MCPSettingsSchema = z.object({
  servers: z.array(MCPServerConfigSchema),
  enabledBuiltinServers: z.array(z.string()),
})

export enum Theme {
  Dark,
  Light,
  System,
}

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

  // chatboxai
  licenseKey: z.string().optional(),
  licenseInstances: z.record(z.string(), z.string()).optional().catch(undefined),
  licenseDetail: ChatboxAILicenseDetailSchema.optional().catch(undefined),
  licenseActivationMethod: z.enum(['login', 'manual']).optional(),
  lastSelectedLicenseByUser: z.record(z.string(), z.string()).optional().catch(undefined),
  // 在 licensekeyview UI中显示/记忆的key，以免用户使用 login 方式后老 key 被清除，他也不记得
  memorizedManualLicenseKey: z.string().optional(),

  // chat settings
  showWordCount: z.boolean().optional().catch(undefined),
  showTokenCount: z.boolean().optional().catch(undefined),
  showTokenUsed: z.boolean().optional().catch(undefined),
  showModelName: z.boolean().optional().catch(undefined),
  showMessageTimestamp: z.boolean().optional().catch(undefined),
  showFirstTokenLatency: z.boolean().optional().catch(undefined),

  theme: z.nativeEnum(Theme),
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

  enableMarkdownRendering: z.boolean().default(true),
  enableMermaidRendering: z.boolean().default(true),
  enableLaTeXRendering: z.boolean().default(true),
  injectDefaultMetadata: z.boolean().default(true), // 是否注入默认附加元数据（如模型名称、当前日期）
  autoPreviewArtifacts: z.boolean().default(false), // 是否自动展开预览 artifacts
  autoCollapseCodeBlock: z.boolean().default(true), // 是否自动折叠代码块
  pasteLongTextAsAFile: z.boolean().default(true), // 是否将长文本粘贴为文件

  autoGenerateTitle: z.boolean().default(true),

  autoLaunch: z.boolean().default(false),
  autoUpdate: z.boolean().default(true), // 是否自动检查更新
  betaUpdate: z.boolean().default(false), // 是否自动检查 beta 更新

  shortcuts: ShortcutSettingSchema,

  extension: ExtensionSettingsSchema,
  mcp: MCPSettingsSchema,
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
export type ShortcutSendValue = z.infer<typeof ShortcutSendValueSchema>
export type ShortcutToggleWindowValue = z.infer<typeof ShortcutToggleWindowValueSchema>
export type ShortcutName = keyof ShortcutSetting
export type ShortcutSetting = z.infer<typeof ShortcutSettingSchema>
export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>
export type MCPTransportConfig = z.infer<typeof MCPTransportConfigSchema>
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
export type MCPSettings = z.infer<typeof MCPSettingsSchema>

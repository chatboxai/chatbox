import type { FinishReason, LanguageModelUsage } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import type { MCPServerConfig } from './types/mcp'

export interface SearchResultItem {
  title: string
  link: string
  snippet: string
}

export interface SearchResult {
  items: SearchResultItem[]
}

export interface MessageFile {
  id: string
  name: string
  fileType: string
  url?: string
  storageKey?: string
  chatboxAIFileUUID?: string
}

export interface MessageLink {
  id: string
  url: string
  title: string
  storageKey?: string
  chatboxAILinkUUID?: string
}

export interface MessagePicture {
  url?: string
  storageKey?: string
  loading?: boolean
}

export const MessageRoleEnum = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool',
} as const

export type MessageRole = (typeof MessageRoleEnum)[keyof typeof MessageRoleEnum]

export type MessageTextPart = { type: 'text'; text: string }
export type MessageImagePart = { type: 'image'; storageKey: string; ocrResult?: string }
export type MessageInfoPart = { type: 'info'; text: string; values?: Record<string, unknown> }
/**
 * Represents a reasoning/thinking part of a message with timing information
 */
export type MessageReasoningPart = {
  type: 'reasoning'
  text: string
  /** Timestamp when the thinking process started (milliseconds since epoch) */
  startTime?: number
  /** Total duration of the thinking process in milliseconds */
  duration?: number
}
export type MessageToolCallPart<Args = unknown, Result = unknown> = {
  type: 'tool-call'
  state: 'call' | 'result' | 'error'
  toolCallId: string
  toolName: string
  args: Args
  result?: Result
}

export type MessageContentParts = (
  | MessageTextPart
  | MessageImagePart
  | MessageInfoPart
  | MessageToolCallPart
  | MessageReasoningPart
)[]
export type StreamTextResult = {
  contentParts: MessageContentParts
  reasoningContent?: string
  usage?: LanguageModelUsage
  finishReason?: FinishReason
}

// Chatbox 应用的消息类型
export interface Message {
  id: string // 当role为tool时，id为toolCallId

  role: MessageRole
  // 把这个字段注释是为了避免新的引用，兼容老数据的时候还是可以读取
  // content?: string // contentParts 有值的时候用contentParts
  name?: string // 之前不知道是干什么的，现在用于role=tool时存储tool name

  cancel?: () => void
  generating?: boolean

  aiProvider?: ModelProvider | string
  model?: string

  style?: string // image style
  // pictures?: MessagePicture[] // 迁移到 contentParts 中

  files?: MessageFile[] // chatboxai 专用
  links?: MessageLink[] // chatboxai 专用

  // webBrowsing?: MessageWebBrowsing // chatboxai 专用, （已废弃）
  // toolCalls?: MessageToolCalls // 已废弃，使用contentParts代替

  reasoningContent?: string
  contentParts: MessageContentParts

  /** Whether this message was generated in streaming mode (affects timer display for reasoning content) */
  isStreamingMode?: boolean

  errorCode?: number
  error?: string
  errorExtra?: {
    [key: string]: unknown
  }
  status?: (
    | {
        type: 'sending_file'
        mode?: 'local' | 'advanced'
      }
    | {
        type: 'loading_webpage'
        mode?: 'local' | 'advanced'
      }
  )[]

  wordCount?: number // 当前消息的字数
  tokenCount?: number // 当前消息的 token 数量
  tokensUsed?: number // 生成当前消息的 token 使用量
  timestamp?: number // 当前消息的时间戳
  firstTokenLatency?: number // AI 回答首字耗时(毫秒) - 从发送请求到接收到第一个字的时间间隔
  finishReason?: FinishReason // 生成当前消息的结束原因
}

export type SettingWindowTab = 'ai' | 'display' | 'chat' | 'advanced' | 'extension' | 'mcp'

export type ExportChatScope = 'all_threads' | 'current_thread'

export type ExportChatFormat = 'Markdown' | 'TXT' | 'HTML'

export type SessionType = 'chat' | 'picture'

export function isChatSession(session: Session) {
  return session.type === 'chat' || !session.type
}
export function isPictureSession(session: Session) {
  return session.type === 'picture'
}

type ClaudeParams = {
  thinking: {
    type: 'enabled' | 'disabled'
    budgetTokens: number
  }
}

type OpenAIParams = {
  reasoningEffort: 'low' | 'medium' | 'high' | null
}

type GoogleParams = {
  thinkingConfig: {
    thinkingBudget: number
    includeThoughts: boolean
  }
}
export type ProviderOptions = {
  claude?: Partial<ClaudeParams>
  openai?: Partial<OpenAIParams>
  google?: Partial<GoogleParams>
}

export type SessionSettings = Partial<{
  provider: ModelProvider
  modelId: string
  maxContextMessageCount: number
  temperature: number
  topP: number
  maxTokens?: number
  stream: boolean
  dalleStyle: 'vivid' | 'natural'
  imageGenerateNum: number // 生成图片的数量
  providerOptions?: ProviderOptions
}>

export interface Session {
  id: string
  type?: SessionType // undefined 为了兼容老版本 chat
  name: string
  picUrl?: string
  messages: Message[]
  starred?: boolean
  copilotId?: string
  assistantAvatarKey?: string // 助手头像的 key
  settings?: SessionSettings // 会话设置
  threads?: SessionThread[] // 历史话题列表
  threadName?: string // 当前话题名称
  messageForksHash?: Record<
    string,
    {
      position: number // 当前分叉列表的游标
      lists: {
        id: string // fork list id
        messages: Message[]
      }[]
      createdAt: number
    }
  > // 消息 ID 对应的分叉数据
}

export type SessionMeta = Pick<Session, 'id' | 'name' | 'starred' | 'assistantAvatarKey' | 'picUrl' | 'type'>

// 话题
export interface SessionThread {
  id: string
  name: string
  messages: Message[]
  createdAt: number
}

export interface SessionThreadBrief {
  id: string
  name: string
  createdAt?: number
  createdAtLabel?: string
  firstMessageId: string
  messageCount: number
}

export function createMessage(role: MessageRole = MessageRoleEnum.User, content: string = ''): Message {
  return {
    id: uuidv4(),
    contentParts: content ? [{ type: 'text', text: content }] : [], // 防止为 undefined 或 null
    role: role,
    timestamp: Date.now(),
  }
}

export type ToolUseScope = 'web-browsing' | 'knowledge-base'

export enum ModelProviderEnum {
  ChatboxAI = 'chatbox-ai',
  OpenAI = 'openai',
  Azure = 'azure',
  ChatGLM6B = 'chatglm-6b',
  Claude = 'claude',
  Gemini = 'gemini',
  Ollama = 'ollama',
  Groq = 'groq',
  DeepSeek = 'deepseek',
  SiliconFlow = 'siliconflow',
  VolcEngine = 'volcengine',
  MistralAI = 'mistral-ai',
  LMStudio = 'lm-studio',
  Perplexity = 'perplexity',
  XAI = 'xAI',
  Custom = 'custom',
}
export type ModelProvider = ModelProviderEnum | string

export type ProviderModelInfo = {
  modelId: string
  type?: 'chat' | 'embedding' | 'rerank' // 模型类型，chat/embedding/rerank
  apiStyle?: 'google' | 'openai' | 'anthropic'
  nickname?: string
  labels?: string[]
  capabilities?: ('vision' | 'reasoning' | 'tool_use' | 'web_search')[]
  contextWindow?: number
  maxOutput?: number
}

export type BuiltinProviderBaseInfo = {
  id: ModelProvider
  name: string
  type: ModelProviderType
  isCustom?: false
  urls?: {
    website?: string
    apiKey?: string
    docs?: string
    models?: string
  }
  defaultSettings?: ProviderSettings
}

export type CustomProviderBaseInfo = Omit<BuiltinProviderBaseInfo, 'id' | 'isCustom'> & {
  id: string
  iconUrl?: string
  isCustom: true
}

export type ProviderBaseInfo = BuiltinProviderBaseInfo | CustomProviderBaseInfo

export type ProviderSettings = Partial<{
  apiHost: string
  apiPath: string
  apiKey: string
  models: ProviderModelInfo[]
  baseDefaultModels: ProviderModelInfo[]
  excludedModels: string[] // chatbox ai记录被移除的模型id
  // azure
  endpoint: string
  deploymentName: string
  dalleDeploymentName: string // dall-e-3 的部署名称
  apiVersion: string
  useProxy: boolean // 目前只有custom provider会使用这个字段
}>

export type ProviderInfo = (ProviderBaseInfo | CustomProviderBaseInfo) & ProviderSettings

export enum ModelProviderType {
  ChatboxAI = 'chatbox-ai',
  OpenAI = 'openai',
  Gemini = 'gemini',
  Claude = 'claude',
}

export type ModelMeta = {
  [key: string]: {
    contextWindow: number
    maxOutput?: number
    functionCalling?: boolean
    vision?: boolean
    reasoning?: boolean
  }
}

export interface CustomProvider {
  id: string
  name: string
  api: 'openai'
  host: string
  path: string
  key: string
  model: string
  modelOptions?: string[]
  useProxy?: boolean
}

export interface ExtensionSettings {
  webSearch: {
    provider: 'build-in' | 'bing' | 'tavily' // 搜索提供方
    tavilyApiKey?: string // Tavily API 密钥
  }
  knowledgeBase?: {
    models: {
      embedding?: {
        modelId: string
        providerId: string
      } | null
      rerank?: {
        modelId: string
        providerId: string
      } | null
    }
  }
}

export interface MCPSettings {
  servers: MCPServerConfig[]
  enabledBuiltinServers: string[]
}

export interface Settings extends SessionSettings {
  providers?: {
    [key: string]: ProviderSettings
  }

  customProviders?: CustomProviderBaseInfo[]

  favoritedModels?: {
    provider: ModelProvider | string
    model: string
  }[]

  // default models
  defaultChatModel?: {
    provider: ModelProvider | string
    model: string
  }
  threadNamingModel?: {
    provider: ModelProvider | string
    model: string
  }
  searchTermConstructionModel?: {
    provider: ModelProvider | string
    model: string
  }
  ocrModel?: {
    provider: ModelProvider | string
    model: string
  }

  // chatboxai
  licenseKey?: string
  licenseInstances?: {
    [key: string]: string
  }
  licenseDetail?: ChatboxAILicenseDetail

  showWordCount?: boolean
  showTokenCount?: boolean
  showTokenUsed?: boolean
  showModelName?: boolean
  showMessageTimestamp?: boolean
  showFirstTokenLatency?: boolean

  theme: Theme
  language: Language
  languageInited?: boolean
  fontSize: number
  spellCheck: boolean

  startupPage?: 'home' | 'session' // 启动页

  // disableQuickToggleShortcut?: boolean // 是否关闭快捷键切换窗口显隐（弃用，为了兼容历史数据，这个字段永远不要使用）

  defaultPrompt?: string // 新会话的默认 prompt

  proxy?: string // 代理地址

  allowReportingAndTracking: boolean // 是否允许错误报告和事件追踪

  userAvatarKey?: string // 用户头像的 key
  defaultAssistantAvatarKey?: string // 默认助手头像的 key

  enableMarkdownRendering: boolean
  enableMermaidRendering: boolean
  enableLaTeXRendering: boolean
  injectDefaultMetadata: boolean // 是否注入默认附加元数据（如模型名称、当前日期）
  autoPreviewArtifacts: boolean // 是否自动展开预览 artifacts
  autoCollapseCodeBlock: boolean // 是否自动折叠代码块
  pasteLongTextAsAFile: boolean // 是否将长文本粘贴为文件

  autoGenerateTitle: boolean

  autoLaunch: boolean
  autoUpdate: boolean // 是否自动检查更新
  betaUpdate: boolean // 是否自动检查 beta 更新
  shortcuts: ShortcutSetting

  extension: ExtensionSettings
  mcp: MCPSettings
}

export interface ShortcutSetting {
  // windowQuickToggle: string // 快速切换窗口显隐的快捷键
  quickToggle: ShortcutToggleWindowValue

  inputBoxFocus: string // 聚焦输入框的快捷键
  inputBoxWebBrowsingMode: string // 切换输入框的 web 浏览模式的快捷键
  newChat: string // 新建聊天的快捷键
  newPictureChat: string // 新建图片会话的快捷键
  sessionListNavNext: string // 切换到下一个会话的快捷键
  sessionListNavPrev: string // 切换到上一个会话的快捷键
  sessionListNavTargetIndex: string // 切换到指定会话的快捷键
  messageListRefreshContext: string // 刷新上下文的快捷键
  dialogOpenSearch: string // 打开搜索对话框的快捷键
  // inputBoxSend: string // 发送消息的快捷键
  // inputBoxInsertNewLine: string // 输入框换行的快捷键
  // inputBoxSendWithoutResponse: string // 发送但不生成回复的快捷键
  optionNavUp: string // 选项导航的快捷键
  optionNavDown: string // 选项导航的快捷键
  optionSelect: string // 选项导航的快捷键
  inpubBoxSendMessage: ShortcutSendValue
  inpubBoxSendMessageWithoutResponse: ShortcutSendValue
}

export const shortcutSendValues = ['', 'Enter', 'Ctrl+Enter', 'Command+Enter', 'Shift+Enter', 'Ctrl+Shift+Enter']
export type ShortcutSendValue = (typeof shortcutSendValues)[number]
export const shortcutToggleWindowValues = [
  '',
  'Alt+`',
  'Alt+Space',
  'Ctrl+Alt+Space',
  // 'Command+Space', // 系统快捷键冲突
  'Ctrl+Space', // 系统快捷键冲突
  // 'Command+Alt+Space', 系统快捷键冲突
]
export type ShortcutToggleWindowValue = (typeof shortcutToggleWindowValues)[number]

export type ShortcutName = keyof ShortcutSetting

export type Language =
  | 'en'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'de'
  | 'fr'
  | 'pt-PT'
  | 'es'
  | 'ar'
  | 'it-IT'
  | 'sv'
  | 'nb-NO'

export interface Config {
  uuid: string
}

export interface SponsorAd {
  text: string
  url: string
}

export interface SponsorAboutBanner {
  type: 'picture' | 'picture-text'
  name: string
  pictureUrl: string
  link: string
  title: string
  description: string
}

export interface CopilotDetail {
  id: string
  name: string
  picUrl?: string
  prompt: string
  demoQuestion?: string
  demoAnswer?: string
  starred?: boolean
  usedCount: number
  shared?: boolean
}

export interface Toast {
  id: string
  content: string
  duration?: number
}

export enum Theme {
  Dark,
  Light,
  System,
}

export interface RemoteConfig {
  setting_chatboxai_first: boolean
  product_ids: number[]
  knowledge_base_models?: {
    embedding: string
    vision: string
    rerank: string
  }
}

export interface ChatboxAILicenseDetail {
  type: ChatboxAIModel // 弃用，存在于老版本中
  name: string
  defaultModel: ChatboxAIModel
  remaining_quota_35: number
  remaining_quota_4: number
  remaining_quota_image: number
  image_used_count: number
  image_total_quota: number
  token_refreshed_time: string
  token_expire_time: string | null | undefined
  remaining_quota_unified: number
  expansion_pack_limit: number
  expansion_pack_usage: number
}

export type ChatboxAIModel = 'chatboxai-3.5' | 'chatboxai-4' | string

export interface ModelOptionGroup {
  group_name?: string
  options: {
    label: string
    value: string
    recommended?: boolean
  }[]
  // hidden?: boolean
  collapsable?: boolean
}

export function copyMessage(source: Message): Message {
  return {
    ...source,
    cancel: undefined,
    id: uuidv4(),
  }
}

export function copyThreads(source?: SessionThread[]): SessionThread[] | undefined {
  if (!source) {
    return undefined
  }
  return source.map((thread) => ({
    ...thread,
    messages: thread.messages.map(copyMessage),
    createdAt: Date.now(),
    id: uuidv4(),
  }))
}

// RAG 相关
export interface KnowledgeBase {
  id: number
  name: string
  embeddingModel: string
  rerankModel: string
  visionModel?: string
  createdAt: number
}

export interface KnowledgeBaseFile {
  id: number
  kb_id: number
  filename: string
  filepath: string
  mime_type: string
  file_size: number
  chunk_count: number
  total_chunks: number
  status: string
  error: string
  createdAt: number
}

export interface KnowledgeBaseSearchResult {
  id: number
  score: number
  text: string
  fileId: number
  filename: string
  mimeType: string
  chunkIndex: number
}

export type FileMeta = {
  name: string
  path: string
  type: string
  size: number
}
